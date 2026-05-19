import { UTest } from 'atma-utest'
import { $hh } from '../utils/$hh';
import { DiscreteAccounting } from '@0xc/hardhat/DiscreteAccounting/DiscreteAccounting';
import { $erc4626 } from '../utils/$erc4626';
import { $require } from 'dequanto/utils/$require';
import { $test } from '../utils/$test';
import { l } from 'dequanto/utils/$logger';
import { $address } from 'dequanto/utils/$address';
import { $bigint } from 'dequanto/utils/$bigint';
import { $strata } from '../utils/$strata';
import { $ethena } from '../utils/$ethena';



const test = await $hh.deploy('ethena', {
    cdoInfo: {
        ContractVersions: { accounting: 'discrete' }
    },
    fresh: true,
});

const accounting = test.tranches.accounting as any as DiscreteAccounting;
const { deployer, client } = test;
const { cdo, jrtVault, srtVault, USDe, sUSDe, feed } = test.tranches;


UTest.create({

    async $before() {
        await cdo.$receipt().setValuationKeeper(deployer, deployer.address);
        await $strata.disableAPRs(test.factory);
        await $ethena.setCooldownDuration(sUSDe, deployer, 0);
        await test.snapshot('spec');
    },
    async $teardown() {
        await test.reset('spec');
    },
    async $after() {
        await test.wipe();
    },

    async 'should drop to 0.50$ moving the JRT liquidity to SRT at 50:50 coverage'() {
        await $erc4626.deposit(jrtVault, deployer, 100);
        await $erc4626.deposit(srtVault, deployer, 100);
        $require.eq(await jrtVault.totalAssets(), BigInt(100e18));
        $require.eq(await srtVault.totalAssets(), BigInt(100e18));


        // 60seconds after entering the valuation loss, no redemption or deposits should be allowed
        await accounting.$receipt().setValuationGracePeriod(deployer, 60);

        const tx = await cdo.$receipt().setValuationPrice(deployer, BigInt(.5e18));
        const [changed] = accounting.extractLogsValuationPriceChanged(tx.receipt);
        $require.eq(changed?.params.valuationPrice, BigInt(.5e18));
        $require.eq(await accounting.valuationPrice(), BigInt(.5e18), `Valuation price should be 0.5$`);

        $require.eq(await jrtVault.maxDeposit($address.ZERO), 0n, `GracePeriod: disabled Jrt deposit`);
        $require.eq(await srtVault.maxDeposit($address.ZERO), 0n, `ValuationLoss: disabled Srt deposit`);

        $require.eq(await jrtVault.maxWithdraw(deployer.address), 0n, `ValuationLoss: disabled Jrt redemption`);
        $require.eq(await srtVault.maxDeposit(deployer.address), 0n, `GracePeriod: disabled Srt redemption`);

        await client.debug.mine('2hour');


        // Here we would require 100$ from JR, but we keep ONE_ASSET as Buffer
        $require.eq(await jrtVault.totalAssets(), BigInt(1e18));
        $require.eq(await srtVault.totalAssets(), BigInt(199e18));

        l`Deposit 1 USDe to JRT, that should be moved to SRT for full coverage`;
        await $erc4626.deposit(jrtVault, deployer, 1);
        $require.eq(await jrtVault.totalAssets(), BigInt(1e18));
        $require.eq(await srtVault.totalAssets(), BigInt(200e18));

        l`PreviewFunctions`
        const srtPPS = await cdo.pricePerShare(srtVault.address);
        $require.eq(srtPPS, BigInt(2e18), `SRT price per share should be 2 Assets`);

        const jrtPPS = await cdo.pricePerShare(jrtVault.address);
        $require.eq(jrtPPS, BigInt(0.005e18), `JRT price per share should be 0.005$ Assets (rounded)`);

        $test.eqDiff(
            await jrtVault.previewDeposit(BigInt(10e18))
            , BigInt(10e18) * BigInt(1e18) / BigInt(0.005e18)
            , 10_000n
        );
        $require.eq(await srtVault.previewDeposit(BigInt(10e18)), BigInt(5e18));


        l`Deposit 1 USDe to JRT, that should remain`;
        // Re-enable JRT deposits, as due to loss pps dropped < jrtShortfallPausePrice
        await cdo.$receipt().setActionStates(deployer, jrtVault.address, true, true);

        $require.eq(await cdo.maxDeposit(jrtVault.address), $bigint.MAX_UINT256, `JRT max depositable`);
        $require.eq(await cdo.maxDeposit(srtVault.address), 0n, `SRT deposit should be disabled`);


        await $erc4626.deposit(jrtVault, deployer, 11);
        $require.eq(await srtVault.totalAssets(), BigInt(200e18));
        $require.eq(await jrtVault.totalAssets(), BigInt(12e18));

        l`maxWithdraw should be adjusted`;
        const minJRTRatio = Number(await accounting.minimumJrtSrtRatio()) / 10 ** 18;
        $require.eq(await cdo.maxWithdraw(jrtVault.address), BigInt(12e18 - 200e18 * minJRTRatio));
        $require.eq(await cdo.maxWithdraw(srtVault.address), BigInt(200e18));


        l`Should recover to pre-drop NAV including JRT new deposits`;
        await cdo.$receipt().setValuationPrice(deployer, BigInt(1e18));
        $require.eq(await jrtVault.totalAssets(), BigInt(112e18));
        $require.eq(await srtVault.totalAssets(), BigInt(100e18));
    },

    async 'should check redemptions'() {
        const alice = await test.createAccount('alice');
        await $erc4626.deposit(jrtVault, alice, 10_000);
        await $erc4626.deposit(srtVault, alice, 5);

        await $erc4626.deposit(jrtVault, deployer, 100);
        await $erc4626.deposit(srtVault, deployer, 100);

        await cdo.$receipt().setValuationPrice(deployer, BigInt(.5e18));

        // Re-enable JRT deposits, as due to loss pps dropped < jrtShortfallPausePrice
        await cdo.$receipt().setActionStates(deployer, jrtVault.address, true, true);

        const srRedeemed = await $erc4626.redeem(srtVault, deployer, '100%');
        $test.eqDiff(srRedeemed, BigInt(200e18), 1n, `Senior should withdraw 200 assets`);

        const jrRedeemed = await $erc4626.redeem(jrtVault, deployer, '100%');
        const jrPerDollarLoss = $bigint.toWei(105 / 10_100, 18);

        $test.eqDiff(
            jrRedeemed
            , BigInt(100e18) - 100n * jrPerDollarLoss
            , 10n
            , `Junior should withdraw`
        );

        $test.eqDiff(
            await accounting.srtBaseNav()
            , BigInt(5e18)
            , 1n
            , `Remains 5$ in senior's base nav (fact)`
        );

        $test.eqDiff(
            await accounting.jrtBaseNav()
            , $bigint.toWei(10_100) - /* SR covered */ BigInt(100e18) - jrRedeemed
            , 10n
            , `Remains 10_000$ in junior's base NAV minus senior coverage and redemption`
        );
    },
    async 'should deplete junior' () {
        const alice = await test.createAccount('alice');
        await $erc4626.deposit(jrtVault, alice, 10);
        await $erc4626.deposit(srtVault, alice, 100);
        await $erc4626.deposit(srtVault, deployer, 3);
        await cdo.$receipt().setValuationPrice(deployer, BigInt(.5e18));
        await test.snapshot('redeem-sr');

        const srtAssets = await srtVault.totalAssets();
        $require.eq(srtAssets, BigInt(100 /* alice */ + 3 /* deployer */ + 9 /** JRT Coverage */) * 10n**18n);
        return UTest.create({
            async $teardown () {
                await test.reset('redeem-sr');
            },
            async 'alice should redeem 100%' () {
                const srRedeemed = await $erc4626.redeem(srtVault, alice, '100%');
                $test.eqDiff(srRedeemed, BigInt(109e18), BigInt(.5e18));
                const [
                    jrtAssets,
                    srtAssets,
                    srtNav,
                    jrtNav,
                ] = await Promise.all([
                    jrtVault.totalAssets(),
                    srtVault.totalAssets(),
                    accounting.srtBaseNav(),
                    accounting.jrtBaseNav(),
                ]);
                $require.eq(jrtAssets, BigInt(1e18), `JRT should be 1 Asset`);
                $require.eq(srtNav, BigInt(3e18), `SRT base NAV should be 3 Assets (100 redeemed of of 103)`);
                $require.eq(srtAssets, jrtNav + srtNav - jrtAssets, `SRT should contain all from JRT minus 1 buffer asset`);
            },
            async 'alice should redeem 50%' () {
                const srRedeemed = await $erc4626.redeem(srtVault, alice, '50%');
                $test.eqDiff(srRedeemed, BigInt(109e18 / 2), BigInt(.5e18));
                const [
                    jrtAssets,
                    srtAssets,
                    srtNav,
                    jrtNav,
                ] = await Promise.all([
                    jrtVault.totalAssets(),
                    srtVault.totalAssets(),
                    accounting.srtBaseNav(),
                    accounting.jrtBaseNav(),
                ]);
                $require.eq(jrtAssets, BigInt(1e18), `JRT should be 1 Asset`);
                $require.eq(srtNav, BigInt(50e18 + 3e18), `SRT base NAV should be 3 Assets (100 redeemed of of 103)`);
                $require.eq(srtAssets, jrtNav + srtNav - jrtAssets, `SRT should contain all from JRT minus 1 buffer asset`);
            },
        });
    }
})
