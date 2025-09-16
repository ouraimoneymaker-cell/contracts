// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IsUSDe is IERC4626 {
    struct UserCooldown {
        uint104 cooldownEnd;
        uint152 underlyingAmount;
    }

    function cooldownDuration() external view returns (uint24);
    function unstake(address receiver) external;
    function cooldownAssets(uint256 assets) external returns (uint256);
    function cooldownShares(uint256 shares) external returns (uint256);

    function cooldowns (address user) external view returns (UserCooldown memory);
}
