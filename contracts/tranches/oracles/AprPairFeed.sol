// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AccessControlled } from "../../governance/AccessControlled.sol";
import { IAprPairFeed, IStrategyAprPairProvider } from "../interfaces/IAprPairFeed.sol";



/// @title AprPairFeed
/// @notice This contract manages and provides APR Pair (Base APR, Target APR) data
/// @dev APR data has two sources:
/// 1. External (PUSH): APRs can be updated externally by authorized observers/notifiers
/// 2. Strategy (PULL): APRs can be fetched directly from the strategy
/// The feed prefers PUSH data, but falls back to PULL from the strategy if PUSH data is stale
contract AprPairFeed is IAprPairFeed, AccessControlled {
    int64 private constant APR_BOUNDARY_MAX =    2e12; // 200%
    int64 private constant APR_BOUNDARY_MIN = -0.5e12; // -50%

    uint8 public constant roundsCap = 20;
    uint8 public constant decimals = 12;

    string public description;
    uint64 public latestRoundId;
    TRound public latestRound;

    mapping(uint80 roundIdx => TRound round) public rounds;

    uint256 public roundStaleAfter;

    /// @notice APR provider implemented by the strategy (e.g., Ethena Strategy returns spot APRs)
    IStrategyAprPairProvider public provider;

    enum ESourcePref {
        Feed,    // use updatable feed; fallback to strategy when stale
        Strategy // use strategy only
    }

    ESourcePref public sourcePref;

    event AnswerUpdated(
        int64 aprTarget,
        int64 aprBase,
        uint64 roundId,
        uint64 updatedAt
    );

    event ProviderSet(address newProvider);
    event StalePeriodSet(uint256 stalePeriod);
    event SourcePrefChanged();

    function initialize(
        address owner_,
        address acm_,
        IStrategyAprPairProvider provider_,
        uint256 roundStaleAfter_,
        string memory description_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);
        description = description_;
        provider = provider_;
        roundStaleAfter = roundStaleAfter_;
    }

    function latestRoundData() external view returns (TRound memory) {
        TRound memory round = latestRound;

        if (sourcePref == ESourcePref.Feed) {
            uint256 deltaT = block.timestamp - uint256(round.updatedAt);
            if (deltaT < roundStaleAfter) {
                return round;
            }
            // falls back to strategy ↓
        }

        (int64 aprTarget, int64 aprBase, uint64 t1) = provider.getAprPair();
        return TRound({
            aprTarget: aprTarget,
            aprBase: aprBase,
            updatedAt: t1,
            answeredInRound: latestRoundId + 1
        });
    }

    function getRoundData(uint64 roundId) public view returns (TRound memory) {
        uint64 roundIdx = roundId % roundsCap;
        TRound memory round = rounds[roundIdx];
        require(round.updatedAt > 0, "No data present");
        return round;
    }

    /// @notice Push APR values into the feed from an external source and set the preferred source to Feed
    function updateRoundData(int64 aprTarget, int64 aprBase) external onlyRole(UPDATER_FEED_ROLE) {
        updateRoundDataInner(aprTarget, aprBase, uint64(block.timestamp));
        ensureSourcePrefInner(ESourcePref.Feed);
    }

    /// @notice Pull APR values from the strategy provider, update the feed, and set the preferred source to Strategy
    function updateRoundData() external onlyRole(UPDATER_FEED_ROLE) {
        (int64 aprTarget, int64 aprBase, uint64 t) = provider.getAprPair();
        updateRoundDataInner(aprTarget, aprBase, t);
        ensureSourcePrefInner(ESourcePref.Strategy);
    }

    function updateRoundDataInner(int64 aprTarget, int64 aprBase, uint64 t) internal {
        ensureValid(aprTarget);
        ensureValid(aprBase);

        uint64 roundId = (latestRoundId + 1);
        uint64 roundIdx = roundId % roundsCap;

        latestRoundId = roundId;
        latestRound = TRound({
            aprTarget: aprTarget,
            aprBase: aprBase,
            updatedAt: t,
            answeredInRound: roundId
        });
        rounds[roundIdx] = latestRound;

        emit AnswerUpdated(aprTarget, aprBase, roundId, t);
    }


    function setProvider(IStrategyAprPairProvider provider_) external onlyOwner {
        // compatibility check
        (int64 aprTarget, int64 aprBase, ) = provider.getAprPair();
        ensureValid(aprTarget);
        ensureValid(aprBase);
        provider = provider_;
        emit ProviderSet(address(provider_));
    }

    function setRoundStaleAfter(uint256 roundStaleAfter_) external onlyOwner {
        // compatibility check
        roundStaleAfter = roundStaleAfter_;
        emit StalePeriodSet(roundStaleAfter_);
    }


    //

    function ensureSourcePrefInner(ESourcePref sourcePref_) internal {
        if (sourcePref != sourcePref_) {
            sourcePref = sourcePref_;
            emit SourcePrefChanged();
        }
    }


    /// @dev Validates that the given APR is within acceptable bounds
    function ensureValid(int64 answer) internal pure {
        require(
            APR_BOUNDARY_MIN <= answer && answer <= APR_BOUNDARY_MAX,
            "INVALID_APR"
        );
    }
}
