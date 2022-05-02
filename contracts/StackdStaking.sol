// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract StackdStaking is Ownable {
    using Counters for Counters.Counter;

    struct pool {
        uint duration;
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
    address public staking_wallet;

    uint public constant DENOMINATOR = 10000;

    uint[] public active_pools;

    uint[] public empty_pools;

    mapping(uint => pool) public all_pools;
    mapping(address => stake[]) public user_stakes;


    constructor(address _STACKD, address _XSTACKD, address _staking_wallet) {
        STACKD = _STACKD;
        XSTACKD = _XSTACKD;
        staking_wallet = _staking_wallet;
    }

    function getActivePools() external view returns(uint[] memory) {
        return active_pools;
    }

    function getUserStakes(address user) external view returns(stake[] memory) {
        return user_stakes[user];
    }

    function createPool(uint _duration, uint _total_x_stackd, uint _total_stackd, uint _wallet_max_stake, uint _stackd_rate, uint _x_stackd_rate, uint _penalty) external onlyOwner {
        // Transfer & Mint Rewards
        require(IERC20(STACKD).transferFrom(msg.sender, address(this), _total_stackd), "Funding failed");
        ERC20PresetMinterPauser(XSTACKD).mint(address(this), _total_x_stackd);

        // Set Pool
        pool memory newPool;
        newPool.duration = _duration;
        newPool.total_stackd = _total_stackd;
        newPool.total_x_stackd = _total_x_stackd;
        newPool.wallet_max_stake = _wallet_max_stake;
        newPool.id = pool_index.current();
        newPool.stackd_rate = _stackd_rate;
        newPool.x_stackd_rate = _x_stackd_rate;
        newPool.penalty = _penalty;

        active_pools.push(pool_index.current());
        all_pools[pool_index.current()] = newPool;

        pool_index.increment();
    }

    function createStake(uint poolId, uint stake_amount) external {
        require(IERC20(STACKD).balanceOf(msg.sender) - stakedTokens(msg.sender) >= stake_amount, "Not enough unstaked tokens");

        stake[] memory existingStakes = user_stakes[msg.sender];
        uint currentStake;
        if (existingStakes.length > 0) {
            for (uint i = 0; i < existingStakes.length; i++) {
                if (existingStakes[i].pool == poolId) {
                    currentStake += existingStakes[i].amount;
                }
            }
        }

        pool memory targetPool = all_pools[poolId];
        require(currentStake + stake_amount <= targetPool.wallet_max_stake, "Over Pool Wallet Staking Limit");
        require(((targetPool.total_deposited + stake_amount) * targetPool.stackd_rate) / 10000 <= targetPool.total_stackd, "Not enough space in pool");
        all_pools[poolId].total_deposited += stake_amount;

        // Set Stake
        stake memory newStake;
        newStake.amount = stake_amount;
        newStake.start = block.timestamp;
        newStake.end = block.timestamp + targetPool.duration;
        newStake.stackd_owed = (stake_amount * targetPool.stackd_rate) / DENOMINATOR;
        newStake.x_stackd_owed = (stake_amount * targetPool.x_stackd_rate) / DENOMINATOR;
        newStake.pool = poolId;

        user_stakes[msg.sender].push(newStake);
    }


    function claim(uint stakeIndex) public {
        stake memory userStake = user_stakes[msg.sender][stakeIndex];
        require(block.timestamp >= userStake.end, "Staking period has not finished");

        // Remove stake
        user_stakes[msg.sender][stakeIndex] = user_stakes[msg.sender][user_stakes[msg.sender].length - 1];
        user_stakes[msg.sender].pop();

        // Transfer Rewards
        require(IERC20(STACKD).transfer(msg.sender, userStake.stackd_owed), "Stackd Transfer Failed");
        require(ERC20PresetMinterPauser(XSTACKD).transfer(msg.sender, userStake.x_stackd_owed), "XStacked transfer failed");
    }

    function emergencyWithdraw(uint stakeIndex) external {
        stake memory userStake = user_stakes[msg.sender][stakeIndex];
        if (block.timestamp >= userStake.end) {
            claim(stakeIndex);
        }
        else {
            // Remove stake
            user_stakes[msg.sender][stakeIndex] = user_stakes[msg.sender][user_stakes[msg.sender].length - 1];
            user_stakes[msg.sender].pop();

            // Take Penalty
            uint penalty = (userStake.amount * all_pools[userStake.pool].penalty) / DENOMINATOR;
            require(IERC20(STACKD).transferFrom(msg.sender, staking_wallet, penalty), "Penalty Transfer Failed");

            // Didnt recieve rewards, remove from total pool deposit
            all_pools[userStake.pool].total_deposited -= userStake.amount;
        }
    }

    function calcPenalty(uint stakeIndex, address user) external view returns (uint){
        stake memory userStake = user_stakes[user][stakeIndex];
//        if (user_stakes[user].length == 0) {
//            user_stakes[user].pop();
//        }
//        else {
//            user_stakes[user][stakeIndex] = user_stakes[user][user_stakes[user].length - 1];
//            user_stakes[user].pop();
//        }
        uint penalty = (userStake.amount * all_pools[userStake.pool].penalty) / DENOMINATOR;
        return penalty;
    }


    function stakedTokens(address user) public view returns (uint) {
        uint totalStake;
        stake[] memory existingStakes = user_stakes[user];
        if (existingStakes.length == 0) {
            return 0;
        }
        else {
            for (uint i = 0; i < existingStakes.length; i++) {
                totalStake += existingStakes[i].amount;
            }
            return totalStake;
        }
    }
}
