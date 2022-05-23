const { assert } = require("chai");
const Console = require("console");
const fs = require('fs');
const truffleAssert = require('truffle-assertions');
require("chai")
    .use(require("chai-as-promised"))
    .should()

const StackedFinance = artifacts.require('STACKDFinance');
const DividendDistributor = artifacts.require('DividendDistributor');

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
const three_block = 9;

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

    it('Cant trade before trading is enabled', async() => {
        let block = await web3.eth.getBlock('latest');
        await truffleAssert.reverts(
            router.methods.swapExactETHForTokensSupportingFeeOnTransferTokens(
                web3.utils.toWei("1000", 'ether'),
                [BNB_ADDRESS, stacked.address],
                accounts[1],
                block.timestamp+1000
            ).send({value:web3.utils.toWei("1","ether"), from:accounts[1]})
        );
    });

    it('Anti-Bot Measures', async() => {
        await stacked.enableTrading(3, 9500);
        let block = await web3.eth.getBlock('latest');
        console.log("Enabled Block:", block.number);
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

    // it('Sell Check', async() => {
    //     await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('10000000000', 'ether'), {from:accounts[1]})
    //     let block = await web3.eth.getBlock('latest');
    //
    //     await router.methods.swapExactTokensForETHSupportingFeeOnTransferTokens(
    //         web3.utils.toWei('5', 'ether'),
    //         0,
    //         [stacked.address, BNB_ADDRESS],
    //         accounts[1],
    //         block.timestamp + 1000
    //     ).send({from: accounts[1], gas: 20000000});
    // });

    it('Tax and reward distribution checks', async() => {
        let swapThreshold = await stacked.swapThreshold();
        console.log(web3.utils.fromWei(swapThreshold, 'ether'));
        let block = await web3.eth.getBlock('latest');
        console.log("Current Block:", block.number);

        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('5000000', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[2],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("500", 'ether'), from:accounts[2], gas: 20000000});

        let contractBal = await stacked.balanceOf(stacked.address);
        let ac1_busd_before = await busd.methods.balanceOf(accounts[1]).call();
        let ac2_busd_before = await busd.methods.balanceOf(accounts[2]).call();
        let distributor_busd_before = await busd.methods.balanceOf(dividendDistributor.address).call();
        let contract_bnb_before = await web3.eth.getBalance(stacked.address);
        let marketing_before = await web3.eth.getBalance(accounts[18]);
        let staking_before = await stacked.balanceOf(accounts[19]);

        console.log("Contract Bal Before", web3.utils.fromWei(contractBal, 'ether'));
        console.log("Acc1 BUSD Before", ac1_busd_before.toString())
        console.log("Acc2 BUSD Before", ac2_busd_before.toString())
        console.log("Distributor BUSD Before", distributor_busd_before.toString())
        console.log("Contract BNB Before", contract_bnb_before.toString())
        console.log("Marketing BNB Before", web3.utils.fromWei(marketing_before.toString(), 'ether'));
        console.log("Staking Token Before", staking_before.toString())

        await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('10000000000', 'ether'), {from:accounts[1]});
        block = await web3.eth.getBlock('latest');
        await router.methods.swapExactTokensForETHSupportingFeeOnTransferTokens(
            web3.utils.toWei('5', 'ether'),
            0,
            [stacked.address, BNB_ADDRESS],
            accounts[1],
            block.timestamp + 1000
        ).send({from: accounts[1], gas: 20000000});

        contractBal = await stacked.balanceOf(stacked.address);
        ac1_busd_before = await busd.methods.balanceOf(accounts[1]).call();
        ac2_busd_before = await busd.methods.balanceOf(accounts[2]).call();
        distributor_busd_before = await busd.methods.balanceOf(dividendDistributor.address).call();
        contract_bnb_before = await web3.eth.getBalance(stacked.address);
        marketing_before = await web3.eth.getBalance(accounts[18]);
        staking_before = await stacked.balanceOf(accounts[19]);

        console.log("Contract Bal After", web3.utils.fromWei(contractBal, 'ether'));
        console.log("Acc1 BUSD After", web3.utils.fromWei(ac1_busd_before.toString(), 'ether'));
        console.log("Acc2 BUSD After", web3.utils.fromWei(ac2_busd_before.toString(), 'ether'));
        console.log("Distributor BUSD After", web3.utils.fromWei(distributor_busd_before.toString(), 'ether'));
        console.log("Contract BNB After", web3.utils.fromWei(contract_bnb_before.toString(), 'ether'));
        console.log("Marketing BNB After", web3.utils.fromWei(marketing_before.toString(), 'ether'));
        console.log("Staking Token After", web3.utils.fromWei(staking_before.toString(), 'ether'));

        let totalDiv = await dividendDistributor.totalDividends()
        console.log("Total Dividends", web3.utils.fromWei(totalDiv, 'ether'))
        let distributedDiv = await dividendDistributor.totalDistributed()
        console.log("Total Distributed", web3.utils.fromWei(distributedDiv, 'ether'))
    });

    it('Sell All Tokens', async() => {
        let block = await web3.eth.getBlock('latest');
        let acc2_bal = await stacked.balanceOf(accounts[2]);
        await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('10000000000', 'ether'), {from:accounts[2]});
        await router.methods.swapExactTokensForETHSupportingFeeOnTransferTokens(
            acc2_bal,
            0,
            [stacked.address, BNB_ADDRESS],
            accounts[2],
            block.timestamp + 1000
        ).send({from: accounts[2], gas: 20000000});
        acc2_bal = await stacked.balanceOf(accounts[2]);
        assert.equal(acc2_bal.toString(), "0");
    });


    it('Auth Testing, Change Fees to Half', async() => {
        await stacked.authorize(accounts[18]);
        await stacked.setFees(100, 50, 750, 50, 50, 10000, {from: accounts[18]});
        let liq = await stacked.liquidityFee();
        let buyback = await stacked.buybackFee();
        let refelction = await stacked.reflectionFee();
        let marketing = await stacked.marketingFee();
        let staking = await stacked.stakingFee();
        let total = await stacked.totalFee();

        console.log(liq.toString(), buyback.toString(), refelction.toString(), marketing.toString(), staking.toString(), total.toString());
        let block = await web3.eth.getBlock('latest');
        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('100', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[2],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("100", 'ether'), from:accounts[2], gas: 20000000});
        let userBal = await stacked.balanceOf(accounts[2]);
        assert.equal(userBal, web3.utils.toWei('90', 'ether'));

    });

    it('Check Sell Multiplier', async() => {
        await stacked.setSellMultiplier(true, 2);
        let contractBefore = await stacked.balanceOf(stacked.address);
        let block = await web3.eth.getBlock('latest');
        let acc2_bal = await stacked.balanceOf(accounts[2]);
        console.log("Acc2 Balance", acc2_bal.toString());
        console.log("Contract Before", contractBefore.toString());
        await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('10000000000', 'ether'), {from:accounts[2]});
        await router.methods.swapExactTokensForETHSupportingFeeOnTransferTokens(
            acc2_bal,
            0,
            [stacked.address, BNB_ADDRESS],
            accounts[2],
            block.timestamp + 1000
        ).send({from: accounts[2], gas: 20000000});
        acc2_bal = await stacked.balanceOf(accounts[2]);
        assert.equal(acc2_bal.toString(), "0");
        let contractAfter = await stacked.balanceOf(stacked.address);
        console.log("Contract After",contractAfter.toString());
        console.log("Diff", web3.utils.fromWei(contractAfter, "ether") - web3.utils.fromWei(contractBefore, "ether"));


        await stacked.setSellMultiplier(false, 1);
        await stacked.setFees(200, 100, 1500, 100, 100, 10000);
        //TODO: CHECK FEES ARE RESET ACCURATELY

    });

    it('Ensure Fees are reset appropriately', async() => {
        let block = await web3.eth.getBlock('latest');
        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('5000000', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[3],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("500", 'ether'), from:accounts[3], gas: 20000000});
        let userBal = await stacked.balanceOf(accounts[3]);
        console.log("Acc3 after fees reset",userBal.toString());

        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('5000000', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[4],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("500", 'ether'), from:accounts[4], gas: 20000000});

        let contractFees = await stacked.balanceOf(stacked.address);
        console.log("Contract Bal", web3.utils.fromWei(contractFees, 'ether'));

    });

    it('Test Buyback and burn', async() => {
        let contractBNB = await web3.eth.getBalance(stacked.address);
        console.log("Contract BNB", contractBNB.toString());
        let deadAddress = await stacked.DEAD();
        console.log(deadAddress);
        let deadBefore = await stacked.balanceOf(deadAddress);
        await stacked.triggerManualBuyback(contractBNB);
        let deadAfter = await stacked.balanceOf(deadAddress);
        console.log("ContractBNB", web3.utils.fromWei(contractBNB, "ether"));
        console.log("DeadBefore", web3.utils.fromWei(deadBefore,'ether'));
        console.log("DeadAfter", web3.utils.fromWei(deadAfter, "ether"));
    });

    it('Test User Claim Dividends', async() => {
        let block = await web3.eth.getBlock('latest');
        // await router.methods.swapETHForExactTokens(
        //     web3.utils.toWei('2000000', 'ether'),
        //     [BNB_ADDRESS, stacked.address],
        //     accounts[4],
        //     block.timestamp+1000
        // ).send({value:web3.utils.toWei("900", 'ether'), from:accounts[4], gas: 20000000});

        let contractBalance = await stacked.balanceOf(stacked.address);
        console.log("Contract Before Sell", web3.utils.fromWei(contractBalance, 'ether'));

        let acc4_owed_before = await stacked.getUnpaidDividend(accounts[4]);
        console.log("Acc4 Owed Before Sell", web3.utils.fromWei(acc4_owed_before, 'ether'));

        let acc3_bal = await stacked.balanceOf(accounts[3]);
        console.log("Acc3 Balance", acc3_bal.toString());
        await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('10000000000', 'ether'), {from:accounts[3]});

        while(web3.utils.fromWei(contractBalance, 'ether') > 1000000) {
            await router.methods.swapExactTokensForETHSupportingFeeOnTransferTokens(
                web3.utils.toWei('5', 'ether'),
                0,
                [stacked.address, BNB_ADDRESS],
                accounts[3],
                block.timestamp + 1000
            ).send({from: accounts[3], gas: 20000000});
            contractBalance = await stacked.balanceOf(stacked.address);
            console.log("Contract After Sell", web3.utils.fromWei(contractBalance, 'ether'));
        }

        let acc4_owed_after = await stacked.getUnpaidDividend(accounts[4]);
        console.log("Acc4 Owed after Sell", web3.utils.fromWei(acc4_owed_after, 'ether'));

        let acc4_bal = await busd.methods.balanceOf(accounts[4]).call();
        console.log("Acc 4 pre claim", web3.utils.fromWei(acc4_bal));
        await stacked.claimDividend({from:accounts[4]})
        acc4_bal = await busd.methods.balanceOf(accounts[4]).call();
        console.log("Acc 4 post claim", web3.utils.fromWei(acc4_bal));
    });

    it('Users are not taxed on wallet transfers', async() => {
        let block = await web3.eth.getBlock('latest');
        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('100', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[2],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("100", 'ether'), from:accounts[2], gas: 20000000});
        let bal2 = await stacked.balanceOf(accounts[2]);
        let bal8 = await stacked.balanceOf(accounts[8]);
        let bal9 = await stacked.balanceOf(accounts[9]);
        console.log("Bal2 Before", bal2.toString());
        console.log("Bal8 Before", bal8.toString());
        console.log("Bal9 Before", bal9.toString());
        await stacked.transfer(accounts[8],bal2, {from:accounts[2]});
        bal8 = await stacked.balanceOf(accounts[8]);
        console.log("Bal8 After", bal8.toString());
        await stacked.transfer(accounts[9], bal8, {from:accounts[8]});
        bal9 = await stacked.balanceOf(accounts[9]);
        console.log("Bal9 After", bal9.toString());


    });

    it('Non Token Distribution Test', async() => {
        let owed_before = await dividendDistributor.getUnpaidEarnings(accounts[9]);
        console.log("Owed Before", web3.utils.fromWei(owed_before.toString(),'ether'));
        let bal = await busd.methods.balanceOf(dividendDistributor.address).call();
        console.log("Distributor BUSD Before", web3.utils.fromWei(bal.toString(),'ether'));

        await web3.eth.sendTransaction({
            from: accounts[0],
            to: dividendDistributor.address,
            value: web3.utils.toWei('1', 'ether'),
            gas: 20000000
        });

        let owed_after = await dividendDistributor.getUnpaidEarnings(accounts[9]);
        console.log("Owed After", web3.utils.fromWei(owed_after.toString(),'ether'));
        bal = await busd.methods.balanceOf(dividendDistributor.address).call();
        console.log("Distributor BUSD Before", web3.utils.fromWei(bal.toString(),'ether'));
    });
});
