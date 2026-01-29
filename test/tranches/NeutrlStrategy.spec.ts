import { UAction } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { $address } from 'dequanto/utils/$address';
import { $date } from 'dequanto/utils/$date';
import { $contract } from 'dequanto/utils/$contract';
import { $neutrl } from './utils/$neutrl';

await $neutrl.test.deploy();

UAction.create({
    async $before() {
        let { sNUSD, strategy } = $neutrl.test.tranches;
        let { deployer } = $neutrl.test;
        // Disable default cooldowns for testing
        // await sNUSD.$receipt().setCooldownDuration(deployer, 0);
        // await strategy.$receipt().setCooldowns(deployer, 0n, 0n);
    },
    async $after() {
        await $neutrl.test.reset();
    },
    async 'NeutrlStrategy::test'() {
        let {
            cdo,
            jrtVault,
            srtVault,
            strategy,
            accounting,
            feed,
            sNUSDAprPairProvider,
            NUSD,
            sNUSD,
            acm,
            erc20Cooldown,
            unstakeCooldown,
        } = $neutrl.test.tranches;

        // Verify CDO configuration
        $require.eq(await cdo.strategy(), strategy.address, 'CDO strategy should match');
        $require.eq(await cdo.jrtVault(), jrtVault.address, 'CDO jrtVault should match');
        $require.eq(await cdo.srtVault(), srtVault.address, 'CDO srtVault should match');
        $require.eq(await jrtVault.asset(), NUSD.address, 'JRT vault asset should be NUSD');
        $require.eq(await srtVault.asset(), NUSD.address, 'SRT vault asset should be NUSD');

        // Verify strategy configuration
        $require.eq(await strategy.sNUSD(), sNUSD.address, 'Strategy sNUSD should match');
        $require.eq(await strategy.NUSD(), NUSD.address, 'Strategy NUSD should match');

        // Verify cooldowns (7 days for JRT, 0 for SRT as per Tranches.neutrl config)
        const jrtCooldown = await strategy.sNUSDCooldownJrt();
        const srtCooldown = await strategy.sNUSDCooldownSrt();
        const expectedJrtCooldown = $date.parseTimespan('7days', { get: 's' });
        console.log('jrtCooldown', jrtCooldown);
        console.log('expectedJrtCooldown', expectedJrtCooldown);
        $require.eq(jrtCooldown, BigInt(expectedJrtCooldown), 'JRT cooldown should be 7 days');
        $require.eq(srtCooldown, 0n, 'SRT cooldown should be 0');

        // Verify feed configuration
        $require.eq(await feed.provider(), sNUSDAprPairProvider.address, 'Feed provider should match');
        const stalePeriod = await feed.roundStaleAfter();
        const expectedStalePeriod = $date.parseTimespan($neutrl.test.factory.platform.Feed?.stalePeriodAfter || '4hours', { get: 's' });
        $require.eq(stalePeriod, BigInt(expectedStalePeriod), 'Feed stale period should match platform configuration');
        $require.eq(await accounting.aprPairFeed(), feed.address, 'Accounting feed should match');

        // Verify cooldown implementation
        const cooldownImpl = await unstakeCooldown.implementations(sNUSD.address);
        $require.eq($address.eq(cooldownImpl, $address.ZERO), false, 'Cooldown implementation should be set');

        // Verify roles
        const PAUSER_ROLE = $contract.keccak256('PAUSER_ROLE');
        const UPDATER_STRAT_CONFIG_ROLE = $contract.keccak256('UPDATER_STRAT_CONFIG_ROLE');
        const UPDATER_FEED_ROLE = $contract.keccak256('UPDATER_FEED_ROLE');
        const UPDATER_CDO_APR_ROLE = $contract.keccak256('UPDATER_CDO_APR_ROLE');
        const COOLDOWN_WORKER_ROLE = await erc20Cooldown.COOLDOWN_WORKER_ROLE();

        $require.eq(
            await acm.hasRole(PAUSER_ROLE, $neutrl.test.deployer.address),
            true,
            'Owner should have PAUSER_ROLE'
        );
        $require.eq(
            await acm.hasRole(UPDATER_STRAT_CONFIG_ROLE, $neutrl.test.deployer.address),
            true,
            'Owner should have UPDATER_STRAT_CONFIG_ROLE'
        );
        $require.eq(
            await acm.hasRole(UPDATER_FEED_ROLE, $neutrl.test.deployer.address),
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

        // Verify supported tokens
        const supportedTokens = await strategy.getSupportedTokens();
        $require.eq(supportedTokens.length, 2, 'Strategy should support 2 tokens');
        $require.eq(supportedTokens[0], sNUSD.address, 'First supported token should be sNUSD');
        $require.eq(supportedTokens[1], NUSD.address, 'Second supported token should be NUSD');
    },
    async 'NeutrlStrategy::CDO configuration'() {
        let { cdo, strategy, accounting, jrtVault, srtVault } = $neutrl.test.tranches;

        // Verify CDO is properly configured
        $require.eq($address.eq(await cdo.strategy(), $address.ZERO), false, 'CDO should have a strategy');
        $require.eq($address.eq(await cdo.accounting(), $address.ZERO), false, 'CDO should have accounting');
        $require.eq($address.eq(await cdo.jrtVault(), $address.ZERO), false, 'CDO should have JRT vault');
        $require.eq($address.eq(await cdo.srtVault(), $address.ZERO), false, 'CDO should have SRT vault');

        // Verify strategy points to CDO
        $require.eq(await strategy.cdo(), cdo.address, 'Strategy should point to CDO');
    },
    async 'NeutrlStrategy::Tranche configuration'() {
        let { jrtVault, srtVault, cdo, NUSD } = $neutrl.test.tranches;

        // Verify tranches are ERC4626 compatible
        $require.eq(await jrtVault.asset(), NUSD.address, 'JRT vault asset');
        $require.eq(await srtVault.asset(), NUSD.address, 'SRT vault asset');

        // Verify tranches are connected to CDO
        $require.eq(await jrtVault.cdo(), cdo.address, 'JRT vault should be connected to CDO');
        $require.eq(await srtVault.cdo(), cdo.address, 'SRT vault should be connected to CDO');
    },
    async 'NeutrlStrategy::Feed and Accounting'() {
        let { feed, sNUSDAprPairProvider, accounting, cdo } = $neutrl.test.tranches;

        // Verify feed is configured
        $require.eq($address.eq(await feed.provider(), $address.ZERO), false, 'Feed should have a provider');
        $require.eq(await feed.provider(), sNUSDAprPairProvider.address, 'Feed provider should match');

        // Verify accounting is configured
        $require.eq(await accounting.cdo(), cdo.address, 'Accounting should point to CDO');
        $require.eq(await accounting.aprPairFeed(), feed.address, 'Accounting should have feed');
    },
    async 'NeutrlStrategy::Cooldown configuration'() {
        let { strategy, erc20Cooldown, unstakeCooldown, sNUSD } = $neutrl.test.tranches;

        // Verify strategy has cooldown contracts
        $require.eq($address.eq(await strategy.erc20Cooldown(), $address.ZERO), false, 'Strategy should have ERC20Cooldown');
        $require.eq($address.eq(await strategy.unstakeCooldown(), $address.ZERO), false, 'Strategy should have UnstakeCooldown');

        // Verify cooldown implementation is set
        const impl = await unstakeCooldown.implementations(sNUSD.address);
        $require.eq($address.eq(impl, $address.ZERO), false, 'UnstakeCooldown should have implementation for sNUSD');
    }
});
