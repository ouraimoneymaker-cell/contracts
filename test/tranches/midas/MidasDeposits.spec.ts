import { UTest } from 'atma-utest';
import { $hh } from '../utils/$hh';
import { $tranche } from '../utils/$tranche';
import { $erc20 } from '../utils/$erc20';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { $address } from 'dequanto/utils/$address';
import { l } from 'dequanto/utils/$logger';

const test = await $hh.create('mhyper');

const {
    mHYPER,
    USDC,
    DAI,
    USDS,
    cdo,
    oracle,
    strategy,
    accounting,
    unstakeCooldown,
    jrtVault,
    srtVault,
    feed,
} = await test.deploy();
const { deployer, client } = test;

await test.snapshot('midas');

UTest.create({
    async $before () {
        await feed.$receipt().updateRoundData(deployer, 0, 0, $date.toUnixTimestamp());
        await oracle.$receipt().setRoundData(deployer, 1n, BigInt(1e8), BigInt($date.toUnixTimestamp()));
    },

    async $after () {
        await test.reset();
    },
    async $teardown () {
        await test.reset('midas');
    },
    'should deposit supported Tokens': {
        async 'USDC' () {
            await $erc20.mint(USDC, deployer, deployer, 10);

            await $tranche.deposit(jrtVault, deployer, USDC, 3.1);
            await $erc20.eqBalance(jrtVault, deployer, 3.1);

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
            await $tranche.deposit(srtVault, deployer, USDC, 0.2);
            await $erc20.eqBalance(srtVault, deployer, 0.2);
        },
        async 'mHYPER' () {
            // Check converts and previews
            let previewUSDC = await strategy.convertToAssets(mHYPER.address, BigInt(1.4e18), 0);
            $require.eq(previewUSDC, BigInt(1.4e6));

            let shares = await jrtVault.previewDeposit(mHYPER.address, BigInt(1.4e18));
            $require.eq(shares, BigInt(1.4e18));

            await $erc20.mint(mHYPER, deployer, deployer, 10);

            // JRT
            await $tranche.deposit(jrtVault, deployer, mHYPER, 1.4);
            await $erc20.eqBalance(jrtVault, deployer, 1.4);

            // SRT
            await $tranche.deposit(srtVault, deployer, mHYPER, .7);
            await $erc20.eqBalance(srtVault, deployer, 0.7);
        }
    }
});
