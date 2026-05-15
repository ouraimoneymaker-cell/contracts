// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IHastraNavEngine {    
    function updateRate(uint256 totalSupply_, uint256 totalTVL_) external returns (int192);

    function getRate() external view returns (int192);
    function getUpdater() external view returns (address);
    function getMaxDifferencePercent() external view returns (uint256);
    function getMinRate() external view returns (int192);
    function getMaxRate() external view returns (int192);
    function getLatestTotalSupply() external view returns (uint256);
    function getLatestTVL() external view returns (uint256);
    function getLatestUpdateTime() external view returns (uint256);
}
