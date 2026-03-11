import { UTest } from 'atma-utest';
import { $hh } from '../utils/$hh';
import { $tranche } from '../utils/$tranche';
import { $erc20 } from '../utils/$erc20';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { l } from 'dequanto/utils/$logger';
import { DiscreteAccounting } from '@0xc/hardhat/DiscreteAccounting/DiscreteAccounting';

const test = await $hh.create('mhyper');

const {
    mHYPER,
    USDC,
    DAI,
    USDS,
    oracle,
    strategy,
    accounting,
    jrtVault,
    srtVault,
    feed,
} = await test.deploy();
const { deployer, client } = test;

const acc = accounting as any as DiscreteAccounting

UTest.create({
    async $before () {
        await setAPRs(0, 0);
        await feed.$receipt().setRoundStaleAfter(deployer, BigInt($date.parseTimespan('5years', { get:'s' })));
        await oracle.$receipt().setRoundData(deployer, 1n, BigInt(1e8), BigInt($date.toUnixTimestamp()));
        await test.snapshot('midas');
    },

    async $after () {
        await test.reset();
    },
    async $teardown () {
        await test.reset('midas');
    },
    async 'should deposit USDC' () {
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
    async 'should deposit mHYPER' () {
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
    },
    async 'should deposit DAI' () {
        let shares = await jrtVault.previewDeposit(DAI.address, BigInt(1.4e18));
        $require.eq(shares, BigInt(1.4e18));

        await $erc20.mint(DAI, deployer, deployer, 10);
        // JRT
        await $tranche.deposit(jrtVault, deployer, DAI, 1.12);
        await $erc20.eqBalance(jrtVault, deployer, 1.12);
        // SRT
        await $tranche.deposit(srtVault, deployer, DAI, .7);
        await $erc20.eqBalance(srtVault, deployer, 0.7);
    },

    async 'deposit flow' () {
        await $erc20.mint(USDS, deployer, deployer, 1000);

        // Effectively disables the risk premium (target is used for SRT)
        await acc.$receipt().setRiskParameters(deployer, BigInt(0.9e18), 0n, BigInt(0.3e18));
        await setAPRs(.01, .02);
        await $tranche.deposit(jrtVault, deployer, USDS, 200);
        await $tranche.deposit(srtVault, deployer, USDS, 200);

        await test.mine('1year');
        // Trigger accounting
        await setAPRs(.01, .02);

        console.log(`APR`, await acc.aprSrt());

        const jrtGain = 200 * .02 /*2% base*/ * 1.5 /* +50% from Seniors */;
        const srtGain = 200 * .01;

        $require.eq(await srtVault.totalAssets(), $bigint.toWei(200 + srtGain, 6));
        $require.eq(await jrtVault.totalAssets(), $bigint.toWei(200 + jrtGain, 6));


        await $erc20.mint(mHYPER, deployer, deployer, 1000);
        // aka donation attack (alice donates 100$)
        await mHYPER.$receipt().transfer(deployer, strategy.address, $bigint.toWei(100, 18));

        // No Oracle UPDATES, ignores manual transfers
        $require.eq(await srtVault.totalAssets(), $bigint.toWei(200 + srtGain, 6));
        $require.eq(await jrtVault.totalAssets(), $bigint.toWei(200 + jrtGain, 6));


        await setOraclePrice(1.02);
        // Trigger accounting
        await setAPRs(.01, .02);

        const jrtGainWithDonation = 200 * .02 /* 2% base */ * 1.5 /* +50% from Seniors */ + 100 * 1.02 /* donation received JRT */;
        const srtGainWithDonation = 200 * .01 /* donation receives JRT */;

        $require.eq(await srtVault.totalAssets(), $bigint.toWei(200 + srtGainWithDonation, 6));
        $require.eq(await jrtVault.totalAssets(), $bigint.toWei(200 + jrtGainWithDonation, 6));
    }

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
