import { UAction } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { $address } from 'dequanto/utils/$address';
import { $date } from 'dequanto/utils/$date';
import { $contract } from 'dequanto/utils/$contract';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $tranche } from '../utils/$tranche';
import { $test } from '../utils/$test';
import { $bigint } from 'dequanto/utils/$bigint';
import { Tranches } from '@s/platforms/Tranches';
import { $erc4626 } from '../utils/$erc4626';
import { SaturnAprPairProvider } from '@0xc/hardhat/SaturnAprPairProvider/SaturnAprPairProvider';
import { MockStakedUSDat } from '@0xc/hardhat/MockStakedUSDat/MockStakedUSDat';

const test = $hh.create('saturn');

UAction.create({

    async $before() {
        await test.deploy();
        await test.snapshot('saturn-config');
    },
    async $after() {
        await test.reset();
    },
    async $teardown() {
        await test.reset('saturn-config')
    },

    // ============================================================
    // Deployment & Configuration
    // ============================================================

    async 'SaturnStrategy::deployment configuration'() {
        let {
            cdo,
            jrtVault,
            srtVault,
            strategy,
            accounting,
            feed,
            provider,
            acm,
            erc20Cooldown,
            unstakeCooldown,
        } = test.tranches;

        let { base, sUSDat } = await test.factory.ensureUnderlying();
        const saturnProvider = new SaturnAprPairProvider(provider.address, provider.client);
        const mockSUSDat = new MockStakedUSDat(sUSDat.address, sUSDat.client);

        // Verify CDO configuration
        $require.eq(await cdo.strategy(), strategy.address, 'CDO strategy should match');
        $require.eq(await cdo.jrtVault(), jrtVault.address, 'CDO jrtVault should match');
        $require.eq(await cdo.srtVault(), srtVault.address, 'CDO srtVault should match');
        $require.eq(await jrtVault.asset(), base.address, 'JRT vault asset should be USDat');
        $require.eq(await srtVault.asset(), base.address, 'SRT vault asset should be USDat');

        // Verify strategy configuration
        $require.eq(await strategy.getSupportedTokens().then(t => t.length), 2, 'Strategy should support 2 tokens');

        // Verify feed configuration
        $require.eq(await feed.provider(), provider.address, 'Feed provider should match');
        $require.eq(await accounting.aprPairFeed(), feed.address, 'Accounting feed should match');

        // Verify cooldown implementation
        const cooldownImpl = await unstakeCooldown.implementations(sUSDat.address);
        $require.eq($address.eq(cooldownImpl, $address.ZERO), false, 'Cooldown implementation should be set');

        // Verify roles
        const UPDATER_FEED_ROLE = $contract.keccak256('UPDATER_FEED_ROLE');
        const UPDATER_CDO_APR_ROLE = $contract.keccak256('UPDATER_CDO_APR_ROLE');
        const COOLDOWN_WORKER_ROLE = await erc20Cooldown.COOLDOWN_WORKER_ROLE();

        $require.eq(
            await acm.hasRole(UPDATER_FEED_ROLE, test.deployer.address),
            true,
            'Owner should have UPDATER_FEED_ROLE'
        );
        $require.eq(
            await acm.hasRole(UPDATER_CDO_APR_ROLE, feed.address),
            true,
            'Feed should have UPDATER_CDO_APR_ROLE'
        );
        $require.eq(
            await acm.hasRole(COOLDOWN_WORKER_ROLE, strategy.address),
            true,
            'Strategy should have COOLDOWN_WORKER_ROLE'
        );

        // Verify action states
        const jrtActions = await cdo.actionsJrt();
        const srtActions = await cdo.actionsSrt();
        $require.eq(jrtActions.isDepositEnabled, true, 'JRT deposits should be enabled');
        $require.eq(jrtActions.isWithdrawEnabled, true, 'JRT withdrawals should be enabled');
        $require.eq(srtActions.isDepositEnabled, true, 'SRT deposits should be enabled');
        $require.eq(srtActions.isWithdrawEnabled, true, 'SRT withdrawals should be enabled');
    },

    // ============================================================
    // Deposit Fee Handling
    // ============================================================

    async 'SaturnStrategy::deposit fee impact'() {
        const { deployer } = test.factory;
        const { base, sUSDat } = await test.factory.ensureUnderlying();
        const { jrtVault, strategy, cdo } = test.tranches;

        const AMOUNT = 10_000;
        await $erc20.mint(base, deployer, deployer.address, AMOUNT);
        await $tranche.deposit(jrtVault, deployer, base, AMOUNT);

        // After deposit, strategy totalAssets should be ~99.9% of deposited amount
        // due to sUSDat's 0.1% deposit fee
        const totalAssets = $bigint.toEther(await strategy.totalAssets());
        const expectedPostFee = AMOUNT * 0.999; // 0.1% fee

        // Allow small rounding tolerance
        $test.eqDiff(totalAssets, expectedPostFee, 1, 'Total assets should reflect 0.1% deposit fee');
    },

    // ============================================================
    // APR Provider
    // ============================================================

    async 'SaturnStrategy::APR provider setAprTarget'() {
        const { deployer } = test.factory;
        const { provider, acm } = test.tranches;
        const saturnProvider = new SaturnAprPairProvider(provider.address, provider.client);

        // Set aprTarget to 8.05% (70% of 11.5% dividend rate)
        const targetAPR = $bigint.toWei(0.0805, 12); // 12 decimal precision
        await saturnProvider.$receipt().setAprTarget(deployer, targetAPR);

        // Verify
        const [aprTarget, aprBase] = await saturnProvider.getAprPair();
        $require.eq(aprTarget, targetAPR, 'aprTarget should be set to 8.05%');
    },

    async 'SaturnStrategy::APR provider bounds check'() {
        const { deployer } = test.factory;
        const { provider } = test.tranches;
        const saturnProvider = new SaturnAprPairProvider(provider.address, provider.client);

        // Should reject APR > 200%
        const tooHigh = $bigint.toWei(2.01, 12);
        let reverted = false;
        try {
            await saturnProvider.$receipt().setAprTarget(deployer, tooHigh);
        } catch (e) {
            reverted = true;
        }
        $require.eq(reverted, true, 'Should revert for APR > 200%');
    },

    // ============================================================
    // Performance Fee
    // ============================================================

    async 'SaturnStrategy::performance fee on yield'() {
        const { client } = test;
        const { deployer } = test.factory;
        const { base, sUSDat } = await test.factory.ensureUnderlying();
        const { accounting, jrtVault, strategy } = test.tranches;

        // Deposit
        await $erc20.mint(base, deployer, deployer.address, 10_001);
        await $tranche.deposit(jrtVault, deployer, base, 10_000);

        // Simulate yield via balance manipulation
        const testHelper = new Tranches.saturn.TestHelper(test);
        await testHelper.distributeRewards({
            assetsBefore: await strategy.totalAssets(),
            dt: '30days',
            apr: 0.10, // 10% annualized
        });

        await client.debug.mine('30days');

        // Trigger accounting update with a small deposit
        await $tranche.deposit(jrtVault, deployer, base, 1);

        const feeAccrued = $bigint.toEther(await accounting.reserveNav());
        // Expected: 30 days of 10% APR on ~9990 (after deposit fee)
        // ~9990 * 0.10 * 30/365 * 7.5% fee ≈ ~6.15
        $require.gt(feeAccrued, 0, 'Performance fee should accrue');
    },

    // ============================================================
    // STRC Price Volatility (Junior absorbs)
    // ============================================================

    async 'SaturnStrategy::STRC price drop impact'() {
        const { deployer } = test.factory;
        const { base, sUSDat } = await test.factory.ensureUnderlying();
        const { jrtVault, srtVault, strategy, cdo } = test.tranches;
        const mockSUSDat = new MockStakedUSDat(sUSDat.address, sUSDat.client);

        // Deposit into both tranches
        await $erc20.mint(base, deployer, deployer.address, 20_000);
        await $tranche.deposit(jrtVault, deployer, base, 10_000);
        await $tranche.deposit(srtVault, deployer, base, 10_000);

        // Record pre-drop NAV
        const navBefore = await cdo.totalAssetsUnlocked();
        const totalBefore = $bigint.toEther(navBefore.jrtNav + navBefore.srtNav);

        // Simulate STRC price drop by reducing sUSDat balance
        // This simulates what happens when totalAssets() returns less
        const currentBalance = await strategy.totalAssets();
        const droppedBalance = currentBalance * 90n / 100n; // 10% drop
        const shares = await mockSUSDat.convertToShares(droppedBalance);
        await $erc20.setBalanceAny(sUSDat as any, strategy.address, shares);

        // Verify totalAssets dropped
        const totalAssetsAfter = $bigint.toEther(await strategy.totalAssets());
        $test.eqDiff(totalAssetsAfter, totalBefore * 0.9, totalBefore * 0.02, 'Total assets should drop ~10%');
    },

    // ============================================================
    // Redemption Fee
    // ============================================================

    async 'SaturnStrategy::redemption fees'() {
        const { deployer } = test.factory;
        const { base } = await test.factory.ensureUnderlying();
        const { accounting, jrtVault, srtVault } = test.tranches;

        await $tranche.ensureCoverage(test, 50, { jrt: 10_000 });
        await $erc20.mint(base, deployer, deployer.address, 2000);

        return UAction.create({
            async 'from Junior'() {
                const AMOUNT = 1000;
                await $tranche.deposit(jrtVault, deployer, base, AMOUNT);
                let { tx } = await $erc4626.withdrawMeta(jrtVault, base, deployer, AMOUNT);
                const feeAccrued = accounting.extractLogsFeeAccrued(tx.receipt)[0].params;
                $require.eq(feeAccrued.amountToReserve, feeAccrued.amountToTranche, `Saturn 50% retention`);

                const totalFeeFact = $bigint.toEther(feeAccrued.amountToReserve + feeAccrued.amountToTranche);
                const feeRatio = Tranches.saturn.jrt.sharesCooldown[2].feeBps / 10000;
                const totalFeeCalc = AMOUNT * feeRatio / (1 - feeRatio);
                $test.eqDiff(totalFeeFact, totalFeeCalc, .0001);
            },
            async 'from Senior'() {
                const AMOUNT = 500;
                await $tranche.deposit(srtVault, deployer, base, AMOUNT);
                let { tx } = await $erc4626.withdrawMeta(srtVault, base, deployer, AMOUNT);
                const feeAccrued = accounting.extractLogsFeeAccrued(tx.receipt)[0].params;
                $require.eq(feeAccrued.amountToReserve, feeAccrued.amountToTranche, `Saturn 50% retention`);

                const totalFeeFact = $bigint.toEther(feeAccrued.amountToReserve + feeAccrued.amountToTranche);
                const feeRatio = Tranches.saturn.srt.sharesCooldown[2].feeBps / 10000;
                const totalFeeCalc = AMOUNT * feeRatio / (1 - feeRatio);
                $test.eqDiff(totalFeeFact, totalFeeCalc, .0001);
            },
        });
    },
});
