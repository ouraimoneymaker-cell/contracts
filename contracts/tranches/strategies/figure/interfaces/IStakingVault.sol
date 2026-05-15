// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IStakingVault is IERC4626 {
    function distributeRewards(uint256 amount) external;

    function yieldVault() external view returns (address);
    function maxRewardPercent() external view returns (uint256);
    function navOracle() external view returns (address);
    function navStalenessLimit() external view returns (uint32);
    function navFeedId() external view returns (bytes32);
    function maxPeriodRewards() external view returns (uint256);
    function rewardPeriodSeconds() external view returns (uint256);
    function lastRewardDistributedAt() external view returns (uint256);
    function maxTotalRewards() external view returns (uint256);
    function totalRewardsDistributed() external view returns (uint256);
    function getVerifiedNav() external view returns (uint256);
    function getTotalValueAtNav() external view returns (uint256);
}
