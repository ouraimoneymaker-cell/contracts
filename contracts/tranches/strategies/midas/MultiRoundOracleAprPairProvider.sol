// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IStrategyAprPairProvider} from "../../interfaces/IAprPairFeed.sol";
import {
    IAccessControlManager
} from "../../../governance/interfaces/IAccessControlManager.sol";

/**
 * @title MultiRoundOracleAprPairProvider
 * @notice APR pair provider for volatile strategies like mKRALPHA.
 *
 * Key differences from AaveOracleAprPairProvider:
 * 1. getAPRbase: reads price from N rounds ago (configurable roundDepth) for smoothing
 * 2. getAPRtarget: returns a static configurable value instead of Aave weighted average
 *
 * The static aprTarget is intended to be negative, serving as the Senior loss floor.
 * Under normal conditions: aprSrt = aprBase * (1 - riskPremium) > aprTarget, so aprTarget doesn't bind.
 */
contract MultiRoundOracleAprPairProvider is IStrategyAprPairProvider {
    bytes32 public constant UPDATER_FEED_ROLE = keccak256("UPDATER_FEED_ROLE");

    uint256 constant SECONDS_PER_YEAR = 31_536_000;

    /// @dev Allowable range for base APR (0 to +40%/yr in SD7x12)
    uint256 constant BOUND_MAX = 0.4e12;
    /// @dev Allowable range for target/floor APR (−40%/yr to +40%/yr in SD7x12)
    int64 constant BOUND_MIN_TARGET = -0.4e12;
    int64 constant BOUND_MAX_TARGET = 0.4e12;

    IAccessControlManager public acm;
    IRoundDataOracle public oracle;

    /// @notice Static target APR for Senior in SD7x12 format.
    /// @dev Used as the floor for the aprSrt calculation: aprSrt = max(aprTarget, aprBase * (1 - risk)).
    ///      A negative value can be used but has no effect as DYSAccounting.normalizeAprFromFeed
    ///      clamps it to 0; the daily loss floor is now handled via DYSAccounting.floorRate.
    ///      Set to 0 to disable the target floor for aprSrt.
    int64 public aprTargetStatic;

    /// @notice Number of oracle rounds to look back for Base APR computation
    /// @dev Default 5 — smooths out mKRALPHA's volatile daily returns
    uint8 public roundDepth;

    event AprTargetStaticChanged(int64 aprTargetStatic);
    event RoundDepthChanged(uint8 roundDepth);

    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);

    modifier onlyRole(bytes32 role) {
        if (!acm.hasRole(role, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, role);
        }
        _;
    }

    constructor(
        IAccessControlManager _acm,
        IRoundDataOracle _oracle,
        uint8 _roundDepth,
        int64 _aprTargetStatic
    ) {
        require(
            _aprTargetStatic >= BOUND_MIN_TARGET &&
                _aprTargetStatic <= BOUND_MAX_TARGET,
            "InvalidAprTarget"
        );
        acm = _acm;
        oracle = _oracle;
        roundDepth = _roundDepth > 0 ? _roundDepth : 5;
        aprTargetStatic = _aprTargetStatic;
    }

    function getAprPair()
        external
        view
        returns (int64 aprTarget, int64 aprBase, uint64 timestamp)
    {
        timestamp = uint64(block.timestamp);
        aprTarget = getAPRtarget();
        aprBase = getAPRbase();
    }

    /**
     * @notice Returns the static target APR for Senior.
     * @dev Used in DYSAccounting.updateAprSrt for the aprSrt floor: aprSrt = max(aprTarget, aprBase*(1-risk)).
     */
    function getAPRtarget() public view returns (int64) {
        return aprTargetStatic;
    }

    /**
     * @notice Calculates the base APR from the exchange rate change over N rounds
     * @dev Uses roundDepth to look back multiple rounds, smoothing the volatile mKRALPHA oracle.
     *      Formula: apr = (ppsT1 - ppsT0) * SECONDS_PER_YEAR * 1e12 / ppsT0 / deltaT
     */
    function getAPRbase() public view returns (int64) {
        (uint80 roundId, int256 ppsT1, , uint256 t1, ) = oracle
            .latestRoundData();
        if (roundId == 0 || t1 == 0 || ppsT1 <= 0) {
            return 0;
        }

        // Look back roundDepth rounds
        uint80 lookbackRoundId = roundId > roundDepth
            ? roundId - roundDepth
            : 0;
        if (lookbackRoundId == 0) {
            // Not enough rounds, fall back to roundId - 1
            lookbackRoundId = roundId > 1 ? roundId - 1 : 0;
            if (lookbackRoundId == 0) {
                return 0;
            }
        }

        (, int256 ppsT0, , uint256 t0, ) = oracle.getRoundData(lookbackRoundId);

        if (t0 == 0 || t1 <= t0 || ppsT0 <= 0) {
            return 0;
        }

        int256 ppsChange = ppsT1 - ppsT0;
        uint256 deltaT = t1 - t0;

        int256 apr = (ppsChange * int256(uint256(SECONDS_PER_YEAR)) * 1e12) /
            ppsT0 /
            int256(deltaT);

        if (apr < -int256(BOUND_MAX)) {
            return -int64(int256(BOUND_MAX));
        }
        if (apr > int256(BOUND_MAX)) {
            return int64(int256(BOUND_MAX));
        }
        return int64(apr);
    }

    /**
     * @notice Sets the number of oracle rounds to look back for Base APR smoothing
     * @param _roundDepth New round depth (must be >= 1)
     */
    function setRoundDepth(
        uint8 _roundDepth
    ) external onlyRole(UPDATER_FEED_ROLE) {
        require(_roundDepth >= 1 && _roundDepth <= 30, "InvalidRoundDepth");
        roundDepth = _roundDepth;
        emit RoundDepthChanged(_roundDepth);
    }

    /**
     * @notice Sets the static target APR for Senior.
     * @param _aprTargetStatic New target APR in SD7x12 format.
     *        Positive values act as a floor for aprSrt (e.g. if aprBase * (1 - risk) is too low).
     *        Negative values have no effect as DYSAccounting clamps to 0.
     *        Daily loss protection is now configured via DYSAccounting.setFloorRate().
     */
    function setAprTargetStatic(
        int64 _aprTargetStatic
    ) external onlyRole(UPDATER_FEED_ROLE) {
        require(
            _aprTargetStatic >= BOUND_MIN_TARGET &&
                _aprTargetStatic <= BOUND_MAX_TARGET,
            "InvalidAprTarget"
        );
        aprTargetStatic = _aprTargetStatic;
        emit AprTargetStaticChanged(_aprTargetStatic);
    }
}

interface IRoundDataOracle {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function getRoundData(
        uint80 roundId
    )
        external
        view
        returns (
            uint80 _roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
