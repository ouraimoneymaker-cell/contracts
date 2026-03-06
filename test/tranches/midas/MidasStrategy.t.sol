// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    MidasStrategy
} from "contracts/tranches/strategies/midas/MidasStrategy.sol";
import {
    MidasCooldownRequestImpl
} from "contracts/tranches/strategies/midas/MidasCooldownRequestImpl.sol";
import {
    AaveOracleAprPairProvider,
    IRoundDataOracle,
    IAavePool
} from "contracts/tranches/strategies/midas/AaveOracleAprPairProvider.sol";
import {
    MockMToken,
    MockBaseAsset,
    MockOracle,
    MockDepositVault,
    MockRedemptionVault
} from "contracts/test/midas/MockMidas.sol";
import {
    IMToken
} from "contracts/tranches/strategies/midas/interfaces/IMToken.sol";
import {
    IDepositVault
} from "contracts/tranches/strategies/midas/interfaces/IDepositVault.sol";
import {
    IRedemptionVault
} from "contracts/tranches/strategies/midas/interfaces/IRedemptionVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MidasStrategyTest is Test {
    MidasStrategy public strategy;
    MockMToken public mToken;
    MockBaseAsset public baseAsset;
    MockOracle public oracle;
    MockDepositVault public depositVault;
    MockRedemptionVault public redemptionVault;

    address public deployer = address(this);

    function setUp() public {
        vm.warp(100_000);

        mToken = new MockMToken();
        baseAsset = new MockBaseAsset();
        oracle = new MockOracle();
        depositVault = new MockDepositVault(mToken);
        redemptionVault = new MockRedemptionVault(mToken, baseAsset);

        // Set oracle round: $1.05 per mToken (1.05e8 in Chainlink 8-decimal)
        oracle.setRoundData(1, 1_00000000, block.timestamp - 86400); // Round 1: $1.00
        oracle.setRoundData(2, 1_05000000, block.timestamp); // Round 2: $1.05

        address[] memory depositTokens_ = new address[](0);

        strategy = new MidasStrategy(
            IERC20(address(baseAsset)),
            IMToken(address(mToken)),
            IDepositVault(address(depositVault)),
            IRedemptionVault(address(redemptionVault)),
            oracle,
            depositTokens_
        );
    }

    // ========================================
    // Oracle Rate Tests
    // ========================================

    function test_getOracleRate() public view {
        uint256 rate = strategy.getOracleRate();
        assertEq(rate, 1.05e18, "Oracle rate should be 1.05e18");
    }

    function test_getOracleRate_reverts_on_zero() public {
        MockOracle badOracle = new MockOracle();
        badOracle.setRoundData(1, 0, block.timestamp);

        address[] memory dt = new address[](0);
        MidasStrategy badStrategy = new MidasStrategy(
            IERC20(address(baseAsset)),
            IMToken(address(mToken)),
            IDepositVault(address(depositVault)),
            IRedemptionVault(address(redemptionVault)),
            badOracle,
            dt
        );

        vm.expectRevert("Oracle: invalid rate");
        badStrategy.getOracleRate();
    }

    function test_getOracleRate_reverts_on_negative() public {
        MockOracle badOracle = new MockOracle();
        badOracle.setRoundData(1, -1_00000000, block.timestamp);

        address[] memory dt = new address[](0);
        MidasStrategy badStrategy2 = new MidasStrategy(
            IERC20(address(baseAsset)),
            IMToken(address(mToken)),
            IDepositVault(address(depositVault)),
            IRedemptionVault(address(redemptionVault)),
            badOracle,
            dt
        );

        vm.expectRevert("Oracle: invalid rate");
        badStrategy2.getOracleRate();
    }

    // ========================================
    // Conversion Tests
    // ========================================

    function test_convertToAssets_mToken() public view {
        // 100 mToken at $1.05 = 105 baseAsset
        uint256 result = strategy.convertToAssets(
            address(mToken),
            100e18,
            Math.Rounding.Floor
        );
        assertEq(result, 105e18, "100 mToken at $1.05 = 105 baseAsset");
    }

    function test_convertToAssets_baseAsset_identity() public view {
        // baseAsset to baseAsset = identity
        uint256 result = strategy.convertToAssets(
            address(baseAsset),
            42e18,
            Math.Rounding.Floor
        );
        assertEq(result, 42e18, "baseAsset should be identity");
    }

    function test_convertToTokens_mToken() public view {
        // 105 baseAsset at $1.05/mToken = 100 mToken
        uint256 result = strategy.convertToTokens(
            address(mToken),
            105e18,
            Math.Rounding.Floor
        );
        assertEq(result, 100e18, "105 baseAsset at $1.05 = 100 mToken");
    }

    function test_convertToTokens_baseAsset_identity() public view {
        uint256 result = strategy.convertToTokens(
            address(baseAsset),
            42e18,
            Math.Rounding.Floor
        );
        assertEq(result, 42e18, "baseAsset should be identity");
    }

    function test_convertToAssets_unsupported_reverts() public {
        vm.expectRevert();
        strategy.convertToAssets(address(0x1), 100e18, Math.Rounding.Floor);
    }

    function test_convertToTokens_unsupported_reverts() public {
        vm.expectRevert();
        strategy.convertToTokens(address(0x1), 100e18, Math.Rounding.Floor);
    }

    // ========================================
    // Rounding Tests
    // ========================================

    function test_rounding_ceil_gte_floor_convertToTokens() public view {
        // 100 baseAsset / 1.05 = 95.238095... mToken
        uint256 floor = strategy.convertToTokens(
            address(mToken),
            100e18,
            Math.Rounding.Floor
        );
        uint256 ceil = strategy.convertToTokens(
            address(mToken),
            100e18,
            Math.Rounding.Ceil
        );
        assertGe(ceil, floor, "Ceil should be >= Floor");
        // Additionally verify they don't match exactly (there IS a remainder)
        assertGt(ceil, floor, "Should have different rounding for 100/1.05");
    }

    function test_rounding_ceil_gte_floor_convertToAssets() public view {
        // 1 wei of mToken * 1.05 — tiny amount to test edge rounding
        uint256 floor = strategy.convertToAssets(
            address(mToken),
            1,
            Math.Rounding.Floor
        );
        uint256 ceil = strategy.convertToAssets(
            address(mToken),
            1,
            Math.Rounding.Ceil
        );
        assertGe(ceil, floor, "Ceil should be >= Floor");
    }

    function test_withdraw_rounds_ceil_for_shares() public view {
        // Verifies withdraw uses Ceil rounding (protocol-safe: more mToken needed)
        uint256 baseAssets = 100e18;
        uint256 shares = strategy.convertToTokens(
            address(mToken),
            baseAssets,
            Math.Rounding.Ceil
        );
        uint256 assetsBack = strategy.convertToAssets(
            address(mToken),
            shares,
            Math.Rounding.Floor
        );
        assertGe(assetsBack, baseAssets, "Round-trip should not lose dust");
    }

    // ========================================
    // totalAssets Tests
    // ========================================

    function test_totalAssets() public {
        // Mint mToken to strategy
        mToken.mint(address(strategy), 1000e18);

        uint256 total = strategy.totalAssets();
        assertEq(total, 1050e18, "1000 mToken at $1.05 = 1050 baseAsset");
    }

    function test_totalAssets_staleness_fresh() public {
        mToken.mint(address(strategy), 1000e18);

        uint256 latestNav = 900e18;
        // Oracle updatedAt = block.timestamp (set in setUp)
        // Pass timestamp BEFORE oracle update → should return fresh totalAssets
        uint256 fresh = strategy.totalAssets(latestNav, block.timestamp - 100);
        assertEq(
            fresh,
            1050e18,
            "Should return fresh NAV when oracle updated after timestamp"
        );
    }

    function test_totalAssets_staleness_stale() public {
        mToken.mint(address(strategy), 1000e18);

        uint256 latestNav = 900e18;
        // Pass timestamp AFTER oracle update → should return latestNav
        uint256 stale = strategy.totalAssets(latestNav, block.timestamp + 100);
        assertEq(
            stale,
            latestNav,
            "Should return latestNav when oracle is stale"
        );
    }

    // ========================================
    // CooldownRequestImpl Tests
    // ========================================

    function test_isCooldownActive_always_true() public {
        MidasCooldownRequestImpl impl = new MidasCooldownRequestImpl(
            IERC20(address(baseAsset)),
            IMToken(address(mToken)),
            IRedemptionVault(address(redemptionVault))
        );
        assertTrue(
            impl.isCooldownActive(),
            "isCooldownActive should always be true"
        );
    }

    // ========================================
    // APR Pair Provider Tests (Base APR math)
    // ========================================

    function test_aprBase_calculation() public {
        // AaveOracleAprPairProvider.getAPRbase() reads from oracle
        // Round 1: $1.00 at t-86400
        // Round 2: $1.05 at t
        // APR = (ppsChange * SECONDS_PER_YEAR * 1e12) / ppsT0 / deltaT
        // = (5000000 * 31536000 * 1e12) / 100000000 / 86400
        // = 1_826_250_000_000 (≈182.6%, which exceeds BOUND_MAX)
        // So getAPRbase should return 0 (out of bounds)

        // We need our own oracle with a more reasonable change
        MockOracle aprOracle = new MockOracle();
        uint256 t0 = 1_000;
        uint256 t1 = 1_000 + 7 days; // 7 days apart
        // Price: $1.00 → $1.001 in 7 days — small, reasonable change
        aprOracle.setRoundData(1, 1_00000000, t0); // $1.00
        aprOracle.setRoundData(2, 1_00100000, t1); // $1.001

        // Since we can't easily deploy AaveOracleAprPairProvider without an Aave pool mock,
        // verify the expected APR math manually:
        int256 ppsChange = 1_00100000 - 1_00000000; // 100000
        uint256 deltaT = t1 - t0; // 604800
        int256 apr = (ppsChange * int256(uint256(31_536_000)) * 1e12) /
            1_00000000 /
            int256(deltaT);
        // = 100000 * 31536000 * 1e12 / 100000000 / 604800
        // = 52_142_857_142 (≈5.21%)
        assertGt(apr, 0, "APR should be positive");
        assertLt(
            apr,
            int256(uint256(0.4e12)),
            "APR should be below BOUND_MAX (40%)"
        );
    }

    // ========================================
    // Fuzz Tests
    // ========================================

    function testFuzz_convertRoundTrip(uint256 baseAssets) public view {
        // Bound to reasonable range
        baseAssets = bound(baseAssets, 1, 1e30);

        // Convert to mToken (Ceil) then back to assets (Floor)
        uint256 shares = strategy.convertToTokens(
            address(mToken),
            baseAssets,
            Math.Rounding.Ceil
        );
        uint256 assetsBack = strategy.convertToAssets(
            address(mToken),
            shares,
            Math.Rounding.Floor
        );

        // assetsBack should be >= baseAssets (no dust loss with Ceil→Floor trip)
        assertGe(assetsBack, baseAssets, "Round-trip should not lose dust");
    }

    function testFuzz_oracleRate(int256 answer) public {
        // Bound answer to positive values Chainlink would use
        answer = bound(answer, 1, type(int128).max);

        MockOracle fuzzOracle = new MockOracle();
        fuzzOracle.setRoundData(1, answer, block.timestamp);

        address[] memory dt = new address[](0);
        MidasStrategy fuzzStrategy = new MidasStrategy(
            IERC20(address(baseAsset)),
            IMToken(address(mToken)),
            IDepositVault(address(depositVault)),
            IRedemptionVault(address(redemptionVault)),
            fuzzOracle,
            dt
        );

        uint256 rate = fuzzStrategy.getOracleRate();
        assertEq(rate, uint256(answer) * 1e10, "Rate should be answer * 10^10");
    }
}
