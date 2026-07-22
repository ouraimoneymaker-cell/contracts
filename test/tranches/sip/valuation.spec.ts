import { UTest } from 'atma-utest'
import { $hh } from '../utils/$hh';
import { $erc4626 } from '../utils/$erc4626';
import { $require } from 'dequanto/utils/$require';
import { $test } from '../utils/$test';
import { l } from 'dequanto/utils/$logger';
import { $address } from 'dequanto/utils/$address';
import { $bigint } from 'dequanto/utils/$bigint';
import { $strata } from '../utils/$strata';
import { $ethena } from '../utils/$ethena';
import { DYSAccounting } from '@0xc/hardhat/DYSAccounting/DYSAccounting';
import { TEth } from 'dequanto/models/TEth';
import { $accounting } from '../utils/$accounting';


const test = await $hh.deploy('ethena', {
    cdoInfo: {
        ContractVersions: { accounting: 'continuous' }
    },
});

const accounting = test.tranches.accounting as any as DYSAccounting;
const { deployer, client } = test;
const { cdo, jrtVault, srtVault, sUSDe } = test.tranches;
const alice = await test.createAccount('alice');

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

    async 'applies 0.50 valuation loss by shifting Junior liquidity to Senior at 50:50 coverage'() {
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

    async 'handles redemptions during valuation loss'() {
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
    async 'depletes Junior to the buffer during severe valuation loss' () {
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
            async 'allows Alice to redeem 100% of Senior shares' () {
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
            async 'allows Alice to redeem 50% of Senior shares' () {
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
    },

    async 'sets Senior maxDeposit to zero after depositing the full remaining capacity' () {
        await t.deposit(alice, 800_000, 10_000_000);
        await cdo.$receipt().setValuationPrice(deployer, BigInt(.99e18));
        await cdo.$receipt().setActionStates(deployer, srtVault.address, true, true);

        $test.compare(
            await accounting.maxDeposit(false),
            1_548_821.548
        );
        await t.deposit(alice, 0, 1_548_821.548);
        $test.compare(
            await accounting.maxDeposit(false),
            0
        );
    },
    async 'keeps the minimum Junior/Senior ratio stable after new Senior deposits' () {
        await t.deposit(alice, 200, 100);
        $test.compare(
            await accounting.maxDeposit(false),
            $accounting.maxDepositSenior(200, 100, 0.06)
        );

        await cdo.$receipt().setValuationPrice(deployer, BigInt(.5e18));
        await cdo.$receipt().setActionStates(deployer, srtVault.address, true, true);

        $test.compare(
            await accounting.maxDeposit(false),
            $accounting.maxDepositSenior(100, 200, 0.06)
        );

        await t.deposit(alice, 50, 100);
        $test.compare(
            await accounting.maxDeposit(false),
            $accounting.maxDepositSenior(150, 300, 0.06)
        );
    },
    async 'keeps prices stable across Senior deposits and withdrawals within one valuation period' () {
        await t.deposit(alice, 200, 100);

        await cdo.$receipt().setValuationPrice(deployer, BigInt(0.25e18));
        await t.comparePrices(0.005, 2.99);

        await cdo.$receipt().setValuationPrice(deployer, BigInt(1e18));
        await t.comparePrices(1, 1);

        await cdo.$receipt().setValuationPrice(deployer, BigInt(0.5e18));

        // Short-lived valuation loss is treated as a temporary protected state with actions paused.
        // If actions are later re-enabled, the loss becomes the active market regime: deposits and
        // redemptions settle at the current valuation, and any future recovery belongs to all holders.
        await cdo.$receipt().setActionStates(deployer, srtVault.address, true, true);
        await t.comparePrices(0.5, 2);

        await t.deposit(alice, 0, 100);
        await t.comparePrices(0.5, 2);

        await t.withdraw(alice, 0, 100);
        await t.comparePrices(0.5, 2);

        await cdo.$receipt().setValuationPrice(deployer, BigInt(0.25e18));
        await t.comparePrices(0.005, 2.99);

        await cdo.$receipt().setValuationPrice(deployer, BigInt(1e18));
        await t.comparePrices(0.833333, 1.333333);
    },

    async 'handles Senior withdrawals after Senior deposits during valuation loss' () {
        await t.deposit(alice, 200, 100);
        await cdo.$receipt().setValuationPrice(deployer, BigInt(0.5e18));
        await cdo.$receipt().setActionStates(deployer, srtVault.address, true, true);

        await t.deposit(alice, 0, 1000);
        await t.compareNavs(100, 1200);
        await t.withdraw(alice, 0, 1150);
    }
})

namespace t {
    export async function deposit(depositor: TEth.IAccount, jrtAssets: number, srtAssets: number) {
        jrtAssets > 0 && await $erc4626.deposit(jrtVault, depositor, jrtAssets);
        srtAssets > 0 && await $erc4626.deposit(srtVault, depositor, srtAssets);
    }
    export async function withdraw(depositor: TEth.IAccount, jrtAssets: number, srtAssets: number) {
        jrtAssets > 0 && await $erc4626.withdraw(jrtVault, depositor, jrtAssets);
        srtAssets > 0 && await $erc4626.withdraw(srtVault, depositor, srtAssets);
    }
    export async function comparePrices(jrtPrice: number, srtPrice: number, msg?: string) {
        const [jrtPriceFact, srtPriceFact] = await Promise.all([
            cdo.pricePerShare(jrtVault.address),
            cdo.pricePerShare(srtVault.address),
        ]);
        const jrtPriceFactEth = $bigint.toEther(jrtPriceFact);
        const srtPriceFactEth = $bigint.toEther(srtPriceFact);
        $test.compare(
            jrtPriceFactEth,
            jrtPrice,
            18,
            `JRT price | ${jrtPrice}, ${srtPrice} != ${jrtPriceFactEth}, ${srtPriceFactEth} ${msg ?? ''}`
        );
        $test.compare(
            srtPriceFactEth,
            srtPrice,
            18,
            `SRT price | ${jrtPrice}, ${srtPrice} != ${jrtPriceFactEth}, ${srtPriceFactEth} ${msg ?? ''}`
        );
    }
    export async function compareNavs(jrtNav: number, srtNav: number, msg?: string) {
        const navs = await accounting.totalAssets();
        const jrtNavFactEth = $bigint.toEther(navs.jrtNavT1Projected ?? (navs as any).jrtNavT1 /* continuous accounting */);
        const srtNavFactEth = $bigint.toEther(navs.srtNavT1);
        $test.compare(
            jrtNavFactEth,
            jrtNav,
            18,
            `JRT price | ${jrtNav}, ${srtNav} != ${jrtNavFactEth}, ${srtNavFactEth} ${msg ?? ''}`
        );
        $test.compare(
            srtNavFactEth,
            srtNav,
            18,
            `SRT price | ${jrtNav}, ${srtNav} != ${jrtNavFactEth}, ${srtNavFactEth} ${msg ?? ''}`
        );
    }
}
