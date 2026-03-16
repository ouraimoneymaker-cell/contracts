import { UTest } from 'atma-utest';
import { $hh } from '../utils/$hh';
import { $tranche } from '../utils/$tranche';
import { $erc20 } from '../utils/$erc20';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { l } from 'dequanto/utils/$logger';
import { TEth } from 'dequanto/models/TEth';

const test = await $hh.create('mhyper', {
    forked: 24672000,
    accounts: 'deployer',
    cdoInfo: {
        pfx: 'HhMidas'
    }
});

const {
    mHYPER,
    USDC,
    strategy,
    accounting,
    jrtVault,
    srtVault,
    depositVault,
} = await test.deploy({ initialDeposit: false });


const alice = {
    address: '0x01b8697695EAb322A339c4bf75740Db75dc9375E',
    type: 'impersonated'
} as TEth.IAccount;

UTest.create({
    async $before () {
        await test.snapshot('midas');
    },

    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('midas');
    },
    async 'should deposit USDC' () {
        await $tranche.deposit(jrtVault, alice, USDC, 3.1);
        await $erc20.eqBalance(jrtVault, alice, 3.1);

        const totalAssets = await jrtVault.totalAssets();
        $require.eq(totalAssets, BigInt(3.1e6));

        const totalSupply = await jrtVault.totalSupply();
        $require.eq(totalSupply, BigInt(3.1e18));

        l`Recheck the maxDeposit for base assset`;
        const jrtSrtRatio = $bigint.toEther(await accounting.minimumJrtSrtRatioBuffer());
        $require.eq(jrtSrtRatio, .06);

        const maxDepositSrt = $bigint.multWithFloat(totalAssets, 1/jrtSrtRatio);
        const maxDepositSrtFact = await accounting.maxDeposit(false);

        $require.eq(maxDepositSrt, maxDepositSrtFact);

        l`Deposit to Senior`;
        await $tranche.deposit(srtVault, alice, USDC, 0.2);
        await $erc20.eqBalance(srtVault, alice, 0.2);
    },
    async 'should deposit mHYPER' () {
        // Check converts and previews

        // Deposit USDC to mint mHYPER
        await USDC.$receipt().approve(alice, depositVault.address, BigInt(10e6));
        await depositVault.$receipt().depositInstant(alice, USDC.address, BigInt(10e18), 0n, `0x`);
        // JRT

        await $tranche.deposit(jrtVault, alice, mHYPER, 1.4);

        let assets = await strategy.convertToAssets(mHYPER.address, BigInt(1.4e18), 0);
        // JRT:USDC = 1:1
        await $erc20.eqBalance(jrtVault, alice, assets * 10n**12n);
        // SRT
        await $tranche.deposit(srtVault, alice, mHYPER, .7);

        assets = await strategy.convertToAssets(mHYPER.address, BigInt(0.7e18), 0);
        await $erc20.eqBalance(srtVault, alice, assets * 10n**12n);
    },
});

