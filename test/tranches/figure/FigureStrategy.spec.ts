import { UTest } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $address } from 'dequanto/utils/$address';
import { $date } from 'dequanto/utils/$date';
import { $promise } from 'dequanto/utils/$promise';
import { l } from 'dequanto/utils/$logger';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $tranche } from '../utils/$tranche';
import { Tranches } from '@s/platforms/Tranches';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';

const test = await $hh.create('figure', {
    forked: 25099102,
    cdoInfo: { ContractVersions: { accounting: 'discrete' } },
});

const {
    USDC,
    yieldVault,
    stakingVault,
    strategy,
    unstakeCooldown,
    cdo,
    jrtVault,
    srtVault,
    accounting,
    feed,
} = await test.deploy({ initialDeposit: false });
const { deployer, client } = test; //Testing the verified signatures

await test.snapshot('figure');

UTest.create({
    async $before () {},

    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await test.reset('figure');
    },

    async 'FigureStrategy::CDO configuration' () {
        // Verify CDO configuration
        $require.eq(await cdo.strategy(), strategy.address, 'CDO strategy should match');
        $require.eq(await cdo.jrtVault(), jrtVault.address, 'CDO jrtVault should match');
        $require.eq(await cdo.srtVault(), srtVault.address, 'CDO srtVault should match');
        $require.eq(await jrtVault.asset(), USDC.address, 'JRT vault asset should be USDC');
        $require.eq(await srtVault.asset(), USDC.address, 'SRT vault asset should be USDC');

        // Verify strategy points to CDO
        $require.eq(await strategy.cdo(), cdo.address, 'Strategy should point to CDO');
    },

    async 'FigureStrategy::Strategy configuration' () {
        // Verify strategy token references
        $require.eq(await strategy.usdc(), USDC.address, 'Strategy USDC should match');
        $require.eq(await strategy.yieldVault(), yieldVault.address, 'Strategy yieldVault should match');
        $require.eq((await strategy.stakingVault()).toLowerCase(), stakingVault.address, 'Strategy stakingVault should match'); //weird that this is the only address with case issues

        // Verify cooldowns (0 by default)
        const jrtCooldown = await strategy.primeCooldownJrt();
        const srtCooldown = await strategy.primeCooldownSrt();
        $require.eq(jrtCooldown, 0n, 'JRT cooldown should be 0');
        $require.eq(srtCooldown, 0n, 'SRT cooldown should be 0');
    },

    async 'FigureStrategy::Feed and Accounting' () {
        // Verify feed configuration
        const stalePeriod = await feed.roundStaleAfter();
        const expectedStalePeriod = $date.parseTimespan(test.factory.platform.Feed?.stalePeriodAfter || '4hours', { get: 's' });
        $require.eq(stalePeriod, BigInt(expectedStalePeriod), 'Feed stale period should match platform configuration');
        $require.eq(await accounting.aprPairFeed(), feed.address, 'Accounting feed should match');
        $require.eq(await accounting.cdo(), cdo.address, 'Accounting should point to CDO');
    },

    async 'FigureStrategy::Cooldown configuration' () {
        // Verify strategy has cooldown contracts
        $require.eq(
            $address.eq(await strategy.erc20Cooldown(), $address.ZERO),
            false,
            'Strategy should have ERC20Cooldown'
        );
        $require.eq(
            $address.eq(await strategy.unstakeCooldown(), $address.ZERO),
            false,
            'Strategy should have UnstakeCooldown'
        );

        // Verify cooldown implementation is set for wYLDS
        const impl = await unstakeCooldown.implementations(yieldVault.address);
        $require.eq(
            $address.eq(impl, $address.ZERO),
            false,
            'UnstakeCooldown should have implementation for wYLDS'
        );
    },

    async 'FigureStrategy::Supported tokens' () {
        const tokens = await strategy.getSupportedTokens();
        $require.eq(tokens.length, 3, 'Strategy should support 3 tokens');
        $require.eq(tokens[0].toLowerCase(), stakingVault.address, 'First supported token should be PRIME (StakingVault)');
        $require.eq(tokens[1], yieldVault.address, 'Second supported token should be wYLDS (YieldVault)');
        $require.eq(tokens[2], USDC.address, 'Third supported token should be USDC');
    },

    async 'FigureStrategy::Unsupported token reverts' () {
        const random = '0x0000000000000000000000000000000000000001';
        const { error } = await $promise.caught(strategy.convertToAssets(random, 100n, 0));
        $require.match(/UnsupportedToken/, error?.message, 'Revert expected on unsupported token');
    },

    async 'FigureStrategy::deposit' () {
        const DEPOSIT_AMOUNT = 1000;

        let _USDC = new ERC20(USDC.address, client);
        await $erc20.setBalanceAny(_USDC, deployer.address, DEPOSIT_AMOUNT);

        await $tranche.deposit(jrtVault, deployer, USDC, DEPOSIT_AMOUNT);

        let balanceInTranche = await $tranche.balanceOfAssets(jrtVault, cdo, deployer.address);
        l`Balance of assets in JRT vault after deposit: ${balanceInTranche}`;
        $require.gt(balanceInTranche, 0, 'JRT vault should have a positive balance of assets after deposit');
    },

    async 'FigureStrategy::withdraw' () {
        const testHelper = new Tranches.figure.TestHelper(test);
        const DEPOSIT_AMOUNT = 1000;

        let _USDC = new ERC20(USDC.address, client);
        await $erc20.setBalanceAny(_USDC, deployer.address, DEPOSIT_AMOUNT);
        await $tranche.deposit(jrtVault, deployer, USDC, DEPOSIT_AMOUNT);

        let usdcBalanceBefore = await USDC.balanceOf(deployer.address);
        l`USDC balance before withdrawal: ${usdcBalanceBefore}`;

        let jrtShares = await jrtVault.balanceOf(deployer.address);

        await $tranche.withdraw(jrtVault, deployer, USDC, jrtShares / 10n ** 18n);
        await testHelper.finalizeUnderlyingUnstake(deployer.address);
        await test.client.debug.mine('1day');


        await unstakeCooldown.$receipt().finalize(deployer, yieldVault.address, deployer.address);

        let usdcBalanceAfter = await USDC.balanceOf(deployer.address);

        l`USDC balance after withdrawal: ${usdcBalanceAfter}`;

        $require.gt(usdcBalanceAfter, usdcBalanceBefore, 'USDC balance should increase after withdrawal');
    },

    async 'FigureStrategy::totalAssets' () {
        let total = await strategy.totalAssets();
        $require.gte(total, 0n, 'totalAssets should process safely');

        let totalWithParams = await strategy.totalAssets(0n, 0n);
        $require.eq(totalWithParams, total, 'Overloaded totalAssets must mirror base totalAssets output');
    },
});
