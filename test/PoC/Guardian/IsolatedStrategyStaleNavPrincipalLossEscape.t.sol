// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IsolatedIntegrationDeploy } from "../../isolated/IsolatedVaultIntegration.t.sol";

/// @notice Tests the loss-side consequence of MultiStrategy's all-or-nothing NAV freshness gate.
///         A real Spark backing loss can be recognized by the Junior child while a stale Midas
///         child keeps aggregate accounting at the pre-loss NAV. A pre-existing JRT holder can
///         then redeem at the stale price, with IsolatedStrategy intentionally sourcing JRT exits
///         from Senior/Midas liquidity first. Once Midas becomes fresh, the hidden loss is charged
///         to the holders who remained in the system and can spill into SRT.
contract IsolatedStrategyStaleNavPrincipalLossEscapeTest is IsolatedIntegrationDeploy {
    address internal alice;
    address internal bob;

    uint256 internal constant INITIAL_BALANCE = 10_000e6;

    // Bob owns almost all Junior risk before the hidden loss. Alice leaves enough JRT behind
    // for Bob's full stale-priced redemption to remain above the protocol's 5% JRT/SRT floor.
    uint256 internal constant ALICE_JRT_SEED = 60e6;
    uint256 internal constant BOB_JRT_SEED = 940e6;
    uint256 internal constant SRT_SEED = 1_000e6;

    // A tiny, already-reconciled principal loss is used only to advance lastReconciliation
    // beyond Midas's original oracle timestamp. No intentional strategy yield is introduced.
    uint256 internal constant ANCHOR_LOSS = 1e6;
    uint256 internal constant ANCHOR_TRIGGER_DEPOSIT = 1e6;

    // Economically relevant loss that must remain hidden until after Bob exits.
    uint256 internal constant HIDDEN_PRINCIPAL_LOSS = 100e6;
    uint256 internal constant LOSS_TRIGGER_DEPOSIT = 1e6;
    uint256 internal constant RECONCILE_TRIGGER_DEPOSIT = 1e6;

    function setUp() public override {
        super.setUp();

        alice = makeAddr("alice");
        bob = makeAddr("bob");

        _deployIntegrationStack();

        baseAsset.mint(alice, INITIAL_BALANCE);
        baseAsset.mint(bob, INITIAL_BALANCE);
    }

    function test_JrtCanEscapeHiddenJuniorPrincipalLossIntoSeniorLiquidity() public {
        (uint256 bobShares, uint256 hiddenLoss) = _prepareRecognizedSparkLossHiddenByStaleMidas();

        uint256 staleQuote = jrtVault.previewRedeem(bobShares);
        assertGt(staleQuote, 0, "stale JRT quote is zero");

        (uint256 jrtBeforeExit, uint256 srtBeforeExit,) = accounting.totalAssetsT0();
        uint256 juniorPhysicalBeforeExit = juniorStrat.totalAssets();
        uint256 seniorPhysicalBeforeExit = seniorStrat.totalAssets();

        assertGt(seniorPhysicalBeforeExit, staleQuote, "Senior/Midas cannot fund the stale JRT exit");
        assertGt(jrtBeforeExit, staleQuote, "Bob's redemption exceeds stale JRT NAV");
        assertGe(jrtVault.maxRedeem(bob), bobShares, "stale exit is blocked by the JRT/SRT withdrawal floor");

        uint256 bobBefore = baseAsset.balanceOf(bob);
        vm.prank(bob);
        uint256 payout = jrtVault.redeem(bobShares, bob, bob);

        assertEq(payout, staleQuote, "Bob did not exit at the stale JRT quote");
        assertEq(
            juniorStrat.totalAssets(),
            juniorPhysicalBeforeExit,
            "JRT exit unexpectedly consumed Junior/Spark liquidity"
        );

        uint256 seniorLiquidityUsed = seniorPhysicalBeforeExit - seniorStrat.totalAssets();
        assertApproxEqAbs(
            seniorLiquidityUsed,
            payout,
            2,
            "stale JRT exit was not funded from Senior/Midas liquidity"
        );

        // The Midas base-asset redemption settles asynchronously. Prove Bob receives actual USDC,
        // not merely an accounting quote or cooldown receipt.
        vm.warp(block.timestamp + 3 days);
        redemptionVault.fulfillRequest(0);
        unstakeCooldown.finalize(IERC20(address(mHYPER)), address(bob));

        uint256 received = baseAsset.balanceOf(bob) - bobBefore;
        assertEq(received, payout, "Bob's stale-priced exit did not physically settle");

        // Bob is gone, but the aggregate still carries the hidden Spark loss because Midas has
        // remained stale relative to lastReconciliation.
        (uint256 jrtAfterExit, uint256 srtAfterExit,) = accounting.totalAssetsT0();
        assertEq(srtAfterExit, srtBeforeExit, "SRT accounting changed before loss reconciliation");
        assertLt(jrtAfterExit, hiddenLoss, "remaining JRT is large enough to absorb the hidden loss");
        assertEq(
            accounting.nav() - strategy.totalAssets(),
            hiddenLoss,
            "hidden physical deficit changed during Bob's exit"
        );

        // Normal oracle freshness resumes; its price remains $1. An ordinary JRT deposit then
        // performs the same pre-deposit accounting checkpoint any user action would perform,
        // releasing the already-known Spark loss after Bob has escaped.
        oracle.setRoundData(int256(1e8));
        _depositJrt(alice, RECONCILE_TRIGGER_DEPOSIT);

        (uint256 jrtAfterReconcile, uint256 srtAfterReconcile,) = accounting.totalAssetsT0();
        uint256 jrtLossChargedAfterBobLeft =
            jrtAfterExit + RECONCILE_TRIGGER_DEPOSIT - jrtAfterReconcile;
        uint256 srtLossChargedAfterBobLeft = srtAfterExit - srtAfterReconcile;

        assertGt(srtLossChargedAfterBobLeft, 0, "hidden Junior loss did not spill into SRT");
        assertApproxEqAbs(
            jrtLossChargedAfterBobLeft + srtLossChargedAfterBobLeft,
            hiddenLoss,
            3,
            "post-exit holders were not charged the hidden principal loss"
        );
        assertEq(strategy.totalAssets(), accounting.nav(), "aggregate remained insolvent after fresh reconciliation");
    }

    function test_Control_FreshMidasChargesBobBeforeHeCanExit() public {
        (uint256 bobShares, uint256 hiddenLoss) = _prepareRecognizedSparkLossHiddenByStaleMidas();

        // This is the exact stale claim Bob can take in the attack path.
        uint256 staleQuote = jrtVault.previewRedeem(bobShares);
        (, uint256 srtBeforeLoss,) = accounting.totalAssetsT0();

        // Counterfactual control: Midas is fresh before Bob exits, so the same physical Spark loss
        // is reconciled by an ordinary JRT deposit while Bob still owns almost all of the JRT risk.
        oracle.setRoundData(int256(1e8));
        _depositJrt(alice, RECONCILE_TRIGGER_DEPOSIT);
        assertApproxEqAbs(
            strategy.totalAssets(),
            accounting.nav(),
            1,
            "fresh control did not reconcile the physical loss"
        );

        uint256 freshQuote = jrtVault.previewRedeem(bobShares);
        (, uint256 srtAfterLoss,) = accounting.totalAssetsT0();

        assertLt(freshQuote, staleQuote, "fresh loss recognition did not reduce Bob's JRT claim");
        assertGt(
            staleQuote - freshQuote,
            hiddenLoss * 9 / 10,
            "Bob did not escape a material pro-rata share of the hidden principal loss"
        );
        assertEq(srtAfterLoss, srtBeforeLoss, "control loss should be absorbed by JRT while Bob remains");
        assertGe(jrtVault.maxRedeem(bob), bobShares, "fresh control is blocked by the JRT/SRT withdrawal floor");

        uint256 bobBefore = baseAsset.balanceOf(bob);
        vm.prank(bob);
        uint256 payout = jrtVault.redeem(bobShares, bob, bob);
        assertApproxEqAbs(payout, freshQuote, 2, "freshly priced control payout differs from preview");

        vm.warp(block.timestamp + 3 days);
        redemptionVault.fulfillRequest(0);
        unstakeCooldown.finalize(IERC20(address(mHYPER)), address(bob));

        assertEq(baseAsset.balanceOf(bob) - bobBefore, payout, "control payout did not physically settle");
    }

    /// @dev Creates a real loss in Spark backing, makes Spark recognize it through an ordinary JRT
    ///      deposit, and proves stale Midas keeps the aggregate at the pre-loss accounting NAV.
    ///      Returns Bob's pre-existing shares and the measured physical/accounting deficit.
    function _prepareRecognizedSparkLossHiddenByStaleMidas()
        internal
        returns (uint256 bobShares, uint256 hiddenLoss)
    {
        _depositJrt(alice, ALICE_JRT_SEED);
        bobShares = _depositJrt(bob, BOB_JRT_SEED);
        _depositSrt(alice, SRT_SEED);

        // First create and fully reconcile a tiny loss. The second ordinary deposit happens one
        // second later, so the successful reconciliation advances lastReconciliation beyond the
        // unchanged Midas oracle timestamp. From this point Midas is stale.
        baseAsset.burn(address(spVault), ANCHOR_LOSS);
        _depositJrt(alice, ANCHOR_TRIGGER_DEPOSIT); // Spark _drip() recognizes the tiny backing loss.
        vm.warp(block.timestamp + 1);
        _depositJrt(alice, ANCHOR_TRIGGER_DEPOSIT); // Pre-deposit update reconciles the tiny loss.

        uint256 reconciliationAnchor = accounting.lastReconciliation();
        assertEq(reconciliationAnchor, block.timestamp, "anchor reconciliation did not advance");
        assertApproxEqAbs(
            strategy.totalAssets(),
            accounting.nav(),
            1,
            "anchor loss was not fully reconciled"
        );

        // Spark can carry a tiny unvested rounding gain after the anchor deposit. If the next
        // deposit occurs immediately, _drip() exits early and the intended principal loss is not
        // recognized. Wait out the real Spark vesting gate so the next ordinary deposit can
        // observe the backing loss without any privileged call.
        vm.warp(block.timestamp + 24 hours);
        assertEq(juniorStrat.getUnvestedAmount(), 0, "Spark vesting still blocks loss recognition");

        // Simulate a real loss of assets held by the external Spark ERC4626 vault. This changes
        // physical backing only; it does not mutate Strata accounting or any production contract.
        uint256 sparkBackingBefore = spVault.previewRedeem(spVault.balanceOf(address(juniorStrat)));
        baseAsset.burn(address(spVault), HIDDEN_PRINCIPAL_LOSS);
        uint256 sparkBackingAfter = spVault.previewRedeem(spVault.balanceOf(address(juniorStrat)));
        assertApproxEqAbs(
            sparkBackingBefore - sparkBackingAfter,
            HIDDEN_PRINCIPAL_LOSS,
            2,
            "Spark backing loss was not physically created"
        );

        // An ordinary JRT deposit first performs aggregate accounting while Midas is stale, then
        // routes into Spark where _drip() recognizes the lower backing. updateBalanceFlow credits
        // only the new deposit, so the newly recognized Spark loss remains outside aggregate NAV.
        _depositJrt(alice, LOSS_TRIGGER_DEPOSIT);

        assertEq(
            accounting.lastReconciliation(),
            reconciliationAnchor,
            "Midas staleness failed to block loss reconciliation"
        );

        uint256 physicalAggregate = strategy.totalAssets();
        uint256 storedNav = accounting.nav();
        assertGt(storedNav, physicalAggregate, "Spark principal loss is not hidden from accounting");

        hiddenLoss = storedNav - physicalAggregate;
        assertApproxEqAbs(hiddenLoss, HIDDEN_PRINCIPAL_LOSS, 3, "unexpected hidden-loss magnitude");
        assertEq(
            strategy.totalAssets(storedNav, reconciliationAnchor),
            storedNav,
            "stale Midas did not veto the fresh lower Spark NAV"
        );
    }

    function _depositJrt(address user, uint256 amount) internal returns (uint256 shares) {
        vm.startPrank(user);
        baseAsset.approve(address(jrtVault), amount);
        shares = jrtVault.deposit(address(baseAsset), amount, user);
        vm.stopPrank();
    }

    function _depositSrt(address user, uint256 amount) internal returns (uint256 shares) {
        vm.startPrank(user);
        baseAsset.approve(address(srtVault), amount);
        shares = srtVault.deposit(address(baseAsset), amount, user);
        vm.stopPrank();
    }
}
