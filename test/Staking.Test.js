const { assert } = require("chai");
const Console = require("console");
const fs = require('fs');
const truffleAssert = require('truffle-assertions');
require("chai")
    .use(require("chai-as-promised"))
    .should()

const StackedFinance = artifacts.require('STACKDFinance');
const DividendDistributor = artifacts.require('DividendDistributor');
const StackdStaking = artifacts.require('StackdStaking');
const XStackd = artifacts.require('XSTACKD');

const IERC20 = JSON.parse(fs.readFileSync('./build/contracts/IERC20Extended.json', 'utf8'));
const ierc20_abi = IERC20.abi;
const router_file = JSON.parse(fs.readFileSync('./build/contracts/IPancakeRouter02.json', 'utf8'));
const router_abi = router_file.abi;
const lp = JSON.parse(fs.readFileSync('./build/contracts/IPancakePair.json', 'utf8'));
const lp_abi = lp.abi;


const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const BNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const ROUTER_ADDRESS = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const busd = new web3.eth.Contract(ierc20_abi, "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56");
const router = new web3.eth.Contract(router_abi, ROUTER_ADDRESS);

const timeMachine = require('ganache-time-traveler');
const {swap} = require("truffle/build/11.bundled");
const {one} = require("truffle/build/672.bundled");
const three_block = 9;
const one_day = 86400;

let liquidityPool;
let dividendDistributor;

