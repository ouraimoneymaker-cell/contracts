// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ICDOComponent } from "./ICDOComponent.sol";
import { IAprTupleFeedListener } from "./IAprFeed.sol";

interface IYieldAccounting is ICDOComponent, IAprTupleFeedListener {
    function updateAccounting (uint256 currentNAV) external;
    function updateBalanceFlow (
        uint256 jrtAssetsIn,
        uint256 jrtAssetsOut,
        uint256 srtAssetsIn,
        uint256 srtAssetsOut
    ) external;

    function totalAssets (uint256 currentNAV) external view returns (uint jrtAssets, uint srtAssets, uint reserveAssets);
}
