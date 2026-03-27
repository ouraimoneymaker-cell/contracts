import { UTest } from 'atma-utest';
import { $hh } from '../utils/$hh';
import { $tranche } from '../utils/$tranche';
import { $erc20 } from '../utils/$erc20';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { $erc4626 } from '../utils/$erc4626';
import { $promise } from 'dequanto/utils/$promise';

const test = await $hh.create('mhyper');

const {
    mHYPER,
    USDC,
    oracle,
    accounting,
    jrtVault,
    feed,
    redemptionVault,
    unstakeCooldown,
    cdo,
} = await test.deploy({ initialDeposit: false });

const { deployer, client } = test;

UTest.create({
    async $before () {
        await feed.$receipt().setRoundStaleAfter(deployer, BigInt($date.parseTimespan('5years', { get:'s' })));
        await oracle.$receipt().setRoundData(deployer, 1n, BigInt(1e8), BigInt($date.toUnixTimestamp()));
        await setAPRs(0, 0);
        await test.snapshot('midas');
    },

    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('midas');
    },
    async '// (no-instant-redeem) should redeem instant' () {
        await $erc20.mint(USDC, deployer, deployer, 11);

        await $tranche.deposit(jrtVault, deployer, USDC, 4.1);
        await $erc20.eqBalance(USDC, deployer, 6.9);

        await redemptionVault.$receipt().setInstantEnabled(deployer, true);
        await redemptionVault.$receipt().setOracle(deployer, oracle.address);

        await $erc4626.redeem(jrtVault, deployer, 3.1);
        await $erc20.eqBalance(USDC, deployer, 10);
    },
     async 'should redeem request' () {
        await $erc20.mint(USDC, deployer, deployer, 11);

        await $tranche.deposit(jrtVault, deployer, USDC, 4.1);
        await $erc20.eqBalance(USDC, deployer, 6.9);

        await redemptionVault.$receipt().setInstantEnabled(deployer, false);
        await redemptionVault.$receipt().setOracle(deployer, oracle.address);

        const exitMode = await cdo.calculateExitMode(jrtVault.address, deployer.address);
        await $erc4626.redeem(jrtVault, deployer, 3.1);
        await $erc20.eqBalance(USDC, deployer, 6.9);

        let balance = await unstakeCooldown.balanceOf(mHYPER.address, deployer.address);

        let assetsExpected = BigInt(3.1e6) * (BigInt(1e18) - exitMode.fee) / BigInt(1e18);
        $require.eq(balance.pending, assetsExpected);

        await test.mine('3days');

        balance = await unstakeCooldown.balanceOf(mHYPER.address, deployer.address);
        $require.eq(balance.claimable, assetsExpected);

        let { error } = await $promise.caught(unstakeCooldown.$receipt().finalize(deployer, mHYPER.address, deployer.address));
        $require.match(/NothingToFinalize/, error?.message);

        await redemptionVault.$receipt().fulfillRequest(deployer, 0n);
        await unstakeCooldown.$receipt().finalize(deployer, mHYPER.address, deployer.address);
        await $erc20.eqBalance(USDC, deployer, BigInt(6.9e6) + assetsExpected);
    },

});


async function setAPRs(aprTarget: number, aprBase: number) {
    const block = await client.getBlock('latest');
    await feed.$receipt().updateRoundData(deployer, aprTarget * 10**12, aprBase * 10**12, block.timestamp);
    await accounting.$receipt().onAprChanged(deployer);
}

async function setOraclePrice(price: number) {
    const block = await client.getBlock('latest');
    await oracle.$receipt().setRoundData(deployer, 1n, $bigint.toWei(price, 8), BigInt(block.timestamp));
}
