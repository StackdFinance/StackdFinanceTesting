// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./Auth.sol";
import "./IStackd.sol";
import "./IERC20.sol";

contract StackdTeamVestingInstance is Auth {

    IStackd stackd;

    address public beneficiary;
    address public BUSD = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56;

    uint public start;
    uint public basisPoints = 10000;
    uint public totalVested;
    uint public totalClaimed;
    uint public oneWeek = 604800;

    bool public started;

    constructor(address _stackd, uint _totalVesting, address _beneficiary) Auth(msg.sender) {
        beneficiary = _beneficiary;
        stackd = IStackd(_stackd);
        totalVested = _totalVesting;
    }

    function startVesting() external authorized {
        start = block.timestamp;
        started = true;
    }

    function _claimStackd() internal {
        _claimBUSD();
        uint owed = getClaimableAmount();
        totalClaimed += owed;
        require(stackd.transfer(beneficiary, owed), "Stackd Transfer Failed");
    }

    function claimStackd() external authorized {
        _claimStackd();
    }

    function getClaimableAmount() public view returns (uint) {
        if (!started) {
            return 0;
        }

        uint numWeeks = (block.timestamp - start) / oneWeek;
        uint total = (totalVested * (numWeeks * 100)) / basisPoints;
        return total - totalClaimed;
    }

    function getOwedBUSD() external view returns(uint) {
        return IERC20(BUSD).balanceOf(address(this));
    }

    function _claimBUSD() internal {
        stackd.claimDividend();
        uint balance = IERC20(BUSD).balanceOf(address(this));
        require(IERC20(BUSD).transfer(beneficiary, balance), "BUSD Transfer Failed");
    }

    function claimBUSD() external authorized {
        _claimBUSD();
    }

    function changeBeneficiaryAddress(address newBeneficiary) external authorized {
        beneficiary = newBeneficiary;
    }

    function emergencyWithdrawERC20(address _token) external authorized {
        require(_token != address(stackd) && _token != BUSD, "Please use the specified claim functons for stackd and BUSD");
        require(IERC20(_token).transfer(owner, IERC20(_token).balanceOf(address(this))), "Emergency withdrawal failed");
    }

    function cancelVesting() external authorized {
        _claimStackd();
        uint remaining = totalVested - totalClaimed;
        require(stackd.transfer(owner, remaining), "Withdrawal Failed");
    }

    function getAllAmounts() external view returns(uint total, uint claimed, uint owed) {
        total = totalVested;
        claimed = totalClaimed;
        owed = getClaimableAmount();
        return (total, claimed, owed);
    }
}

contract StackdTeamVestingManager is Auth {
    // TODO: Make sure we only want authorized wallets to be able to process vested tokens/busd rewards, personally
    // TODO: I think that users should at least be able to claim their BUSD
    IStackd stackd;
    mapping(address => StackdTeamVestingInstance) public vestingInstances;
    mapping(uint => address) public idToInstance;
    StackdTeamVestingInstance[] instancesList;

    constructor(address _stackd) Auth(msg.sender) {
        stackd = IStackd(_stackd);
    }

    function authorizeInstance(address _instanceAddress, address _authorizedAddress) external authorized {
        StackdTeamVestingInstance instance = StackdTeamVestingInstance(_instanceAddress);
        instance.authorize(_authorizedAddress);
    }

    function processInstance(address user) external authorized {
        StackdTeamVestingInstance instance = vestingInstances[user];
        instance.claimStackd();
    }

    function getAllInstances() external view returns(StackdTeamVestingInstance[] memory) {
        return instancesList;
    }

    function getAllAmountsForUser(address user) external view returns (uint, uint, uint){
        StackdTeamVestingInstance instance = vestingInstances[user];
        return instance.getAllAmounts();
    }

    function processMultipleInstances(uint start, uint end) external authorized {
        for (uint i = start; i <= end; i++) {
            StackdTeamVestingInstance instance = instancesList[i];
            instance.claimStackd();
        }
    }

    function cancelVestingInstance(address instanceAddress) external authorized {
        StackdTeamVestingInstance instance = StackdTeamVestingInstance(instanceAddress);
        instance.cancelVesting();
        for (uint i = 0; i < instancesList.length; i++) {
            if (address(instancesList[i]) == instanceAddress) {
                instancesList[i] = instancesList[instancesList.length - 1];
                idToInstance[i] = address(instancesList[i]);
                instancesList.pop();
            }
        }
    }

    function withdrawERC20(address token, address to, uint amount) external authorized {
        if (amount == 0) {
            amount = IERC20(token).balanceOf(address(this));
        }
        require(IERC20(token).transfer(to, amount), "Transfer Failed");
    }

    function processOwedBUSD(address user) external {
        StackdTeamVestingInstance instance = vestingInstances[user];
        instance.claimBUSD();
    }

    function processMultipleOwedBUSD(uint start, uint end) external authorized {
        for (uint i = start; i <= end; i++) {
            StackdTeamVestingInstance instance = instancesList[i];
            instance.claimBUSD();
        }
    }

    function _startVesting(StackdTeamVestingInstance instance) internal {
        instance.startVesting();
    }

    function startSingleVesting(StackdTeamVestingInstance instance) external authorized {
        _startVesting(instance);
    }

    function startMultipleVesting(uint start, uint end) external authorized {
        for (uint i = start; i <= end; i++) {
            StackdTeamVestingInstance instance = instancesList[i];
            _startVesting(instance);
        }
    }

    function createVestingInstance(address beneficiary, uint amount) external authorized {
        StackdTeamVestingInstance newInstance = new StackdTeamVestingInstance(address(stackd), amount, beneficiary);
        idToInstance[instancesList.length] = address(newInstance);
        instancesList.push(newInstance);
        vestingInstances[beneficiary] = newInstance;
        require(stackd.transferFrom(msg.sender, address(newInstance), amount), "Stackd Transfer Failed");
    }

}
