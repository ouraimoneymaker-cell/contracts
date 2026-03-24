// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockSparkVault
 * @notice Minimal Spark-Vault-V2-like ERC4626 for local tests.
 */
contract MockSparkVault is ERC4626 {
    constructor(IERC20 asset_) ERC20("Spark USDC Vault", "spUSDC") ERC4626(asset_) {}

    /// @notice No-op drip — Spark V2 accrues via chi, but the mock exposes accrue() instead.
    function drip() external pure {}
}
