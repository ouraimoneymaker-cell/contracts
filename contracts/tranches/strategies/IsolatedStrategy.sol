// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStrataCDO} from "../interfaces/IStrataCDO.sol";
import {IIsolatedStrategy} from "../interfaces/IIsolatedStrategy.sol";
import {IStrategy} from "../interfaces/IStrategy.sol";
import {IRebalanceable} from "../interfaces/IRebalancer.sol";
import {MultiStrategy} from "./base/MultiStrategy.sol";
import {Strategy} from "../Strategy.sol";
import {IndexPackerLib} from "../utils/IndexPackerLib.sol";

contract IsolatedStrategy is MultiStrategy, IIsolatedStrategy {

    uint256 constant private JRT_IDX = 0;
    uint256 constant private SRT_IDX = 1;

    /// @dev Packed withdrawal order for JRT: [senior(1), junior(0)]
    uint256 private immutable _jrtWithdrawOrderPacked;
    /// @dev Packed withdrawal order for SRT: [junior(0), senior(1)]
    uint256 private immutable _srtWithdrawOrderPacked;

    IStrategy public juniorStrat;
    IStrategy public seniorStrat;

    event StratsSet(address indexed juniorStrat, address indexed seniorStrat);
    event LiquidAllocationFloorSet(uint256 floor);

    constructor() Strategy(address(0), address(0)) {
        _jrtWithdrawOrderPacked = IndexPackerLib.pack2(SRT_IDX, JRT_IDX);
        _srtWithdrawOrderPacked = IndexPackerLib.pack2(JRT_IDX, SRT_IDX);
    }

    function initialize(
        address owner_,
        address acm_,
        IStrataCDO cdo_,
        IStrategy juniorStrat_,
        IStrategy seniorStrat_,
        uint256 liquidAllocationFloor_
    ) external initializer {
        AccessControlled_init(owner_, acm_);
        cdo = cdo_;
        liquidAllocationFloor = liquidAllocationFloor_;
        juniorStrat = juniorStrat_;
        seniorStrat = seniorStrat_;
        IStrategy[] memory strats_ = new IStrategy[](2);
        strats_[JRT_IDX] = juniorStrat_;
        strats_[SRT_IDX] = seniorStrat_;
        _setStrats(strats_);
        emit StratsSet(address(juniorStrat_), address(seniorStrat_));
    }

    function setLiquidAllocationFloor(uint256 floor_) external onlyOwner {
        liquidAllocationFloor = floor_;
        emit LiquidAllocationFloorSet(floor_);
    }

    function setStrats(IStrategy juniorStrat_, IStrategy seniorStrat_) external onlyOwner {
        juniorStrat = juniorStrat_;
        seniorStrat = seniorStrat_;
        IStrategy[] memory strats_ = new IStrategy[](2);
        strats_[JRT_IDX] = juniorStrat_;
        strats_[SRT_IDX] = seniorStrat_;
        _setStrats(strats_);
        emit StratsSet(address(juniorStrat_), address(seniorStrat_));
    }

    // JRT deposits go to junior strat (index 0), SRT to senior strat (index 1).
    function _depositStratIndex(address tranche) internal view override returns (uint256) {
        return cdo.isJrt(tranche) ? JRT_IDX : SRT_IDX;
    }

    function _depositStratIndex(address tranche, address token, uint256 baseAssets) internal view override returns (uint256) {
        (
            uint256 deficitStratIdx,
            uint256 deficitAmount,
            uint256 surplusStratIdx,
            uint256 surplusAmount
        ) = imbalances();

        if (deficitStratIdx == JRT_IDX &&
            baseAssets <= deficitAmount &&
            surplusStratIdx == SRT_IDX &&
            surplusAmount > 0 &&
            perStrategyTokens[address(juniorStrat)][token]) {

            // Junior has deficit AND Senior has surplus
            return JRT_IDX;
        }

        if (
            deficitStratIdx == SRT_IDX &&
            baseAssets <= deficitAmount &&
            surplusStratIdx == JRT_IDX &&
            surplusAmount > 0 &&
            perStrategyTokens[address(seniorStrat)][token]) {

            // Senior has deficit AND Junior has surplus
            return SRT_IDX;
        }

        // Otherwise deposit to the tranche's default strategy
        return _depositStratIndex(tranche);
    }

    // JRT redemptions from senior strategy first (index 1); SRT redeems from junior first (index 0).
    function _withdrawStratIndexes (address tranche) internal view override returns (uint256) {
        return cdo.isJrt(tranche)
            ? _jrtWithdrawOrderPacked
            : _srtWithdrawOrderPacked;
    }

    function totalAssetsByTranche() public view returns (uint256 jrtAssets, uint256 srtAssets) {
        return (juniorStrat.totalAssets(), seniorStrat.totalAssets());
    }

    /// @notice Returns the net amount of assets that need to move between strategies.
    /// @dev JR allocation ratio is derived from accounting NAV; liquidAllocationFloor may raise it.
    ///      In-flight Rebalancer assets are credited to their destination strategy so that an
    ///      ongoing rebalance zeroes out the corresponding debt without querying pending state.
    ///      toSenior takes priority: if both would be non-zero (e.g. unreconciled losses),
    ///      toJunior is zeroed.
    function debts() public view override(IIsolatedStrategy, IRebalanceable) returns (uint256 toJunior, uint256 toSenior) {
        require(address(accounting) != address(0), "Accounting not set");
        (uint256 jrtNavT0, uint256 srtNavT0,) = accounting.totalAssetsT0();

        uint256 navTotal = jrtNavT0 + srtNavT0;
        if (navTotal == 0) return (0, 0);

        uint256 strat1Ratio = Math.mulDiv(jrtNavT0, 1e18, navTotal);

        uint256 jrtAssets = juniorStrat.totalAssets();
        uint256 srtAssets = seniorStrat.totalAssets();
        if (address(rebalancer) != address(0)) {
            (uint256 pendingToJunior, uint256 pendingToSenior) = rebalancer.pendingToStrats();
            jrtAssets += pendingToJunior;
            srtAssets += pendingToSenior;
        }

        return _compute2StratsDebts(strat1Ratio, jrtAssets, srtAssets);
    }

    /// @notice Returns the strategy with the largest deficit and the strategy with the largest surplus.
    /// @dev Returns the index of the strategy that needs assets most (has largest deficit relative to target),
    ///      the deficit amount, the index of the strategy with the most excess assets (largest surplus),
    ///      and the surplus amount. If no deficit/surplus exists, returns (0, 0, 0, 0).
    /// @return deficitStratIdx Index of the strategy with the largest deficit (0=junior, 1=senior)
    /// @return deficitAmount Amount of assets the deficit strategy needs
    /// @return surplusStratIdx Index of the strategy with the largest surplus (0=junior, 1=senior)
    /// @return surplusAmount Amount of excess assets the surplus strategy holds
    function imbalances() public view returns (
        uint256 deficitStratIdx,
        uint256 deficitAmount,
        uint256 surplusStratIdx,
        uint256 surplusAmount
    ) {
        require(address(accounting) != address(0), "Accounting not set");
        (uint256 jrtNavT0, uint256 srtNavT0,) = accounting.totalAssetsT0();

        uint256 navTotal = jrtNavT0 + srtNavT0;
        if (navTotal == 0) return (0, 0, 0, 0);

        uint256 jrtAssets = juniorStrat.totalAssets();
        uint256 srtAssets = seniorStrat.totalAssets();

        if (address(rebalancer) != address(0)) {
            (uint256 pendingToJunior, uint256 pendingToSenior) = rebalancer.pendingToStrats();
            jrtAssets += pendingToJunior;
            srtAssets += pendingToSenior;
        }

        // Calculate deficits/surpluses for each strategy
        uint256 jrtDeficit = jrtNavT0 > jrtAssets ? jrtNavT0 - jrtAssets : 0;
        uint256 jrtSurplus = jrtAssets > jrtNavT0 ? jrtAssets - jrtNavT0 : 0;
        uint256 srtDeficit = srtNavT0 > srtAssets ? srtNavT0 - srtAssets : 0;
        uint256 srtSurplus = srtAssets > srtNavT0 ? srtAssets - srtNavT0 : 0;

        // Determine which strategy has the largest deficit
        if (jrtDeficit >= srtDeficit) {
            deficitStratIdx = JRT_IDX;
            deficitAmount = jrtDeficit;
        } else {
            deficitStratIdx = SRT_IDX;
            deficitAmount = srtDeficit;
        }

        // Determine which strategy has the largest surplus
        if (jrtSurplus >= srtSurplus) {
            surplusStratIdx = JRT_IDX;
            surplusAmount = jrtSurplus;
        } else {
            surplusStratIdx = SRT_IDX;
            surplusAmount = srtSurplus;
        }
    }

    function shareToken() public pure override(IStrategy, Strategy) returns (address) {
        revert("NotSupported");
    }

    function getRate() external view override(IStrategy, Strategy) returns (uint256) {
        return seniorStrat.getRate();
    }
}
