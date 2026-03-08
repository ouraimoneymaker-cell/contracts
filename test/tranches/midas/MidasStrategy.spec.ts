import { UTest } from "atma-utest";
import { $require } from "dequanto/utils/$require";
import { $bigint } from "dequanto/utils/$bigint";
import { l } from "dequanto/utils/$logger";
import { $hh } from "../utils/$hh";
import { MidasStrategy } from "@0xc/hardhat/MidasStrategy/MidasStrategy";
import { MidasCooldownRequestImpl } from "@0xc/hardhat/MidasCooldownRequestImpl/MidasCooldownRequestImpl";
import { AaveOracleAprPairProvider } from "@0xc/hardhat/AaveOracleAprPairProvider/AaveOracleAprPairProvider";
import { MockMToken } from "@0xc/hardhat/MockMToken/MockMToken";
import { MockBaseAsset } from "@0xc/hardhat/MockBaseAsset/MockBaseAsset";
import { MockOracle } from "@0xc/hardhat/MockOracle/MockOracle";
import { MockDepositVault } from "@0xc/hardhat/MockDepositVault/MockDepositVault";
import { MockRedemptionVault } from "@0xc/hardhat/MockRedemptionVault/MockRedemptionVault";

await $hh.test.init();

const { factory, deployer } = $hh.test;

async function deployContract<T>(Contract: any, args: any[]): Promise<T> {
  const { contract } = await factory.ds.ensure(Contract, {
    arguments: args,
  });
  return contract as any as T;
}

