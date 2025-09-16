// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IAggregatorV3Interface } from "./IAggregatorV3Interface.sol";


interface IAprTupleFeed {
    function updateRoundData(int64 newAprTarget, int64 newAprBase) external;
    function addListener(IAprTupleFeedListener listener) external;
    function removeListener(IAprTupleFeedListener listener) external;
    function hasListener(IAprTupleFeedListener listener) external view returns (bool);
}

interface IAprTupleFeedListener {
    function onAprChanged(/* SD7x12 */int64 newAprTarget, /* SD7x12 */ int64 newAprBase) external;
}

