/**
 * MKRAlpha CDO Integration Test
 *
 * Tests deposit/reward/redeem flows through StrataCDO using DYSAccounting.
 * Runs as a single sequential suite (state accumulates across steps).
 */

import { UAction } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { l } from 'dequanto/utils/$logger';
import { $hh } from '../utils/$hh';
import { $erc4626 } from '../utils/$erc4626';
import { $erc20 } from '../utils/$erc20';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $apr } from '@s/utils/$apr';
import { DYSAccounting } from '@0xc/hardhat/DYSAccounting/DYSAccounting';

// Must explicitly override ContractVersions.accounting to 'dys';
// $hh.Test defaults to 'discrete' via ??= which overrides Tranches config.
const test = $hh.create('mkralpha', {
    cdoInfo: { ContractVersions: { accounting: 'dys' } },
});

const { USDC, jrtVault, srtVault, strategy, accounting: acctRaw, feed } = await test.deploy();

// Re-instantiate as DYSAccounting so DYS-specific state vars are accessible
const accounting = new DYSAccounting(acctRaw.address, test.client);
const { deployer, client } = test;

// Create accounts
const alice = await test.createAccount('alice');
const bob = await test.createAccount('bob');

// Pre-fund accounts
await $erc20.setBalanceAny(new ERC20(USDC.address, client), alice, $bigint.toWei(5000, 6));
await $erc20.setBalanceAny(new ERC20(USDC.address, client), bob, $bigint.toWei(5000, 6));

// ── Helpers ──────────────────────────────────────────────────────────────────
function toWei(n: number) {
    return $bigint.toWei(n, 6);
}
function toEth(n: bigint) {
    return $bigint.toEther(n, 6);
}
function assertClose(fact: bigint, expected: bigint, tol: bigint, msg: string) {
    const diff = fact > expected ? fact - expected : expected - fact;
    if (diff > tol) {
        throw new Error(`${msg}: fact=${toEth(fact)}, expected≈${toEth(expected)}, diff=${toEth(diff)}`);
    }
}
const TOL = 10n ** 12n;

async function setAprs(targetFraction: number, baseFraction: number) {
    const ts = (await client.getBlock('latest')).timestamp;
    await feed.$receipt().updateRoundData(deployer, $apr.toWei(targetFraction), $apr.toWei(baseFraction), ts);
    await accounting.$receipt().onAprChanged(deployer);
}

// ── Sequential integration flow ───────────────────────────────────────────────
// Each test step builds on the state left by the previous one.

UAction.create({
    $config: { timeout: 300_000 },

    async $before() {
        // Set APRs once at the start
        await setAprs(0, 0.1);
    },
    async $after () {
        await test.wipe();
    },

    // Step 1: Basic JRT deposit
    async 'step1: JRT deposit'() {
        const sharesBefore = await jrtVault.balanceOf(alice.address);
        await $erc4626.depositMeta(jrtVault as any, USDC.address, alice, toWei(600));
        const sharesAfter = await jrtVault.balanceOf(alice.address);

        $require.gt(sharesAfter - sharesBefore, 0n, 'Alice should receive JRT shares');
        l`JRT shares: cyan<${$bigint.toEther(sharesAfter - sharesBefore)}>`;

        const jrtNav = await accounting.jrtNav();
        assertClose(jrtNav, toWei(600), TOL, 'jrtNav=600 after deposit');
        l`step1 ✅ jrtNav=${toEth(jrtNav)}`;
    },

    // Step 2: SRT deposit (builds on step1 state — JRT already exists)
    async 'step2: SRT deposit'() {
        const sharesBefore = await srtVault.balanceOf(alice.address);
        await $erc4626.depositMeta(srtVault as any, USDC.address, alice, toWei(400));
        const sharesAfter = await srtVault.balanceOf(alice.address);

        $require.gt(sharesAfter - sharesBefore, 0n, 'Alice should receive SRT shares');

        const srtNav = await accounting.srtNav();
        assertClose(srtNav, toWei(400), TOL, 'srtNav=400 after deposit');
        l`step2 ✅ srtNav=${toEth(srtNav)}`;
    },

    // Step 3: Mine 1 day → DYS projection accumulates
    async 'step3: DYS projection after 1 day'() {
        const srtNavBefore = await accounting.srtNav();
        const projectedBefore = await accounting.srtPnLProjected();
        $require.eq(projectedBefore, 0n, 'srtPnLProjected starts at 0');

        await test.mine('1day');
        await accounting.$receipt().onAprChanged(deployer);

        const srtNavAfter = await accounting.srtNav();
        const srtPnLProjected = await accounting.srtPnLProjected();

        l`After projection: srtNavBefore=${toEth(srtNavBefore)}, srtNavAfter=${toEth(
            srtNavAfter
        )}, srtPnLProjected=${toEth(srtPnLProjected)}`;
        $require.gt(srtPnLProjected, 0n, 'srtPnLProjected should be > 0 after 1 day');
        $require.gt(srtNavAfter, srtNavBefore, 'SRT NAV should grow via projection');
        l`step3 ✅`;
    },

    // Step 4: NAV invariant holds throughout
    async 'step4: NAV invariant'() {
        const jrtNav = await accounting.jrtNav();
        const srtNav = await accounting.srtNav();
        const reserveNav = await accounting.reserveNav();
        const nav = await accounting.nav();

        l`jrt=${toEth(jrtNav)}, srt=${toEth(srtNav)}, reserve=${toEth(reserveNav)}, nav=${toEth(nav)}`;
        assertClose(jrtNav + srtNav + reserveNav, nav, TOL, 'NAV invariant: jrt+srt+reserve==nav');
        l`step4 ✅`;
    },

    // Step 5: Multi-depositor and previewRedeem sanity
    // (actual redeem with cooldown flow is tested in MKRAlphaStrategy.spec.ts)
    async 'step5: multi-depositor shares + previewRedeem'() {
        await $erc20.setBalanceAny(new ERC20(USDC.address, client), bob, $bigint.toWei(1000, 6));
        const bobDeposit = toWei(500);

        await $erc4626.depositMeta(jrtVault as any, USDC.address, bob, bobDeposit);
        const bobShares = await jrtVault.balanceOf(bob.address);
        $require.gt(bobShares, 0n, 'Bob should receive JRT shares');
        l`Bob JRT shares: ${$bigint.toEther(bobShares)}`;

        // previewRedeem of Bob's shares should return ≈ 500 USDC
        const previewOut = await jrtVault.previewRedeem(USDC.address, bobShares);
        l`previewRedeem: ${toEth(previewOut)} USDC`;
        assertClose(previewOut, bobDeposit, toWei(2), 'previewRedeem ≈ 500 USDC');
        l`step5 ✅`;
    },

    // Step 6: srtNavTime is proportional to SRT share of total TVL
    async 'step6: srtNavTime weight'() {
        const srtNavTime = await accounting.srtNavTime();
        const navTime = await accounting.navTime();

        l`srtNavTime=${srtNavTime}, navTime=${navTime}`;
        $require.gt(navTime, 0n, 'navTime should be positive');

        const srtRatio = Number(srtNavTime) / Number(navTime);
        l`SRT time weight: cyan<${(srtRatio * 100).toFixed(1)}%>`;
        // SRT is 400 / (600+400) = 40% of total TVL
        $require.True(
            srtRatio > 0.3 && srtRatio < 0.5,
            `srtNavTime/navTime should be ~40%, got ${(srtRatio * 100).toFixed(1)}%`
        );
        l`step6 ✅`;
    },
});
