// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IYieldVault is IERC4626 {
    // Redemptions
    function requestRedeem(uint256 shares) external;
    function completeRedeem(address user) external;
    function cancelRedeem() external;

    // Rewards
    function createRewardsEpoch(uint256 epochIndex, bytes32 merkleRoot, uint256 totalRewards) external;
    function claimRewards(uint256 epochIndex, uint256 amount, bytes32[] calldata proof) external;
    function mintRewards(address to, uint256 amount) external;

    // Views
    function redeemVault() external view returns (address);
    function currentEpochIndex() external view returns (uint256);
    function getPendingRedemption(address user) external view returns (bool hasPending, uint256 shares, uint256 assets);
    function hasClaimedRewards(address user, uint256 epochIndex) external view returns (bool claimed);
}
