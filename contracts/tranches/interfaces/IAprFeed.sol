// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IAggregatorV3Interface } from "./IAggregatorV3Interface.sol";


interface IAprTupleFeed {
    struct Round {
        // SD7x12
        int64 aprTarget;
        int64 aprBase;
        uint64 updatedAt;
        uint64 answeredInRound;
    }

    function updateRoundData(int64 newAprTarget, int64 newAprBase) external;
    function addListener(IAprTupleFeedListener listener) external;
    function removeListener(IAprTupleFeedListener listener) external;
    function hasListener(IAprTupleFeedListener listener) external view returns (bool);

    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint8);
    function getRoundData(uint64 roundId)external view returns (Round memory);
    function latestRoundData() external view returns (Round memory);
}

interface IAprTupleFeedListener {
    function onAprChanged(/* SD7x12 */int64 newAprTarget, /* SD7x12 */ int64 newAprBase) external;
}

