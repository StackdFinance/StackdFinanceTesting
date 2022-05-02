const { assert } = require("chai");
const Console = require("console");
const fs = require('fs');
const truffleAssert = require('truffle-assertions');
require("chai")
    .use(require("chai-as-promised"))
    .should()

const StackedFinance = artifacts.require('STACKDFinance');
const DividendDistributor = artifacts.require('DividendDistributor');
const VestingManager = artifacts.require('StackedPrivateSaleVestingManager');

const IERC20 = JSON.parse(fs.readFileSync('./build/contracts/IERC20Extended.json', 'utf8'));
const ierc20_abi = IERC20.abi;
const router_file = JSON.parse(fs.readFileSync('./build/contracts/IPancakeRouter02.json', 'utf8'));
const router_abi = router_file.abi;
const lp = JSON.parse(fs.readFileSync('./build/contracts/IPancakePair.json', 'utf8'));
const lp_abi = lp.abi;
const vesting_instance = JSON.parse(fs.readFileSync('./build/contracts/StackedPrivateSaleVestingInstance.json', 'utf8'));
const vesting_instance_abi = vesting_instance.abi;

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
let vestingInstance1;
let vestingInstance2;

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
        vestingManager = await VestingManager.new(stacked.address);
        console.log("Vesting Manager", vestingManager.address);
    });

    it('Initial Checks', async () => {
        let bal = await stacked.balanceOf(accounts[0]);
        assert.equal(bal, web3.utils.toWei("20000000000", "ether"));

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

    it('Users can buy normally after 3 blocks', async() => {
        await stacked.enableTrading(3, 9500);
        let block = await web3.eth.getBlock('latest');
        console.log("Current Block:", block.number);

        await timeMachine.advanceTime(12);
        await timeMachine.advanceBlock();
        await timeMachine.advanceBlock();
        await timeMachine.advanceBlock();

        block = await web3.eth.getBlock('latest');
        console.log("Current Block:", block.number);

        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('100', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[1],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("100", 'ether'), from:accounts[1], gas: 20000000});
        let userBal = await stacked.balanceOf(accounts[1]);
        console.log("UserBal", userBal.toString());
        //assert.equal(userBal, web3.utils.toWei('80', 'ether'));
        let contractBal = await stacked.balanceOf(stacked.address);
        console.log("Contract Bal",contractBal.toString())
        //assert.equal(contractBal, web3.utils.toWei('20', 'ether'));
    });


    it('Vesting Creation', async() => {
        await stacked.approve(vestingManager.address, web3.utils.toWei('20000000000', 'ether'));
        await vestingManager.createVestingInstance(accounts[18], web3.utils.toWei('100', 'ether'));
        await vestingManager.createVestingInstance(accounts[19], web3.utils.toWei('1000', 'ether'));

        await stacked.setIsFeeExempt(vestingManager.address, true);

        let instances = await vestingManager.getAllInstances();
        console.log("Vesting Instances", instances);


        await stacked.setIsFeeExempt(instances[0], true);
        await stacked.setIsFeeExempt(instances[1], true);

        vestingInstance1 = new web3.eth.Contract(vesting_instance_abi, instances[0]);
        vestingInstance2 = new web3.eth.Contract(vesting_instance_abi, instances[1]);

        let first = await vestingInstance1.methods.vestingAmounts(0).call();
        console.log("30 Day vesting amount", web3.utils.fromWei(first, 'ether'));

        let ben1 = await vestingInstance1.methods.beneficiary().call();
        let ben2 = await vestingInstance2.methods.beneficiary().call();
        let v1 = await vestingInstance1.methods.totalVested().call();
        let v2 = await vestingInstance2.methods.totalVested().call();
        let bal1 = await stacked.balanceOf(instances[0]);
        let bal2 = await stacked.balanceOf(instances[1]);

        assert.equal(v1, web3.utils.toWei('100', "ether"));
        assert.equal(v2, web3.utils.toWei('1000', "ether"));
        assert.equal(bal1, web3.utils.toWei('100', "ether"));
        assert.equal(bal2, web3.utils.toWei('1000', "ether"));
        assert.equal(ben1, accounts[18]);
        assert.equal(ben2, accounts[19]);


    });

    it('Start Vesting, Vesting Contracts receive rewards', async() => {
        await vestingManager.startMultipleVesting(0,1);
        let instances = await vestingManager.getAllInstances();
        vestingInstance1 = new web3.eth.Contract(vesting_instance_abi, instances[0]);
        vestingInstance2 = new web3.eth.Contract(vesting_instance_abi, instances[1]);

        let v1Before = await busd.methods.balanceOf(instances[0]).call();
        let v2Before = await busd.methods.balanceOf(instances[1]).call();
        console.log("V1 Before", web3.utils.fromWei(v1Before, 'ether'));
        console.log("V2 Before", web3.utils.fromWei(v2Before, 'ether'));

        let block = await web3.eth.getBlock('latest');
        await stacked.approve(ROUTER_ADDRESS, web3.utils.toWei('10000000000', 'ether'), {from:accounts[1]});
        await router.methods.swapETHForExactTokens(
            web3.utils.toWei('5500000', 'ether'),
            [BNB_ADDRESS, stacked.address],
            accounts[1],
            block.timestamp+1000
        ).send({value:web3.utils.toWei("600", 'ether'), from:accounts[1], gas: 20000000});
        let contractBalance = await stacked.balanceOf(stacked.address);
        while(web3.utils.fromWei(contractBalance, 'ether') > 1000000) {
            await router.methods.swapExactTokensForETHSupportingFeeOnTransferTokens(
                web3.utils.toWei('5', 'ether'),
                0,
                [stacked.address, BNB_ADDRESS],
                accounts[1],
                block.timestamp + 1000
            ).send({from: accounts[1], gas: 20000000});
            contractBalance = await stacked.balanceOf(stacked.address);
        }
        let disBal = await busd.methods.balanceOf(dividendDistributor.address).call();
        console.log("Dist Bal", web3.utils.fromWei(disBal, 'ether'));
        let owed1 = await dividendDistributor.getUnpaidEarnings(instances[0]);
        let owed2 = await dividendDistributor.getUnpaidEarnings(instances[1]);

        let v1After = await busd.methods.balanceOf(instances[0]).call();
        let v2After = await busd.methods.balanceOf(instances[1]).call();
        console.log("V1 After", web3.utils.fromWei(v1After, 'ether'));
        console.log("V2 After", web3.utils.fromWei(v2After, 'ether'));
        console.log("Owed Dividends 1: ", web3.utils.fromWei(owed1, 'ether'));
        console.log("Owed Dividends 2: ", web3.utils.fromWei(owed2, 'ether'));
    });

    it('Can Claim Vested Tokens And Dividends', async() => {
        let block = await web3.eth.getBlock('latest');
        console.log("Block Time Before: ", block.timestamp)
        await timeMachine.advanceTime(3000000);
        await timeMachine.advanceBlock();
        block = await web3.eth.getBlock('latest');
        console.log("Block Time After: ", block.timestamp)

        let instances = await vestingManager.getAllInstances();
        vestingInstance1 = new web3.eth.Contract(vesting_instance_abi, instances[0]);
        vestingInstance2 = new web3.eth.Contract(vesting_instance_abi, instances[1]);

        let allAmounts1 = await vestingManager.getAllAmountsForUser(accounts[18]);
        let allAmounts2 = await vestingManager.getAllAmountsForUser(accounts[19]);
        let instOwed1 = await vestingInstance1.methods.getClaimableAmount().call();
        let instOwed2 = await vestingInstance2.methods.getClaimableAmount().call();
        console.log("All 1", allAmounts1[0].toString(),allAmounts1[1].toString(),allAmounts1[2].toString())
        console.log("All 2", allAmounts2[0].toString(),allAmounts2[1].toString(),allAmounts2[2].toString())
        console.log("Owed 1", web3.utils.fromWei(instOwed1, 'ether'));
        console.log("Owed 2", web3.utils.fromWei(instOwed2, 'ether'));

        let bal1 = await stacked.balanceOf(accounts[18]);
        let bal2 = await stacked.balanceOf(accounts[19]);
        console.log("Stacked Bal1 Before", web3.utils.fromWei(bal1, 'ether'));
        console.log("Stacked Bal2 Before", web3.utils.fromWei(bal2, 'ether'));

        await vestingManager.processMultipleInstances(0,1, {from:accounts[0], gas:20000000})

        bal1 = await stacked.balanceOf(accounts[18]);
        bal2 = await stacked.balanceOf(accounts[19]);
        let busd1 = await busd.methods.balanceOf(accounts[18]).call();
        let busd2 = await busd.methods.balanceOf(accounts[19]).call();

        console.log("Stacked Bal1 After", web3.utils.fromWei(bal1, 'ether'));
        console.log("Stacked Bal2 After", web3.utils.fromWei(bal2, 'ether'));
        console.log("BUSD Bal1 After", web3.utils.fromWei(busd1, 'ether'));
        console.log("BUSD Bal2 After", web3.utils.fromWei(busd2, 'ether'));
    });

    it('', async() => {

    });

})
