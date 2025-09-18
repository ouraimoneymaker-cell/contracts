// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ICDOComponent } from "./ICDOComponent.sol";
import { IAprTupleFeedListener } from "./IAprFeed.sol";

interface IAccounting is ICDOComponent, IAprTupleFeedListener {

    function updateAccounting (uint256 navT1) external;
    function updateBalanceFlow (
        uint256 jrtAssetsIn,
        uint256 jrtAssetsOut,
        uint256 srtAssetsIn,
        uint256 srtAssetsOut
    ) external;

    function totalAssets (uint256 navT1) external view returns (uint jrtNavT1, uint srtNavT1, uint reserveNavT1);
    function totalReserveT0 () external view returns (uint256);
    function reduceReserve (uint256 amount) external;
}
