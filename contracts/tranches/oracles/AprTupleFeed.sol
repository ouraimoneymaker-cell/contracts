// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { SD59x18 } from "@prb/math/src/sd59x18/ValueType.sol";
import { AccessControlled } from "../../governance/AccessControlled.sol";
import { IAprTupleFeed, IAprTupleFeedListener } from "../interfaces/IAprFeed.sol";

import "hardhat/console.sol";

contract AprTupleFeed is IAprTupleFeed, AccessControlled {


    struct Round {
        // SD7x12
        int64 aprTarget;
        int64 aprBase;
        uint64 updatedAt;
        uint64 answeredInRound;
    }

    int64 private constant APR_BOUNDARY_MAX = 200 * 1e12;
    int64 private constant APR_BOUNDARY_MIN = -10 * 1e12;

    uint8 public constant roundsCap = 20;
    uint8 public roundsCount = 0;

    uint8 public constant decimals = 12;
    uint8 public constant version = 1;

    string public description;
    uint64 public latestRoundId;

    mapping(uint80 roundIdx => Round) public rounds;

    IAprTupleFeedListener[] public listeners;

    event OnFailureListener(address listener);

    event ListenerAdded(address listener);
    event ListenerRemoved(address listener);
    event AnswerUpdated(
        int64 aprTarget,
        int64 aprBase,
        uint64 roundId,
        uint64 updatedAt
    );

    function initialize(
        address owner_,
        address acm_,
        string memory description_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);
        description = description_;
    }

    function latestRoundData() external view returns (Round memory) {
        return getRoundData(latestRoundId);
    }

    function getRoundData(uint64 roundId) public view returns (Round memory) {
        uint64 roundIdx = roundId % roundsCap;
        Round memory round = rounds[roundIdx];
        require(round.updatedAt > 0, "No data present");
        return round;
    }

    function updateRoundData(int64 aprTarget, int64 aprBase) external onlyRole(UPDATER_FEED_ROLE) {
        ensureValid(aprTarget);
        ensureValid(aprBase);

        uint64 roundId = (latestRoundId + 1);
        uint64 roundIdx = roundId % roundsCap;
        if (roundIdx == 0) {
            roundsCount++;
        }

        latestRoundId = roundId;

        uint64 updatedAt = uint64(block.timestamp);

        rounds[roundIdx] = Round({
            aprTarget: aprTarget,
            aprBase: aprBase,
            updatedAt: updatedAt,
            answeredInRound: roundId
        });

        emit AnswerUpdated(aprTarget, aprBase, roundId, updatedAt);

        uint256 len = listeners.length;
        for (uint256 i; i < len;) {
            try listeners[i].onAprChanged(aprTarget, aprBase) {

            } catch {
                emit OnFailureListener(address(listeners[i]));
            }
            unchecked { i++; }
        }
    }

    function addListener(IAprTupleFeedListener listener) external onlyRole(UPDATER_FEED_ROLE) {
        bool has = hasListener(listener);
        if (has) {
            return;
        }
        listeners.push(listener);
        emit ListenerAdded(address(listener));
    }

    function removeListener(IAprTupleFeedListener listener) external onlyRole(UPDATER_FEED_ROLE) {
        uint256 len = listeners.length;
        for (uint256 i; i < len;) {
            if (listeners[i] == listener) {
                if (i == len - 1) {
                    listeners[i] = listeners[len - 1];
                }
                listeners.pop();
                emit ListenerRemoved(address(listener));
                return;
            }
            unchecked { i++; }
        }
    }

    function hasListener(IAprTupleFeedListener listener) public view returns (bool) {
        uint256 len = listeners.length;
        for (uint256 i; i < len;) {
            if (listeners[i] == listener) {
                return true;
            }
            unchecked { i++; }
        }
        return false;
    }


    function ensureValid(int64 answer) internal pure {
        require(
            APR_BOUNDARY_MIN <= answer && answer <= APR_BOUNDARY_MAX,
            "invalid apr"
        );
    }
}