contract('Stacked Finance Contract Test', async accounts => {

    before(async() => {
        console.log("Deploying Contracts");
        stacked = await StackedFinance.new();
        console.log("Stacked Deployed At:", stacked.address);
        const pairAddress = await stacked.pair();
        console.log("LP Address:", pairAddress);
        liquidityPool = new web3.eth.Contract(lp_abi, pairAddress);
        const distributorAddress = await stacked.distributor();
        dividendDistributor = await DividendDistributor.at(distributorAddress);
        console.log("Distributor Address:", dividendDistributor.address);
        const rewardToken = await dividendDistributor.rewardToken();
        console.log("Reward Token", rewardToken);
        xstackd = await XStackd.new();
        console.log("XStackd Deployed To", xstackd.address);
        staking = await StackdStaking.new(stacked.address, xstackd.address, accounts[0]);
        console.log("Staking Address: ", staking.address);
    });

    it('Initial Checks', async() => {
        let bal = await stacked.balanceOf(accounts[0]);
        console.log("BAL", bal.toString())
        assert.equal(bal, web3.utils.toWei("20000000000", "ether"));

    });

    it('Burn', async() => {
        await stacked.transfer(DEAD_ADDRESS, web3.utils.toWei("10000000000", 'ether'));
        let bal = await stacked.balanceOf(accounts[0]);
        assert.equal(bal, web3.utils.toWei("10000000000", "ether"));
        let supply = await stacked.getCirculatingSupply()
        assert.equal(supply, web3.utils.toWei("10000000000", "ether"));
    });

    it('Add Liqudity', async() => {
        await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('1250000000', 'ether'));
        let block = await web3.eth.getBlock('latest');
        await router.methods.addLiquidityETH(
            stacked.address,
            web3.utils.toWei("1250000000", "ether"),
            0,
            web3.utils.toWei("500", "ether"),
            accounts[0],
            block.timestamp + 1000
        ).send({value: web3.utils.toWei("500", "ether"), from:accounts[0], gas:20000000});
    });

    // it('Cant trade before trading is enabled', async() => {
    //     let block = await web3.eth.getBlock('latest');
    //     await truffleAssert.reverts(
    //         router.methods.swapExactETHForTokensSupportingFeeOnTransferTokens(
    //             web3.utils.toWei("1000", 'ether'),
    //             [BNB_ADDRESS, stacked.address],
    //             accounts[1],
    //             block.timestamp+1000
    //         ).send({value:web3.utils.toWei("1","ether"), from:accounts[1]})
    //     );
    // });

    it('Anti-Bot Measures Check', async() => {
        await stacked.enableTrading(3, 9500);
        let block = await web3.eth.getBlock('latest');
        //console.log("Enabled Block:", block.number);
        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('100', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[1],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("100", 'ether'), from:accounts[1], gas: 20000000});
        let userBal = await stacked.balanceOf(accounts[1]);
        assert.equal(userBal, web3.utils.toWei('5', 'ether'));
        let contractBal = await stacked.balanceOf(stacked.address);
        assert.equal(contractBal, web3.utils.toWei('95', 'ether'));
    });

    it('Users can buy normally after 3 blocks', async() => {
        await timeMachine.advanceTime(12);
        await timeMachine.advanceBlock();

        let block = await web3.eth.getBlock('latest');
        console.log("Current Block:", block.number);

        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('100', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[2],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("100", 'ether'), from:accounts[2], gas: 20000000});
        let userBal = await stacked.balanceOf(accounts[2]);
        assert.equal(userBal, web3.utils.toWei('80', 'ether'));
        let contractBal = await stacked.balanceOf(stacked.address);
        assert.equal(contractBal, web3.utils.toWei('115', 'ether'));
    });

    it('Create Standard Staking Pools', async() => {
        await xstackd.transferOwnership(staking.address);
        await stacked.approve(staking.address, web3.utils.toWei('10000000000', 'ether'));
        await xstackd.approve(staking.address, web3.utils.toWei('10000000000', 'ether'));

        // Standard Pools
        await staking.createPool(one_day * 30, web3.utils.toWei('12493.1506849315', 'ether'), web3.utils.toWei('12493150.6849315000', 'ether'), web3.utils.toWei('6080000', 'ether'), 82000, 82, 50000);
        await staking.createPool(one_day * 45, web3.utils.toWei('18739.7260273973', 'ether'), web3.utils.toWei('22487671.2328767000', 'ether'), web3.utils.toWei('6080000', 'ether'), 148000, 12, 50000);
        await staking.createPool(one_day * 60, web3.utils.toWei('24986.3013698630', 'ether'), web3.utils.toWei('32482191.7808219000', 'ether'), web3.utils.toWei('6080000', 'ether'), 214000, 16, 50000);

        // (82 * 1000000) / 100000
        //Active Pools
        // let active = await staking.getActivePools();
        // console.log(active)
        // let thirty_day = await staking.all_pools(0);
        // console.log(thirty_day);
        // let fourfive_day = await staking.all_pools(1);
        // console.log(fourfive_day);
        // let sixty_day = await staking.all_pools(2);
        // console.log(sixty_day);
        await stacked.transfer(accounts[3], web3.utils.toWei('1500000', 'ether'));
        await stacked.transfer(accounts[4], web3.utils.toWei('1500000', 'ether'));
        await stacked.transfer(accounts[5], web3.utils.toWei('1500000', 'ether'));
    });

    it('User can create a stake', async() => {
        await stacked.approve(staking.address, web3.utils.toWei('10000000000', 'ether'), {from: accounts[3]});
        await stacked.approve(staking.address, web3.utils.toWei('10000000000', 'ether'), {from: accounts[4]});
        await stacked.approve(staking.address, web3.utils.toWei('10000000000', 'ether'), {from: accounts[5]});

        await truffleAssert.reverts(
            staking.createStake(0, web3.utils.toWei('7500000', 'ether'), {from: accounts[3]})
        );

        await staking.createStake(0, web3.utils.toWei('1000000', 'ether'), {from: accounts[3]})
        let acc3_stakes = await staking.getUserStakeByPool(0, accounts[3]);
        console.log("Acc3 Stakes", acc3_stakes.amount, acc3_stakes.stackd_owed, acc3_stakes.x_stackd_owed);
        // console.log(acc3_stakes)
        // assert.equal(acc3_stakes.amount, '1000000000000000000000000')
        // assert.equal(acc3_stakes.stackd_owed, '8200000000000000000000')
        // assert.equal(acc3_stakes.x_stackd_owed, '6600000000000000000000')

        await truffleAssert.reverts(
            staking.createStake(0, web3.utils.toWei('6000000', 'ether'), {from: accounts[3]})
        );

        await truffleAssert.reverts(
            staking.claim(0, {from: accounts[3]})
        );


    });

    it('User Can emergency withdraw stake', async() => {
        let bal_before = await stacked.balanceOf(accounts[0])

        let total_before = await staking.all_pools(0)
        total_before = total_before[3]
        assert.equal(web3.utils.fromWei(total_before.toString(), 'ether').toString(), '1000000')
        let user_bal = await stacked.balanceOf(accounts[3]);
        await staking.emergencyWithdraw(0, {from: accounts[3]});

        let total_after = await staking.all_pools(0)
        total_after = total_after[3]
        assert.equal(total_after.toString(), '0');

        let staked = await staking.stakedTokens(accounts[3]);
        assert.equal(staked.toString(), '0')

        let bal_after = await stacked.balanceOf(accounts[0]);
        console.log("Staking Wallet Balance Before: ", web3.utils.fromWei(bal_before.toString(), 'ether'));
        console.log("Staking Wallet Balance After: ", web3.utils.fromWei(bal_after.toString(), 'ether'));


        console.log("User Wallet Balance Before: ", web3.utils.fromWei(user_bal.toString(), 'ether'));
        user_bal = await stacked.balanceOf(accounts[3]);
        console.log("User Wallet Balance After: ", web3.utils.fromWei(user_bal.toString(), 'ether'));
    });

    it('Creating multiple stakes in same pool claims pending and resets stake', async() => {
        let acc3_staked = await staking.stakedTokens(accounts[3]);
        assert.equal(acc3_staked, 0);

        await staking.createStake(0, web3.utils.toWei('1000000', 'ether'), {from: accounts[3]})
        acc3_staked = await staking.stakedTokens(accounts[3]);
        assert.equal(acc3_staked.toString(), '1000000000000000000000000');
        let acc3_stakes = await staking.getUserStakeByPool(0, accounts[3]);
        console.log("Acc3 Stakes", acc3_stakes.amount, acc3_stakes.stackd_owed, acc3_stakes.x_stackd_owed);
        // console.log(acc3_stakes)
        // assert.equal(acc3_stakes.amount, '1000000000000000000000000')
        // assert.equal(acc3_stakes.stackd_owed, '5800000000000000000000')
        // assert.equal(acc3_stakes.x_stackd_owed, '6600000000000000000000')
        acc3_staked = await staking.stakedTokens(accounts[3]);
        assert.equal(acc3_staked.toString(), '1000000000000000000000000')

        let cur_owed = await staking.getCurrentOwed(accounts[3], 0);
        console.log("Cur Owed", "Stackd", web3.utils.fromWei(cur_owed.owed_stackd), "X_stackd", web3.utils.fromWei(cur_owed.owed_x_stackd));

        await timeMachine.advanceTime(one_day);
        await timeMachine.advanceBlock();

        cur_owed = await staking.getCurrentOwed(accounts[3], 0);
        console.log("Cur Owed", "Stackd", web3.utils.fromWei(cur_owed.owed_stackd), "X_stackd", web3.utils.fromWei(cur_owed.owed_x_stackd));

        let stackd_before = await stacked.balanceOf(accounts[3]);
        let x_stackd_before = await xstackd.balanceOf(accounts[3]);
        console.log("Balances Before", "Stackd: ", stackd_before.toString(), "XStackd: ", x_stackd_before.toString());

        await staking.createStake(0, web3.utils.toWei('100000', 'ether'), {from: accounts[3]})
        stackd_before = await stacked.balanceOf(accounts[3]);
        x_stackd_before = await xstackd.balanceOf(accounts[3]);
        console.log("Balances After Restake", "Stackd: ", stackd_before.toString(), "XStackd: ", x_stackd_before.toString());
        acc3_stakes = await staking.getUserStakeByPool(0, accounts[3]);
        console.log("Acc3 Stakes", acc3_stakes.amount, acc3_stakes.stackd_owed, acc3_stakes.x_stackd_owed);
        // assert.equal(acc3_stakes.amount, '1100000000000000000000000')
        // assert.equal(acc3_stakes.stackd_owed, '6380000000000000000000')
        // assert.equal(acc3_stakes.x_stackd_owed, '7260000000000000000000')
        acc3_staked = await staking.stakedTokens(accounts[3]);
        console.log("Acc3 Total", acc3_staked.toString())
        assert.equal(acc3_staked.toString(), '1100000000000000000000000')

        cur_owed = await staking.getCurrentOwed(accounts[3], 0);
        console.log("Cur Owed", "Stackd", web3.utils.fromWei(cur_owed.owed_stackd), "X_stackd", web3.utils.fromWei(cur_owed.owed_x_stackd));
    });

    it('after time passes user can claim stake', async() => {
        await timeMachine.advanceTime(one_day * 30);
        await timeMachine.advanceBlock();

        let cur_owed = await staking.getCurrentOwed(accounts[3], 0)
        console.log("Cur Owed", "Stackd", web3.utils.fromWei(cur_owed.owed_stackd), "X_stackd", web3.utils.fromWei(cur_owed.owed_x_stackd));

        let bal = await stacked.balanceOf(accounts[3]);
        let bal_x = await xstackd.balanceOf(accounts[3]);
        console.log("Stackd Bal Before: ", web3.utils.fromWei(bal.toString(), 'ether'));
        console.log("X Stackd Bal Before: ", web3.utils.fromWei(bal_x.toString(), 'ether'));

        await staking.claim(0, {from: accounts[3]});

        bal = await stacked.balanceOf(accounts[3]);
        bal_x = await xstackd.balanceOf(accounts[3]);

        console.log("Stackd Bal After: ", web3.utils.fromWei(bal.toString(), 'ether'));
        console.log("X Stackd Bal After: ", web3.utils.fromWei(bal_x.toString(), 'ether'));

        let user_stakes = await staking.getUserStakeByPool(0, accounts[3]);
        console.log(user_stakes)
    });


    // it('Multiple Users Create Stakes', async() => {
    //     await stacked.transfer(accounts[6], web3.utils.toWei('1500000', 'ether'));
    //     await stacked.transfer(accounts[7], web3.utils.toWei('1500000', 'ether'));
    //     await stacked.transfer(accounts[8], web3.utils.toWei('1500000', 'ether'));
    //     await stacked.approve(staking.address, web3.utils.toWei('10000000000', 'ether'), {from: accounts[6]});
    //     await stacked.approve(staking.address, web3.utils.toWei('10000000000', 'ether'), {from: accounts[7]});
    //     await stacked.approve(staking.address, web3.utils.toWei('10000000000', 'ether'), {from: accounts[8]});
    //
    //     await staking.createStake(0, web3.utils.toWei('1000000', 'ether'), {from: accounts[3]})
    //     await staking.createStake(0, web3.utils.toWei('1000000', 'ether'), {from: accounts[4]})
    //     await staking.createStake(0, web3.utils.toWei('1000000', 'ether'), {from: accounts[5]})
    //     await staking.createStake(0, web3.utils.toWei('1000000', 'ether'), {from: accounts[6]})
        //
        // let acc_3 = await getUserStakes(accounts[3]);
        // let acc_4 = await getUserStakes(accounts[4]);
        // let acc_5 = await getUserStakes(accounts[5]);
        // let acc_6 = await getUserStakes(accounts[6]);
    //
    //
    // });

    it('', async() => {

    });

    it('', async() => {

    });

});
