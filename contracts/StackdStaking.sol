// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./Auth.sol";

contract StackdStaking is Auth {
    using Counters for Counters.Counter;

    struct pool {
        uint staking_period;
        uint total_stackd;
        uint total_x_stackd;
        uint total_deposited;
        uint wallet_max_stake;
        uint id;
        uint stackd_rate;
        uint x_stackd_rate;
        uint penalty;
    }

    struct stake {
        uint amount;
        uint start;
        uint end;
        uint stackd_owed;
        uint x_stackd_owed;
        uint pool;
    }

    Counters.Counter public pool_index;

    address public STACKD;
    address public XSTACKD;
    address public staking_wallet = 0x550DbD64c3dA1E285A1598784013d79a84dEd60F;

    bool public freeWithdrawal;
    bool public stakingEnabled;

    uint public constant DENOMINATOR = 10000000; // Very large due to small x_stackd_rate

    uint[] public pools_list;

    uint[] public empty_pools;

    mapping(uint => pool) public all_pools;
    mapping(address => mapping(uint => stake)) public user_stakes;
    mapping(address => uint) public total_user_stakes;


    constructor(address _STACKD, address _XSTACKD) Auth(msg.sender) {
        STACKD = _STACKD;
        XSTACKD = _XSTACKD;
    }

    function getUserStakeByPool(uint poolId, address user) external view returns(stake memory) {
        stake memory userStake = user_stakes[user][poolId];
        return userStake;
    }

    function getPools() public view returns(uint[] memory) {
        return pools_list;
    }

    function getAllPools() external view returns(pool[] memory) {
        uint[] memory pools = getPools();
        pool[] memory staking_pools = new pool[](pools.length);
        for (uint i = 0; i < pools.length; i++) {
            staking_pools[i] = all_pools[i];
        }
        return staking_pools;
    }

    function getPool(uint id) external view returns(pool memory) {
        return all_pools[id];
    }

    function getSpaceInPool(uint poolId) external view returns(uint) {
        pool memory targetPool = all_pools[poolId];
        return targetPool.total_stackd - (targetPool.total_deposited * targetPool.stackd_rate) / DENOMINATOR;
    }

    // total_stackd, total_x_stackd: the amount of each respectively that will be depsosited to the pool
    function createPool(uint _staking_period, uint _total_x_stackd, uint _total_stackd, uint _wallet_max_stake, uint _stackd_rate, uint _x_stackd_rate, uint _penalty) external authorized {
        // Transfer & Mint Rewards
        require(IERC20(STACKD).transferFrom(msg.sender, address(this), _total_stackd), "Stackd Funding failed");
        require(IERC20(XSTACKD).transferFrom(msg.sender, address(this), _total_x_stackd), "XStackd Funding failed");

        // Set Pool
        pool memory newPool;
        newPool.staking_period = _staking_period;
        newPool.total_stackd = _total_stackd;
        newPool.total_x_stackd = _total_x_stackd;
        newPool.wallet_max_stake = _wallet_max_stake;
        newPool.id = pool_index.current();
        newPool.stackd_rate = _stackd_rate;
        newPool.x_stackd_rate = _x_stackd_rate;
        newPool.penalty = _penalty;

        pools_list.push(pool_index.current());
        all_pools[pool_index.current()] = newPool;

        pool_index.increment();
    }

    function claimParitalReward(address user, uint poolId) internal {
        (uint owed_stackd, uint owed_x_stackd) = getCurrentOwed(user, poolId);

        // Transfer Rewards
        require(IERC20(STACKD).transfer(msg.sender, owed_stackd), "Stackd Transfer Failed");
        require(IERC20(XSTACKD).transfer(msg.sender, owed_x_stackd), "XStacked transfer failed");
    }

    function getCurrentOwed(address user, uint poolId) public view returns(uint owed_stackd, uint owed_x_stackd) {
        stake memory userStake = user_stakes[user][poolId];
        if (userStake.amount == 0) {
            return (owed_stackd, owed_x_stackd);
        }
        uint time_passed = block.timestamp - userStake.start;
        uint duration = userStake.end - userStake.start;
        uint owed_base_percent = (time_passed * 100000) / duration; // 100,000 used to prevent 0 return for shorter time passed (Base 100,000)

        owed_stackd = (userStake.stackd_owed * owed_base_percent) / 100000;
        owed_x_stackd = (userStake.x_stackd_owed * owed_base_percent) / 100000;
        return (owed_stackd, owed_x_stackd);
    }

    function createStake(uint poolId, uint stake_amount) external {
        require(stakingEnabled, "Staking is not enabled");
        require(IERC20(STACKD).balanceOf(msg.sender) - stakedTokens(msg.sender) >= stake_amount, "Not enough unstaked tokens");

        stake memory existingStake = user_stakes[msg.sender][poolId];
        uint currentStake = existingStake.amount;


        pool memory targetPool = all_pools[poolId];
        require(currentStake + stake_amount <= targetPool.wallet_max_stake, "Over Pool Wallet Staking Limit");
        require(((targetPool.total_deposited + stake_amount) * targetPool.stackd_rate) / DENOMINATOR <= targetPool.total_stackd, "Not enough space in pool");

        all_pools[poolId].total_deposited += stake_amount;
        total_user_stakes[msg.sender] += stake_amount;

        if (currentStake > 0) { // User has existing stake in this pool, claim pending and restake
            claimParitalReward(msg.sender, poolId);
            stake_amount = currentStake + stake_amount;
        }

        // Set Stake
        stake memory newStake;
        newStake.amount = stake_amount;
        newStake.start = block.timestamp;
        newStake.end = block.timestamp + targetPool.staking_period;
        newStake.stackd_owed = (stake_amount * targetPool.stackd_rate) / DENOMINATOR;
        newStake.x_stackd_owed = (stake_amount * targetPool.x_stackd_rate) / DENOMINATOR;
        newStake.pool = poolId;

        user_stakes[msg.sender][poolId] = newStake;
    }


    function claim(uint poolId) public {
        stake memory userStake = user_stakes[msg.sender][poolId];
        require(block.timestamp >= userStake.end, "Staking period has not finished");

        // Remove stake
        delete user_stakes[msg.sender][poolId];
        total_user_stakes[msg.sender] -= userStake.amount;

        // Transfer Rewards
        require(IERC20(STACKD).transfer(msg.sender, userStake.stackd_owed), "Stackd Transfer Failed");
        require(IERC20(XSTACKD).transfer(msg.sender, userStake.x_stackd_owed), "XStacked transfer failed");
    }

    function emergencyWithdraw(uint poolId) external {
        stake memory userStake = user_stakes[msg.sender][poolId];
        if (block.timestamp >= userStake.end) {
            claim(poolId);
        }
        else {
            // Remove stake
            delete user_stakes[msg.sender][poolId];
            total_user_stakes[msg.sender] -= userStake.amount;

            // Take Penalty
            if (!freeWithdrawal) {
                uint penalty = (userStake.amount * all_pools[userStake.pool].penalty) / DENOMINATOR;
                require(IERC20(STACKD).transferFrom(msg.sender, staking_wallet, penalty), "Penalty Transfer Failed");
            }

            // Didnt recieve rewards, remove from total pool deposit
            all_pools[userStake.pool].total_deposited -= userStake.amount;
        }
    }

    function emergencyRemoveStake(address user, uint poolId) external authorized {
        delete user_stakes[msg.sender][poolId];
        total_user_stakes[msg.sender] -= userStake.amount;
        all_pools[userStake.pool].total_deposited -= userStake.amount;
    }

    function stakedTokens(address user) public view returns (uint) {
        return total_user_stakes[user];
    }

    function setFreeWithdrawal(bool _freeWithdrawal) external authorized {
        freeWithdrawal = _freeWithdrawal;
    }

    function withdrawERC20(address _token, uint _amount) external authorized {
        require(IERC20(_token).transfer(msg.sender, _amount), "Failed to transfer");
    }

    // UnPause
    function enableStaking() external authorized {
        staking_enabled = true;
    }

    // Pause
    function disableStaking() external authorized {
        staking_enabled = false;
    }
}
