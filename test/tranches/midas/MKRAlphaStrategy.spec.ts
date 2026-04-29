import { UTest } from 'atma-utest';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { l } from 'dequanto/utils/$logger';
import { $hh } from '../utils/$hh';
import { MidasCooldownRequestImpl } from '@0xc/hardhat/MidasCooldownRequestImpl/MidasCooldownRequestImpl';
import { $promise } from 'dequanto/utils/$promise';
import { $date } from 'dequanto/utils/$date';

const test = await $hh.create('mkralpha');

const { mKRALPHA, USDC, oracle, strategy, unstakeCooldown } = await test.deploy();
const { deployer, client } = test;

await test.snapshot('mkralpha');

UTest.create({
    async $before() {},

    async $after() {
        await test.wipe();
    },
    async $teardown() {
        await test.reset('mkralpha');
    },

    async 'Oracle rate conversion'() {
        // Set oracle round: $1.05 per mToken (1.05e8 in Chainlink 8-decimal format)
        const now = BigInt(Math.floor(Date.now() / 1000));
        await oracle.$receipt().setRoundData(deployer, 1n, 100000000n, now - 86400n);
        await oracle.$receipt().setRoundData(deployer, 2n, 105000000n, now);

        // Verify oracle rate: 1.05e8 → 1.05e18
        const rate = await strategy.getOracleRate();
        l`Oracle rate: cyan<${$bigint.toEther(rate, 18)}>`;
        $require.eq(rate, 1_050000000000000000n, 'Oracle rate should be 1.05e18');

        // convertToAssets: 100 mToken (100e18) at $1.05 = 105 USDC (105e6)
        const mTokenAmount = 100n * 10n ** 18n;
        const assets = await strategy.convertToAssets(mKRALPHA.address, mTokenAmount, 0);
        l`100 mToken => cyan<${$bigint.toEther(assets, 6)}> USDC`;
        $require.eq(assets, 105n * 10n ** 6n, '100 mToken at $1.05 = 105 USDC (6 decimals)');

        // convertToTokens: 105 USDC (105e6) at $1.05 = 100 mToken (100e18)
        const baseAmount = 105n * 10n ** 6n;
        const tokens = await strategy.convertToTokens(mKRALPHA.address, baseAmount, 0);
        l`105 USDC => cyan<${$bigint.toEther(tokens, 18)}> mToken`;
        $require.eq(tokens, 100n * 10n ** 18n, '105 USDC at $1.05 = 100 mToken');

        // baseAsset identity conversion
        const identityAmount = 42n * 10n ** 6n;
        const identity = await strategy.convertToAssets(USDC.address, identityAmount, 0);
        $require.eq(identity, identityAmount, 'baseAsset conversion should be identity');
    },

    async 'Rounding: ceil vs floor'() {
        const now = BigInt(Math.floor(Date.now() / 1000));
        await oracle.$receipt().setRoundData(deployer, 1n, 105000000n, now); // $1.05

        // 100 USDC (100e6) / 1.05 = 95.238095... mToken (18 decimals)
        const baseAmount = 100n * 10n ** 6n;
        const tokensFloor = await strategy.convertToTokens(mKRALPHA.address, baseAmount, 0);
        const tokensCeil = await strategy.convertToTokens(mKRALPHA.address, baseAmount, 1);
        l`Floor: cyan<${$bigint.toEther(tokensFloor, 18)}> Ceil: cyan<${$bigint.toEther(tokensCeil, 18)}>`;
        $require.gte(tokensCeil, tokensFloor, 'Ceil should be >= Floor');

        // 1 wei mToken: edge case
        const tinyFloor = await strategy.convertToAssets(mKRALPHA.address, 1n, 0);
        const tinyCeil = await strategy.convertToAssets(mKRALPHA.address, 1n, 1);
        l`1 wei: floor=cyan<${tinyFloor}> ceil=cyan<${tinyCeil}>`;
        $require.gte(tinyCeil, tinyFloor, 'Ceil should be >= Floor for 1 wei');
    },

    async 'totalAssets oracle staleness check'() {
        const oracleUpdatedAt = BigInt(Math.floor(Date.now() / 1000));
        await oracle.$receipt().setRoundData(deployer, 1n, 105000000n, oracleUpdatedAt);

        // Mint 1000 mToken to strategy
        await mKRALPHA.$receipt().mint(deployer, strategy.address, 1000n * 10n ** 18n);

        // Test totalAssets() — should be 1050 USDC (1050e6)
        const total = await strategy.totalAssets();
        $require.eq(total, 1050n * 10n ** 6n, '1000 mToken at $1.05 = 1050 USDC');

        // Test totalAssets(latestNav, timestamp) — oracle updated AFTER timestamp => return fresh
        const latestNav = 900n * 10n ** 6n;
        const freshResult = await strategy.totalAssets(latestNav, oracleUpdatedAt - 100n);
        $require.eq(freshResult, 1050n * 10n ** 6n, 'Should return fresh NAV');

        // Test totalAssets(latestNav, timestamp) — oracle updated BEFORE timestamp => return latestNav
        const staleResult = await strategy.totalAssets(latestNav, oracleUpdatedAt + 100n);
        $require.eq(staleResult, latestNav, 'Should return latestNav when oracle is stale');
    },

    async 'Oracle: invalid rate reverts'() {
        // Set oracle to 0
        await oracle.$receipt().setRoundData(deployer, 1n, 0n, BigInt($date.toUnixTimestamp()));

        const { error } = await $promise.caught(strategy.getOracleRate());
        $require.match(/InvalidRate/, error?.message, `Revert expected on zero oracle price`);
    },

    async 'Unsupported token reverts'() {
        const now = BigInt(Math.floor(Date.now() / 1000));
        await oracle.$receipt().setRoundData(deployer, 1n, 105000000n, now);

        const random = '0x0000000000000000000000000000000000000001';

        const { error } = await $promise.caught(strategy.convertToAssets(random, 100n, 0));
        $require.match(/UnsupportedToken/, error.message, `Revert expected on unsupported token`);
    },

    async 'CooldownRequestImpl: isCooldownActive always true'() {
        const impl = new MidasCooldownRequestImpl(await unstakeCooldown.implementations(mKRALPHA.address), client);

        const isActive = await impl.isCooldownActive();
        $require.eq(isActive, true, 'isCooldownActive should always be true');
        l`✅ isCooldownActive = true`;
    },
});
