// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./Auth.sol";
import "./IStackd.sol";
import "./IERC20.sol";

contract StackdPrivateSaleVestingInstance is Auth {

    IStackd stackd;

    address public beneficiary;
    address public BUSD = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56;

    uint public start;
    uint public basisPoints = 10000;
    uint public totalVested;
    uint public totalClaimed;
    uint public oneDay = 86400;

    bool public started;

    mapping(uint => uint) public vestingAmounts;

    constructor(address _stackd, uint _totalVesting, address _beneficiary) Auth(msg.sender) {
        beneficiary = _beneficiary;
        stackd = IStackd(_stackd);
        totalVested = _totalVesting;
        vestingAmounts[0] = (1500 * _totalVesting) / 10000;
        vestingAmounts[1] = (3000 * _totalVesting) / 10000;
        vestingAmounts[2] = (4500 * _totalVesting) / 10000;
        vestingAmounts[3] = (6000 * _totalVesting) / 10000;
        vestingAmounts[4] = (7500 * _totalVesting) / 10000;
        vestingAmounts[5] = _totalVesting;
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
        if (block.timestamp - start >= 180 * oneDay) {
            return totalVested - totalClaimed;
        }
        else if (block.timestamp - start >= 150 * oneDay) {
            return vestingAmounts[4] - totalClaimed;
        }
        else if (block.timestamp - start >= 120 * oneDay) {
            return vestingAmounts[3] - totalClaimed;
        }
        else if (block.timestamp - start >= 90 * oneDay) {
            return vestingAmounts[2] - totalClaimed;
        }
        else if (block.timestamp - start >= 60 * oneDay) {
            return vestingAmounts[1] - totalClaimed;
        }
        else if (block.timestamp - start >= 30 * oneDay) {
            return vestingAmounts[0] - totalClaimed;
        }
        else {
            return 0;
        }
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

contract StackdPrivateSaleVestingManager is Auth {
    // TODO: Make sure we only want authorized wallets to be able to process vested tokens/busd rewards, personally
    // TODO: I think that users should at least be able to claim their BUSD
    IStackd stackd;
    mapping(address => StackdPrivateSaleVestingInstance) public vestingInstances;
    mapping(uint => address) public idToInstance;
    StackdPrivateSaleVestingInstance[] instancesList;


    constructor(address _stackd) Auth(msg.sender) {
        stackd = IStackd(_stackd);
    }

    function authorizeInstance(address _instanceAddress, address _authorizedAddress) external authorized {
        StackdPrivateSaleVestingInstance instance = StackdPrivateSaleVestingInstance(_instanceAddress);
        instance.authorize(_authorizedAddress);
    }

    function processInstance(address user) external authorized {
        StackdPrivateSaleVestingInstance instance = vestingInstances[user];
        instance.claimStackd();
    }

    function getAllInstances() external view returns(StackdPrivateSaleVestingInstance[] memory) {
        return instancesList;
    }

    function getAllAmountsForUser(address user) external view returns (uint, uint, uint){
        StackdPrivateSaleVestingInstance instance = vestingInstances[user];
        return instance.getAllAmounts();
    }

    function processMultipleInstances(uint start, uint end) external authorized {
        for (uint i = start; i <= end; i++) {
            StackdPrivateSaleVestingInstance instance = instancesList[i];
            instance.claimStackd();
        }
    }

    function cancelVestingInstance(address instanceAddress) external authorized {
        StackdPrivateSaleVestingInstance instance = StackdPrivateSaleVestingInstance(instanceAddress);
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
        StackdPrivateSaleVestingInstance instance = vestingInstances[user];
        instance.claimBUSD();
    }

    function processMultipleOwedBUSD(uint start, uint end) external authorized {
        for (uint i = start; i <= end; i++) {
            StackdPrivateSaleVestingInstance instance = instancesList[i];
            instance.claimBUSD();
        }
    }

    function _startVesting(StackdPrivateSaleVestingInstance instance) internal {
        instance.startVesting();
    }

    function startSingleVesting(StackdPrivateSaleVestingInstance instance) external authorized {
        _startVesting(instance);
    }

    function startMultipleVesting(uint start, uint end) external authorized {
        for (uint i = start; i <= end; i++) {
            StackdPrivateSaleVestingInstance instance = instancesList[i];
            _startVesting(instance);
        }
    }

    function createVestingInstance(address beneficiary, uint amount) external authorized {
        StackdPrivateSaleVestingInstance newInstance = new StackdPrivateSaleVestingInstance(address(stackd), amount, beneficiary);
        idToInstance[instancesList.length] = address(newInstance);
        instancesList.push(newInstance);
        vestingInstances[beneficiary] = newInstance;
        require(stackd.transferFrom(msg.sender, address(newInstance), amount), "Stackd Transfer Failed");
    }

}
