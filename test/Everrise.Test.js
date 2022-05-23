const { assert } = require("chai");
const Console = require("console");
const fs = require('fs');
const truffleAssert = require('truffle-assertions');
require("chai")
    .use(require("chai-as-promised"))
    .should()

const StackedFinance = artifacts.require('STACKDFinance');
const DividendDistributor = artifacts.require('DividendDistributor');
const EverriseDistributor = artifacts.require('EverriseDistributor')

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

    before(async () => {
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
        everriseDistributor = await EverriseDistributor.new(ROUTER_ADDRESS, distributorAddress);
        console.log("Everrise Distributor", everriseDistributor.address);

    });

    it('Initial Checks', async () => {
        let bal = await stacked.balanceOf(accounts[0]);
        console.log("BAL", bal.toString())
        assert.equal(bal, web3.utils.toWei("20000000000", "ether"));
        let t = await everriseDistributor.rewardToken()
        console.log(t)
    });

    it('Burn', async () => {
        await stacked.transfer(DEAD_ADDRESS, web3.utils.toWei("10000000000", 'ether'));
        let bal = await stacked.balanceOf(accounts[0]);
        assert.equal(bal, web3.utils.toWei("10000000000", "ether"));
        let supply = await stacked.getCirculatingSupply()
        assert.equal(supply, web3.utils.toWei("10000000000", "ether"));
    });

    it('Add Liqudity', async () => {
        await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('1250000000', 'ether'));
        let block = await web3.eth.getBlock('latest');
        await router.methods.addLiquidityETH(
            stacked.address,
            web3.utils.toWei("1250000000", "ether"),
            0,
            web3.utils.toWei("500", "ether"),
            accounts[0],
            block.timestamp + 1000
        ).send({value: web3.utils.toWei("500", "ether"), from: accounts[0], gas: 20000000});
    });

    it('Cant trade before trading is enabled', async () => {
        let block = await web3.eth.getBlock('latest');
        await truffleAssert.reverts(
            router.methods.swapExactETHForTokensSupportingFeeOnTransferTokens(
                web3.utils.toWei("1000", 'ether'),
                [BNB_ADDRESS, stacked.address],
                accounts[1],
                block.timestamp + 1000
            ).send({value: web3.utils.toWei("1", "ether"), from: accounts[1]})
        );
    });

    it('Anti-Bot Measures', async () => {
        await stacked.enableTrading(3, 9500);
        let block = await web3.eth.getBlock('latest');
        console.log("Enabled Block:", block.number);
        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('100', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[1],
            block.timestamp + 1000
        ).send({value: web3.utils.toWei("100", 'ether'), from: accounts[1], gas: 20000000});
        let userBal = await stacked.balanceOf(accounts[1]);
        assert.equal(userBal, web3.utils.toWei('5', 'ether'));
        let contractBal = await stacked.balanceOf(stacked.address);
        assert.equal(contractBal, web3.utils.toWei('95', 'ether'));
    });

    it('Users can buy normally after 3 blocks', async () => {
        await timeMachine.advanceTime(12);
        await timeMachine.advanceBlock();

        let block = await web3.eth.getBlock('latest');
        console.log("Current Block:", block.number);

        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('100', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[2],
            block.timestamp + 1000
        ).send({value: web3.utils.toWei("100", 'ether'), from: accounts[2], gas: 20000000});
        let userBal = await stacked.balanceOf(accounts[2]);
        assert.equal(userBal, web3.utils.toWei('80', 'ether'));
        let contractBal = await stacked.balanceOf(stacked.address);
        assert.equal(contractBal, web3.utils.toWei('115', 'ether'));
    });

    it('Tax and reward distribution checks', async () => {
        let swapThreshold = await stacked.swapThreshold();
        console.log(web3.utils.fromWei(swapThreshold, 'ether'));
        let block = await web3.eth.getBlock('latest');
        console.log("Current Block:", block.number);

        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('5000000', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[2],
            block.timestamp + 1000
        ).send({value: web3.utils.toWei("500", 'ether'), from: accounts[2], gas: 20000000});

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

        try {
            let dist2_shares = await everriseDistributor.getShares(accounts[2])
            console.log("Dist2 Shares", dist2_shares)
        } catch (e) {
            console.log("DIST 2 ERROR", e)
        }

        let dist_shares = await dividendDistributor.shares(accounts[2])
        console.log("Dist Shares", web3.utils.fromWei(dist_shares.amount.toString(), 'ether'), dist_shares.totalExcluded.toString(), dist_shares.totalRealised.toString())



        await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('10000000000', 'ether'), {from: accounts[1]});
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


        await everriseDistributor.deposit({value: web3.utils.toWei('1', 'ether')})
        try {
            let dist2_shares = await everriseDistributor.getShares(accounts[2])
            console.log("Dist2 Shares", dist2_shares)
        } catch (e) {
            console.log("DIST 2 ERROR", e)
        }

        let dist2_bal = await busd.methods.balanceOf(everriseDistributor.address).call();

    });

    it('Distributor 2 Exclusion checks', async() => {
        await stacked.transfer(accounts[1], web3.utils.toWei('1000000', 'ether'));

    });

    it('', async() => {

    });

    it('', async() => {

    });

    it('', async() => {

    });

});
