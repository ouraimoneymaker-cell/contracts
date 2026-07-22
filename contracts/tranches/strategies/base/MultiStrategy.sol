// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMultiStrategy} from "../../interfaces/IMultiStrategy.sol";
import {IStrategy} from "../../interfaces/IStrategy.sol";
import {IStrataCDO} from "../../interfaces/IStrataCDO.sol";
import {IRebalancer, IRebalanceable} from "../../interfaces/IRebalancer.sol";
import {IAccounting} from "../../interfaces/IAccounting.sol";
import {Strategy} from "../../Strategy.sol";
import {IndexPackerLib} from "../../utils/IndexPackerLib.sol";

abstract contract MultiStrategy is Strategy, IMultiStrategy, IRebalanceable {
    IStrategy[] public strats;

    IRebalancer public rebalancer;
    IAccounting public accounting;

    // WAD ratio (1e18 = 100%). When > 0, strat1 target is raised to at least this share of total assets.
    uint256 public liquidAllocationFloor;

    mapping(address => bool) private _supportedTokens;
    IERC20[] private _supportedTokenList;
    mapping(address strat => mapping(address token => bool)) public perStrategyTokens;
    mapping(address token => IStrategy) public converters;

    uint256[42] private __gap;

    event StratNavSnapshot(uint256[] navs);
    event RebalancerSet(address indexed rebalancer);

    modifier onlyRebalancer() {
        if (msg.sender != address(rebalancer)) revert InvalidCaller(msg.sender);
        _;
    }

    function initialize(
        address owner_,
        address acm_,
        IStrataCDO cdo_,
        uint256 liquidAllocationFloor_
    ) external virtual initializer {
        MultiStrategy_init(owner_, acm_, cdo_, liquidAllocationFloor_);
    }
    function MultiStrategy_init(
        address owner_,
        address acm_,
        IStrataCDO cdo_,
        uint256 liquidAllocationFloor_
    ) internal onlyInitializing {
        AccessControlled_init(owner_, acm_);
        cdo = cdo_;
        require(address(cdo_.accounting()) == address(0), "CdoAlreadyConfigured");
        require(liquidAllocationFloor_ <= 1e18, "InvalidLiquidAllocationFloor");
        liquidAllocationFloor = liquidAllocationFloor_;
    }

    function _depositStratIndex(address tranche) internal view virtual returns (uint256);
    function _withdrawStratIndexes(address tranche) internal view virtual returns (uint256);

    // Override to route deposits based on token/amount (e.g. debt-aware routing).
    // Defaults to the tranche→strat mapping so existing impls need no change.
    function _depositStratIndex(address tranche, address /*token*/, uint256 /*baseAssets*/) internal view virtual returns (uint256) {
        return _depositStratIndex(tranche);
    }


    function deposit(address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address owner)
        public override(IStrategy, Strategy)
        onlyCDO
        returns (uint256)
    {
        uint256 idx = _depositStratIndex(tranche, token, baseAssets);
        IStrategy strat = strats[idx];
        SafeERC20.safeTransferFrom(IERC20(token), owner, address(this), tokenAmount);
        SafeERC20.forceApprove(IERC20(token), address(strat), tokenAmount);
        return strat.deposit(tranche, token, tokenAmount, baseAssets, address(this));
    }

    function withdraw(
        address tranche,
        address token,
        uint256 tokenAmount,
        uint256 baseAssets,
        address sender,
        address receiver
    ) public override(IStrategy, Strategy) onlyCDO returns (uint256) {
        return _withdraw(tranche, token, tokenAmount, baseAssets, sender, receiver, false);
    }

    function withdraw(
        address tranche,
        address token,
        uint256 tokenAmount,
        uint256 baseAssets,
        address sender,
        address receiver,
        bool shouldSkipCooldown
    ) public override(IStrategy, Strategy) onlyCDO returns (uint256) {
        return _withdraw(tranche, token, tokenAmount, baseAssets, sender, receiver, shouldSkipCooldown);
    }

    function totalAssets() public view returns (uint256 total) {
        for (uint256 i; i < strats.length; i++) {
            total += strats[i].totalAssets();
        }
        if (address(rebalancer) != address(0)) {
            total += rebalancer.totalAssets();
        }
    }

    /// @notice Calculates total assets across all strategies with rewards detection
    /// @param navT0 The cached total assets from the accounting
    /// @param timestamp The last reconciliation timestamp used to check for new rewards
    /// @return total The sum of all strategy assets if new rewards are detected, otherwise returns navT0
    /// @dev Returns navT0 if any strategy reports no new rewards (nav == type(uint256).max), signaling the accounting
    ///      contract to continue NAV projection. When all strategies report new rewards, returns the
    ///      updated total, triggering full reconciliation in the accounting contract.
    function totalAssets(uint256 navT0, uint256 timestamp) public view returns (uint256 total) {
        for (uint256 i; i < strats.length; i++) {
            uint256 nav = strats[i].totalAssets(type(uint256).max, timestamp);
            if (nav == type(uint256).max) {
                return navT0;
            }
            total += nav;
        }
        if (address(rebalancer) != address(0)) {
            total += rebalancer.totalAssets();
        }
    }

    function setRebalancer(IRebalancer rebalancer_) external onlyOwner {
        if (address(rebalancer) != address(0)) {
            require(rebalancer.totalAssets() == 0, "CurrentRebalancerActive");
        }
        require(rebalancer_.totalAssets() == 0, "NewRebalancerActive");
        rebalancer = rebalancer_;
        emit RebalancerSet(address(rebalancer_));
    }


    function withdrawForRebalance(uint256 stratIdx, address token, uint256 baseAssets, address receiver) external onlyRebalancer returns (uint256 sharesAmount){
        IStrategy strat = strats[stratIdx];
        // Convert base assets to the amount of withdrawal token needed
        uint256 tokenAmount = strat.convertToTokens(token, baseAssets, Math.Rounding.Ceil);
        // Calculate the equivalent share token amount for the requested base assets (returned for tracking)
        sharesAmount = strat.convertToTokens(strat.shareToken(), baseAssets, Math.Rounding.Ceil);
        strat.withdraw(address(0), token, tokenAmount, baseAssets, receiver, receiver, true);
    }

    function depositForRebalance(uint256 stratIdx, address token, uint256 tokenAmount, uint256 baseAssets) external onlyRebalancer {
        IStrategy strat = strats[stratIdx];
        SafeERC20.safeTransferFrom(IERC20(token), msg.sender, address(this), tokenAmount);
        SafeERC20.forceApprove(IERC20(token), address(strat), tokenAmount);
        strat.deposit(address(0), token, tokenAmount, baseAssets, address(this));
    }

    function getStratShareToken(uint256 stratIdx) external view returns (address) {
        return strats[stratIdx].shareToken();
    }

    /// @notice Passthrough to the CDO's isJrt.
    /// @dev A sub-strategy's cdo is this MultiStrategy, so it resolves the tranche side by
    /// callign cdo.isJrt(); forward that to the real CDO so sub-strategies need no
    /// awareness that they sit behind a composite strategy.
    function isJrt(address tranche) external view returns (bool) {
        return cdo.isJrt(tranche);
    }

    function reduceReserve(address token, uint256 tokenAmount, address receiver) external onlyCDO {
        uint256 len = strats.length;
        for (uint256 i; i < len; i++) {
            if (perStrategyTokens[address(strats[i])][token]) {
                uint256 baseAssets = strats[i].convertToAssets(token, tokenAmount, Math.Rounding.Floor);
                if (strats[i].totalAssets() >= baseAssets) {
                    strats[i].reduceReserve(token, tokenAmount, receiver);
                    return;
                }
            }
        }
        for (uint256 i; i < len; i++) {
            if (perStrategyTokens[address(strats[i])][token]) {
                strats[i].reduceReserve(token, tokenAmount, receiver);
                return;
            }
        }
        revert UnsupportedToken(token);
    }

    function getSupportedTokens() external view returns (IERC20[] memory) {
        return _supportedTokenList;
    }

    function getSupportedTokens(address tranche) external view returns (IERC20[] memory) {
        return strats[_depositStratIndex(tranche)].getSupportedTokens();
    }

    function convertToAssets(address token, uint256 tokenAmount, Math.Rounding rounding)
        public
        view
        override(IStrategy, Strategy)
        returns (uint256)
    {
        return converters[token].convertToAssets(token, tokenAmount, rounding);
    }

    function convertToTokens(address token, uint256 baseAssets, Math.Rounding rounding)
        public
        view
        override(IStrategy, Strategy)
        returns (uint256)
    {
        return converters[token].convertToTokens(token, baseAssets, rounding);
    }

    function ensureRedeemable(address caller, address token, uint256 baseAssets) external view {
        converters[token].ensureRedeemable(caller, token, baseAssets);
    }

    function _withdraw(
        address tranche,
        address token,
        uint256 /*tokenAmount*/,
        uint256 baseAssets,
        address sender,
        address receiver,
        bool shouldSkipCooldown
    ) internal returns (uint256 tokenAmountOut) {
        uint256 withdrawOrder = _withdrawStratIndexes(tranche);
        uint256 length = IndexPackerLib.length(withdrawOrder);
        uint256 remainingAssets = baseAssets;

        for (uint256 i = 0; i < length && remainingAssets > 0; i++) {
            uint256 stratIdx = IndexPackerLib.unpack(withdrawOrder, i);
            IStrategy strat = strats[stratIdx];

            if (!perStrategyTokens[address(strat)][token]) {
                continue;
            }

            uint256 available = strat.totalAssets();
            uint256 toWithdraw = Math.min(remainingAssets, available);

            if (toWithdraw > 0) {
                uint256 tokenAmountStrat = strat.convertToTokens(token, toWithdraw, Math.Rounding.Ceil);
                tokenAmountOut += strat.withdraw(tranche, token, tokenAmountStrat, toWithdraw, sender, receiver, shouldSkipCooldown);
                remainingAssets -= toWithdraw;
            }
        }
        if (remainingAssets > 0) {
            revert WithdrawalCapReached(tranche);
        }
    }

    function _setStrats(IStrategy[] memory strats_) internal {
        require(strats_.length >= 2, "MinTwoStrats");
        for (uint256 i; i < strats.length; i++) {
            address strat = address(strats[i]);
            IERC20[] memory old = strats[i].getSupportedTokens();
            for (uint256 j; j < old.length; j++) {
                address token = address(old[j]);
                _supportedTokens[token] = false;
                perStrategyTokens[strat][token] = false;
                delete converters[token];
            }
        }

        delete strats;
        delete _supportedTokenList;

        for (uint256 i; i < strats_.length; i++) {
            require(address(strats_[i]) != address(0), "ZeroAddress");
            strats.push(strats_[i]);
            address strat = address(strats_[i]);
            IERC20[] memory tokens = strats_[i].getSupportedTokens();
            for (uint256 j; j < tokens.length; j++) {
                address token = address(tokens[j]);
                if (!_supportedTokens[token]) {
                    _supportedTokens[token] = true;
                    _supportedTokenList.push(tokens[j]);
                    converters[token] = strats_[i];
                }
                perStrategyTokens[strat][token] = true;
            }
        }
    }

    function supportsToken(address token) external view returns (bool) {
        return _supportedTokens[token];
    }

    function configure () external override(IStrategy, Strategy) onlyCDO {
        accounting = cdo.accounting();
        require(address(accounting) != address(0), "UnconfiguredCDO");
    }
}
