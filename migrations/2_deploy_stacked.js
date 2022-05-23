const STACKDFinance = artifacts.require('STACKDFinance');
//const VestingManager = artifacts.require('StackdTeamVestingManager');
//const VestingManager = artifacts.require('StackdPrivateSaleVestingManager');
const STACKDStaking = artifacts.require('StackdStaking');
const XSTACKD = artifacts.require('XSTACKD');
const EVERRISE = artifacts.require('EverriseDistributor');


module.exports = function(deployer, network, accounts) {
    deployer.then(async () => {
        await deployer.deploy(STACKDFinance, {from: accounts[0], gas: 30000000});
        await deployer.deploy(XSTACKD, {from: accounts[0], gas: 30000000});
        await deployer.deploy(STACKDStaking, STACKDFinance.address, XSTACKD.address, accounts[0], {from: accounts[0], gas: 30000000});
        //await deployer.deploy(EVERRISE, {from: accounts[0], gas: 30000000});
    });
    // deployer.then(async () => {
    //     await deployer.deploy(STACKDFinance, {from: accounts[0], gas: 30000000});
    //     await deployer.deploy(VestingManager, STACKDFinance.address, {from: accounts[0], gas: 30000000});
    // });
};
