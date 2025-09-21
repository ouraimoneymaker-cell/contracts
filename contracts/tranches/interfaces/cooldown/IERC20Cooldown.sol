// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Cooldown {
    function transfer(IERC20 token, address to, uint256 amount, uint256 cooldownSeconds) external;
    function finalize(IERC20 token, address user) external returns (uint256 claimed);
    function finalize(IERC20 token, address user, uint256 at) external returns (uint256 claimed);

    function balanceOf (IERC20 token, address user) external view returns (uint256);
    function balanceOf (IERC20 token, address user, uint256 at) external view returns (uint256);
}
