// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {NeutrlDeploy} from "./NeutrlDeploy.t.sol";
import {IsNUSD} from "../../contracts/tranches/strategies/neutrl/IsNUSD.sol";
import {ICooldown} from "../../contracts/tranches/interfaces/cooldown/ICooldown.sol";
import {ISharesCooldown} from "../../contracts/tranches/interfaces/cooldown/ISharesCooldown.sol";
import {SharesCooldown} from "../../contracts/tranches/base/cooldown/SharesCooldown.sol";
import {CooldownBase} from "../../contracts/tranches/base/cooldown/CooldownBase.sol";
import {IStrataCDO} from "../../contracts/tranches/interfaces/IStrataCDO.sol";
import {ITranche} from "../../contracts/tranches/interfaces/ITranche.sol";
import {ISharesCooldown} from "../../contracts/tranches/interfaces/cooldown/ISharesCooldown.sol";

/**
 * @title SIP2Test - Shares Cooldown Exit Mode Tests
 * @notice Tests for the SharesLock exit mode as specified in SIP-01 and SIP-02
 */
contract SIP2Test is NeutrlDeploy {
    // Test users
    address public alice;
    address public bob;

    // SharesCooldown contract
    SharesCooldown public sharesCooldown;

    // Test amounts
    uint256 constant INITIAL_BALANCE = 10000 ether;
    uint256 constant DEPOSIT_AMOUNT = 1000 ether;
    uint256 constant MIN_SHARES = 1 ether;

    // Coverage thresholds (in ppm, 1e6 = 100%)
    uint32 constant COVERAGE_THRESHOLD_P0 = 0.5e6; // 50%
    uint32 constant COVERAGE_THRESHOLD_P1 = 1.0e6; // 100%

    // Cooldown periods (in seconds)
    uint32 constant COOLDOWN_7_DAYS = 7 days;
    uint32 constant COOLDOWN_3_DAYS = 3 days;
    uint32 constant COOLDOWN_0 = 0;

    // Fee rates (in ppm, 1e6 = 100%)
    uint32 constant FEE_2_PERCENT = 0.02e6; // 2%
    uint32 constant FEE_1_PERCENT = 0.01e6; // 1%
    uint32 constant FEE_0 = 0;

    function setUp() public override {
        super.setUp();
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        _deployStrataStack();
        _deploySharesCooldown();
        _mintNUSD(alice, INITIAL_BALANCE);
        _mintNUSD(bob, INITIAL_BALANCE);
        _disableSNUSDCooldown();
    }

    /*//////////////////////////////////////////////////////////////
                         SHARES COOLDOWN TESTS
    //////////////////////////////////////////////////////////////*/
    function test_SharesCooldownIsConfigured() public view {
        assertEq(address(cdo.sharesCooldown()), address(sharesCooldown), "SharesCooldown should be configured");
    }

    function test_ExitParams_LowCoverage_HighFeeAndLongCooldown() public {
        _depositToJrt(alice, DEPOSIT_AMOUNT);
        _depositToSrt(alice, DEPOSIT_AMOUNT * 3);
        uint32 coverage = cdo.coverage();
        assertLt(coverage, COVERAGE_THRESHOLD_P0, "Coverage should be below P0");
        (IStrataCDO.TExitMode mode, uint256 exitFee, uint32 cooldownSeconds) =
            cdo.calculateExitMode(address(jrtVault), alice);
        assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.SharesLock), "Should be SharesLock mode");
        assertEq(exitFee, uint256(FEE_2_PERCENT) * 1e18 / 1e6, "Should have 2% fee");
        assertEq(cooldownSeconds, COOLDOWN_7_DAYS, "Should have 7 day cooldown");
    }

    function test_SharesCooldownCanOverReserveJrtWithdrawalCapacity() public {
        // With the default 5% hard floor, 10,000 SRT requires 500 JRT to remain.
        _depositToJrt(alice, DEPOSIT_AMOUNT);
        _depositToJrt(bob, DEPOSIT_AMOUNT);
        _depositToSrt(alice, DEPOSIT_AMOUNT * 5);
        _depositToSrt(bob, DEPOSIT_AMOUNT * 5);

        uint256 initialCapacity = cdo.maxWithdraw(address(jrtVault), alice);
        assertEq(initialCapacity, 1_500 ether, "unexpected initial JRT withdrawal capacity");

        (IStrataCDO.TExitMode mode,, uint32 cooldownSeconds) =
            cdo.calculateExitMode(address(jrtVault), alice);
        assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.SharesLock), "test requires shares lock");

        vm.prank(alice);
        jrtVault.redeem(sNUSD, jrtVault.balanceOf(alice), alice, alice);

        // The 2% exit fee moves 20 assets from JRT NAV to reserve, but the 980 assets
        // represented by Alice's pending shares are not reserved from Bob's capacity.
        uint256 capacityAfterFirstRequest = cdo.maxWithdraw(address(jrtVault), bob);
        uint256 alicePendingAssets = jrtVault.convertToAssets(jrtVault.balanceOf(address(sharesCooldown)));
        assertEq(capacityAfterFirstRequest, initialCapacity - 20 ether, "unexpected capacity after exit fee");
        assertGt(
            capacityAfterFirstRequest + alicePendingAssets,
            initialCapacity,
            "pending redemption unexpectedly reserved capacity"
        );

        vm.prank(bob);
        jrtVault.redeem(sNUSD, jrtVault.balanceOf(bob), bob, bob);

        vm.warp(block.timestamp + cooldownSeconds);

        uint256 aliceBefore = IERC20(sNUSD).balanceOf(alice);
        sharesCooldown.finalize(jrtVault, sNUSD, alice);
        uint256 aliceReceived = IERC20(sNUSD).balanceOf(alice) - aliceBefore;

        uint256 normalCapacityBeforeSecondFinalize = cdo.maxWithdraw(address(jrtVault), bob);
        uint256 bobPendingAssets = jrtVault.convertToAssets(jrtVault.balanceOf(address(sharesCooldown)));
        assertLt(
            normalCapacityBeforeSecondFinalize,
            bobPendingAssets,
            "hard floor does not block the full second withdrawal"
        );

        uint256 bobBefore = IERC20(sNUSD).balanceOf(bob);
        sharesCooldown.finalize(jrtVault, sNUSD, bob);
        uint256 bobReceived = IERC20(sNUSD).balanceOf(bob) - bobBefore;

        assertGt(bobReceived, 0, "over-reserved redemption did not settle");
        assertGt(
            aliceReceived + bobReceived,
            initialCapacity,
            "aggregate cooldown exits did not exceed initial JRT capacity"
        );
    }

    function test_ExitParams_MediumCoverage_MediumFeeAndCooldown() public {
        _depositToJrt(alice, DEPOSIT_AMOUNT * 3);
        _depositToSrt(alice, DEPOSIT_AMOUNT * 4);
        uint32 coverage = cdo.coverage();
        assertGe(coverage, COVERAGE_THRESHOLD_P0, "Coverage should be >= P0");
        assertLt(coverage, COVERAGE_THRESHOLD_P1, "Coverage should be < P1");
        (IStrataCDO.TExitMode mode, uint256 exitFee, uint32 cooldownSeconds) =
            cdo.calculateExitMode(address(jrtVault), alice);
        assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.SharesLock), "Should be SharesLock mode");
        assertEq(exitFee, uint256(FEE_1_PERCENT) * 1e18 / 1e6, "Should have 1% fee");
        assertEq(cooldownSeconds, COOLDOWN_3_DAYS, "Should have 3 day cooldown");
    }

    function test_ExitParams_HighCoverage_NoFeeNoCooldown() public {
        _depositToJrt(alice, DEPOSIT_AMOUNT * 2);
        _depositToSrt(alice, DEPOSIT_AMOUNT);
        uint32 coverage = cdo.coverage();
        assertGe(coverage, COVERAGE_THRESHOLD_P1, "Coverage should be >= P1");
        (IStrataCDO.TExitMode mode, uint256 exitFee, uint32 cooldownSeconds) =
            cdo.calculateExitMode(address(jrtVault), alice);
        assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.Fee), "Should be Fee mode when no cooldown");
        assertEq(exitFee, 0, "Should have 0% fee");
        assertEq(cooldownSeconds, 0, "Should have 0 cooldown");
    }
}
