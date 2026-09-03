// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/Test.sol";
import {NestOpalDYSStaleLossPoC} from "./NestOpalDYSStaleLossPoC.t.sol";
import {IStrataCDO} from "../../contracts/tranches/interfaces/IStrataCDO.sol";

/// @notice Economic realism regression for the nOPAL stale-loss first-redeemer candidate.
/// @dev Uses the production >30% JRT Fee tier and a JRT/SRT ratio close to the live market
///      observed during review (~5.9x). A 20 bps underlying nOPAL loss is intentionally larger
///      than the break-even rate move needed for Junior first-loss amplification to exceed the
///      15 bps immediate-exit fee.
contract NestOpalDYSStaleLossEconomics is NestOpalDYSStaleLossPoC {
    function test_CurrentLikeCoverageTwentyBpsLossCreatesRationalImmediateExit() public {
        // setUp starts with JRT=400 and SRT=1000. Add 5,500 JRT so coverage is ~590%,
        // close to the live nOPAL market ratio observed during the review.
        uint256 extraJunior = 5_500 * ONE;
        nOpal.mint(victim, extraJunior);
        _depositJrt(victim, extraJunior);

        assertApproxEqAbs(accounting.jrtNav(), 5_900 * ONE, 2, "current-like JRT NAV");
        assertApproxEqAbs(accounting.srtNav(), 1_000 * ONE, 2, "current-like SRT NAV");
        assertApproxEqAbs(cdo.coverage(), 5_900_000, 10, "current-like coverage ppm");

        (IStrataCDO.TExitMode mode, uint256 exitFee, uint32 lockSeconds) =
            cdo.calculateExitMode(address(jrtVault), attacker);
        assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.Fee), "must remain production Fee mode");
        assertEq(exitFee, 0.0015e18, "production JRT immediate-exit fee");
        assertEq(lockSeconds, 0, "no share lock above 30% coverage");

        uint256 grossClaimBeforeLoss = jrtVault.convertToAssets(attackerShares);
        uint256 immediateExitFeeCost = grossClaimBeforeLoss * exitFee / 1e18;

        // A legitimate 20 bps accountant-rate loss arrives one hour after reconciliation.
        vm.warp(block.timestamp + 1 hours);
        nestAccountant.setExchangeRate(998_000);

        assertEq(
            strategy.totalAssets(accounting.nav(), accounting.lastReconciliation()),
            accounting.nav(),
            "20 bps negative rate must remain hidden during vulnerable 24h window"
        );

        uint256 snap = vm.snapshot();
        Outcome memory control = _redeemAfterLossIsRecognized();
        vm.revertTo(snap);
        Outcome memory attack = _redeemWhileLossIsHidden();

        uint256 avoidedLoss = attack.attackerValueAtLossRate - control.attackerValueAtLossRate;
        uint256 victimExtraLoss = control.victimBaseValue - attack.victimBaseValue;
        uint256 reserveDelta = attack.reserveNav - control.reserveNav;
        uint256 shiftedFromNonAttackerCapital = victimExtraLoss - reserveDelta;

        console2.log("current-like gross attacker claim (USDC 6d)", grossClaimBeforeLoss);
        console2.log("production immediate-exit fee cost (USDC 6d)", immediateExitFeeCost);
        console2.log("attacker avoided loss (USDC 6d)", avoidedLoss);
        console2.log("remaining Junior incremental loss (USDC 6d)", victimExtraLoss);
        console2.log("net shifted from non-attacker capital (USDC 6d)", shiftedFromNonAttackerCapital);

        assertGt(avoidedLoss, 0, "first redeemer must avoid realized first-loss exposure");
        assertApproxEqAbs(
            avoidedLoss,
            shiftedFromNonAttackerCapital,
            3,
            "attacker avoided loss must be funded by remaining capital"
        );
        assertGt(
            avoidedLoss,
            immediateExitFeeCost,
            "loss avoidance must exceed 15 bps fee so opportunistic immediate exit is rational"
        );
    }
}