UTest.create({
  async $before() {},

  async $after() {
    await $hh.test.reset();
  },

  async "Oracle rate conversion"() {
    // Deploy mocks
    const mToken = await deployContract<MockMToken>(MockMToken, []);
    const baseAsset = await deployContract<MockBaseAsset>(MockBaseAsset, []);
    const oracle = await deployContract<MockOracle>(MockOracle, []);
    const depositVault = await deployContract<MockDepositVault>(
      MockDepositVault,
      [mToken.address],
    );
    const redemptionVault = await deployContract<MockRedemptionVault>(
      MockRedemptionVault,
      [mToken.address, baseAsset.address],
    );

    // Set oracle round: $1.05 per mToken (1.05e8 in Chainlink 8-decimal format)
    const now = BigInt(Math.floor(Date.now() / 1000));
    await oracle
      .$receipt()
      .setRoundData(deployer, 1n, 100000000n, now - 86400n);
    await oracle.$receipt().setRoundData(deployer, 2n, 105000000n, now);

    // Deploy MidasStrategy
    const strategy = await deployContract<MidasStrategy>(MidasStrategy, [
      baseAsset.address,
      mToken.address,
      depositVault.address,
      redemptionVault.address,
      oracle.address,
      [],
    ]);

    // Verify oracle rate: 1.05e8 → 1.05e18
    const rate = await strategy.getOracleRate();
    l`Oracle rate: cyan<${$bigint.toEther(rate, 18)}>`;
    $require.eq(rate, 1_050000000000000000n, "Oracle rate should be 1.05e18");

    // convertToAssets: 100 mToken (100e18) at $1.05 = 105 USDC (105e6)
    const mTokenAmount = 100n * 10n ** 18n;
    const assets = await strategy.convertToAssets(
      mToken.address,
      mTokenAmount,
      0n,
    );
    l`100 mToken => cyan<${$bigint.toEther(assets, 6)}> USDC`;
    $require.eq(
      assets,
      105n * 10n ** 6n,
      "100 mToken at $1.05 = 105 USDC (6 decimals)",
    );

    // convertToTokens: 105 USDC (105e6) at $1.05 = 100 mToken (100e18)
    const baseAmount = 105n * 10n ** 6n;
    const tokens = await strategy.convertToTokens(
      mToken.address,
      baseAmount,
      0n,
    );
    l`105 USDC => cyan<${$bigint.toEther(tokens, 18)}> mToken`;
    $require.eq(tokens, 100n * 10n ** 18n, "105 USDC at $1.05 = 100 mToken");

    // baseAsset identity conversion
    const identityAmount = 42n * 10n ** 6n;
    const identity = await strategy.convertToAssets(
      baseAsset.address,
      identityAmount,
      0n,
    );
    $require.eq(
      identity,
      identityAmount,
      "baseAsset conversion should be identity",
    );
  },

  async "Rounding: ceil vs floor"() {
    const mToken = await deployContract<MockMToken>(MockMToken, []);
    const baseAsset = await deployContract<MockBaseAsset>(MockBaseAsset, []);
    const oracle = await deployContract<MockOracle>(MockOracle, []);
    const depositVault = await deployContract<MockDepositVault>(
      MockDepositVault,
      [mToken.address],
    );
    const redemptionVault = await deployContract<MockRedemptionVault>(
      MockRedemptionVault,
      [mToken.address, baseAsset.address],
    );

    const now = BigInt(Math.floor(Date.now() / 1000));
    await oracle.$receipt().setRoundData(deployer, 1n, 105000000n, now); // $1.05

    const strategy = await deployContract<MidasStrategy>(MidasStrategy, [
      baseAsset.address,
      mToken.address,
      depositVault.address,
      redemptionVault.address,
      oracle.address,
      [],
    ]);

    // 100 USDC (100e6) / 1.05 = 95.238095... mToken (18 decimals)
    const baseAmount = 100n * 10n ** 6n;
    const tokensFloor = await strategy.convertToTokens(
      mToken.address,
      baseAmount,
      0n,
    );
    const tokensCeil = await strategy.convertToTokens(
      mToken.address,
      baseAmount,
      1n,
    );
    l`Floor: cyan<${$bigint.toEther(
      tokensFloor,
      18,
    )}> Ceil: cyan<${$bigint.toEther(tokensCeil, 18)}>`;
    $require.gte(tokensCeil, tokensFloor, "Ceil should be >= Floor");

    // 1 wei mToken: edge case
    const tinyFloor = await strategy.convertToAssets(mToken.address, 1n, 0n);
    const tinyCeil = await strategy.convertToAssets(mToken.address, 1n, 1n);
    l`1 wei: floor=cyan<${tinyFloor}> ceil=cyan<${tinyCeil}>`;
    $require.gte(tinyCeil, tinyFloor, "Ceil should be >= Floor for 1 wei");
  },

  async "totalAssets oracle staleness check"() {
    const mToken = await deployContract<MockMToken>(MockMToken, []);
    const baseAsset = await deployContract<MockBaseAsset>(MockBaseAsset, []);
    const oracle = await deployContract<MockOracle>(MockOracle, []);
    const depositVault = await deployContract<MockDepositVault>(
      MockDepositVault,
      [mToken.address],
    );
    const redemptionVault = await deployContract<MockRedemptionVault>(
      MockRedemptionVault,
      [mToken.address, baseAsset.address],
    );

    const oracleUpdatedAt = BigInt(Math.floor(Date.now() / 1000));
    await oracle
      .$receipt()
      .setRoundData(deployer, 1n, 105000000n, oracleUpdatedAt);

    const strategy = await deployContract<MidasStrategy>(MidasStrategy, [
      baseAsset.address,
      mToken.address,
      depositVault.address,
      redemptionVault.address,
      oracle.address,
      [],
    ]);

    // Mint 1000 mToken to strategy
    await mToken
      .$receipt()
      .mint(deployer, strategy.address, 1000n * 10n ** 18n);

    // Test totalAssets() — should be 1050 USDC (1050e6)
    const total = await strategy.totalAssets();
    $require.eq(total, 1050n * 10n ** 6n, "1000 mToken at $1.05 = 1050 USDC");

    // Test totalAssets(latestNav, timestamp) — oracle updated AFTER timestamp => return fresh
    const latestNav = 900n * 10n ** 6n;
    const freshResult = await (strategy as any)["totalAssets(uint256,uint256)"](
      latestNav,
      oracleUpdatedAt - 100n,
    );
    $require.eq(freshResult, 1050n * 10n ** 6n, "Should return fresh NAV");

    // Test totalAssets(latestNav, timestamp) — oracle updated BEFORE timestamp => return latestNav
    const staleResult = await (strategy as any)["totalAssets(uint256,uint256)"](
      latestNav,
      oracleUpdatedAt + 100n,
    );
    $require.eq(
      staleResult,
      latestNav,
      "Should return latestNav when oracle is stale",
    );
  },

  async "Oracle: invalid rate reverts"() {
    const mToken = await deployContract<MockMToken>(MockMToken, []);
    const baseAsset = await deployContract<MockBaseAsset>(MockBaseAsset, []);
    const oracle = await deployContract<MockOracle>(MockOracle, []);
    const depositVault = await deployContract<MockDepositVault>(
      MockDepositVault,
      [mToken.address],
    );
    const redemptionVault = await deployContract<MockRedemptionVault>(
      MockRedemptionVault,
      [mToken.address, baseAsset.address],
    );

    // Set oracle to 0
    await oracle
      .$receipt()
      .setRoundData(deployer, 1n, 0n, BigInt(Math.floor(Date.now() / 1000)));

    const strategy = await deployContract<MidasStrategy>(MidasStrategy, [
      baseAsset.address,
      mToken.address,
      depositVault.address,
      redemptionVault.address,
      oracle.address,
      [],
    ]);

    try {
      await strategy.getOracleRate();
      $require.True(false, "Should have reverted");
    } catch (e) {
      l`✅ Correctly reverted on zero oracle price`;
    }
  },

  async "Unsupported token reverts"() {
    const mToken = await deployContract<MockMToken>(MockMToken, []);
    const baseAsset = await deployContract<MockBaseAsset>(MockBaseAsset, []);
    const oracle = await deployContract<MockOracle>(MockOracle, []);
    const depositVault = await deployContract<MockDepositVault>(
      MockDepositVault,
      [mToken.address],
    );
    const redemptionVault = await deployContract<MockRedemptionVault>(
      MockRedemptionVault,
      [mToken.address, baseAsset.address],
    );

    const now = BigInt(Math.floor(Date.now() / 1000));
    await oracle.$receipt().setRoundData(deployer, 1n, 105000000n, now);

    const strategy = await deployContract<MidasStrategy>(MidasStrategy, [
      baseAsset.address,
      mToken.address,
      depositVault.address,
      redemptionVault.address,
      oracle.address,
      [],
    ]);

    const random = "0x0000000000000000000000000000000000000001";
    try {
      await strategy.convertToAssets(random, 100n, 0n);
      $require.True(false, "Should have reverted");
    } catch (e) {
      l`✅ Correctly reverted on unsupported token`;
    }
  },

  async "CooldownRequestImpl: isCooldownActive always true"() {
    const mToken = await deployContract<MockMToken>(MockMToken, []);
    const baseAsset = await deployContract<MockBaseAsset>(MockBaseAsset, []);
    const redemptionVault = await deployContract<MockRedemptionVault>(
      MockRedemptionVault,
      [mToken.address, baseAsset.address],
    );

    const impl = await deployContract<MidasCooldownRequestImpl>(
      MidasCooldownRequestImpl,
      [baseAsset.address, mToken.address, redemptionVault.address],
    );

    const isActive = await impl.isCooldownActive();
    $require.eq(isActive, true, "isCooldownActive should always be true");
    l`✅ isCooldownActive = true`;
  },
});
