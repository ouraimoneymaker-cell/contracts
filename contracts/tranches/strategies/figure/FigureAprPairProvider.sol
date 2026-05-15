// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IAprProvider} from '../../interfaces/IAprPairFeed.sol';
import {IHastraNavEngine} from './interfaces/IHastraNavEngine.sol';

/**
 * @title Figure AprPairProvider
 * @notice Returns static target APR (0) and base APR from the Hastra NAV Engine
 *         rate change over time.
 * @dev    Base APR is derived from the NAV engine's exchange rate (wYLDS per PRIME).
 *         The rate grows as rewards are distributed to the StakingVault, so
 *         annualising the rate of change gives the strategy's actual yield.
 *
 *         Target APR is 0 (static), so Senior earns BaseAPR - RiskPremium.
 */
contract FigureAprPairProvider is IAprProvider {
    uint256 constant SECONDS_PER_YEAR = 365 days;
    uint256 constant ONE_APR = 1e12;
    int256 constant APR_BOUNDRY = 200 * int256(ONE_APR);

    /// @dev Minimum time delta to accept an unchanged rate as a meaningful 0-APR period.
    ///      Updates with identical rates within this window are treated as duplicate submissions
    ///      (e.g. gas-bumped resubmits) and silently ignored.
    uint256 constant MIN_UPDATE_PERIOD = 2 days;

    struct TRound {
        int192 answer;
        uint256 updatedAt;
    }

    IHastraNavEngine public immutable navEngine;

    /// @notice Last snapshot of the accountant exchange rate and its update timestamp.
    TRound public latestRoundData;
    /// @notice Cached annualized base APR in SD7x12 format, updated each time a new snapshot is taken.
    int64 public cachedApr;

    event NavSnapshotUpdated(int192 prevRate, uint256 prevRateTimestamp, int192 newRate, uint256 newRateTimestamp);

    error AprCastOverflow();

    constructor(IHastraNavEngine _navEngine, int64 initialApr_) {
        navEngine = _navEngine;
        cachedApr = initialApr_;
        // Initialize the previous snapshot from the NAV engine's current state
        int192 currentRate = _navEngine.getRate();
        uint256 currentTime = _navEngine.getLatestUpdateTime();
        if (currentRate > 0 && currentTime > 0) {
            latestRoundData = TRound({answer: currentRate, updatedAt: currentTime});
        }
    }

    function getApr() external view returns (int64 apr, uint64 timestamp) {
        return (cachedApr, uint64(latestRoundData.updatedAt));
    }

    /// @notice Updates the APR snapshot if the accountant rate has changed since the last snapshot.
    /// @dev Permissionless. Computes the annualized rate of return from the exchange-rate delta
    ///      between consecutive accountant updates, using lastUpdateTimestamp for time elapsed.
    function updateSnapshot() public {
        int192 currentRate = navEngine.getRate();
        uint256 currentTimestamp = navEngine.getLatestUpdateTime();
        TRound memory prev = latestRoundData;

        if (prev.answer == 0 || prev.updatedAt == 0) {
            latestRoundData = TRound({answer: currentRate, updatedAt: currentTimestamp});
            return;
        }

        if (currentTimestamp <= prev.updatedAt) return;

        uint256 timeDelta = currentTimestamp - prev.updatedAt;

        if (currentRate == prev.answer) {
            // Ignore short-window duplicate submissions (e.g. gas-bumped resubmits).
            // For longer periods the rate truly didn't move, so record 0 APR.
            if (timeDelta < MIN_UPDATE_PERIOD) return;
            cachedApr = 0;
            latestRoundData = TRound({answer: currentRate, updatedAt: currentTimestamp});
            return;
        }

        int256 apr = ((currentRate - prev.answer) * int256(SECONDS_PER_YEAR) * int256(ONE_APR)) /
            prev.answer /
            int256(timeDelta);

        if (apr > APR_BOUNDRY) apr = cachedApr;

        cachedApr = int64(apr);

        latestRoundData = TRound({answer: currentRate, updatedAt: currentTimestamp});

        emit NavSnapshotUpdated(latestRoundData.answer, latestRoundData.updatedAt, currentRate, currentTimestamp);
    }
}
