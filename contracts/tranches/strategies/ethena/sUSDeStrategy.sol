// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";


import { IErrors } from "../../interfaces/IErrors.sol";
import { IStrategy } from "../../interfaces/IStrategy.sol";
import { IStrataCDO } from "../../interfaces/IStrataCDO.sol";
import { IERC20Cooldown } from "../../interfaces/cooldown/IERC20Cooldown.sol";
import { IUnstakeCooldown } from "../../interfaces/cooldown/IUnstakeCooldown.sol";

import { Strategy } from "../../Strategy.sol";

contract sUSDeStrategy is IStrategy, Strategy {

    IERC4626 public immutable sUSDe;
    IERC20 public immutable USDe;

    IERC20Cooldown public erc20Cooldown;
    IUnstakeCooldown public unstakeCooldown;

    /** configuration */

    uint256 public sUSDeCooldownJrt;
    uint256 public sUSDeCooldownSrt;


    event CooldownsChanged(uint256 jrt, uint256 srt);


    constructor (IERC4626 sUSDe_) {
        sUSDe = sUSDe_;
        USDe = IERC20(sUSDe_.asset());
    }

    function initialize(
        address owner_,
        address acm_,
        IStrataCDO cdo_,
        IERC20Cooldown erc20Cooldown_,
        IUnstakeCooldown unstakeCooldown_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);

        cdo = cdo_;
        erc20Cooldown = erc20Cooldown_;
        unstakeCooldown = unstakeCooldown_;

        SafeERC20.forceApprove(sUSDe, address(erc20Cooldown), type(uint256).max);
        SafeERC20.forceApprove(sUSDe, address(unstakeCooldown), type(uint256).max);
    }


    function deposit (address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address owner) external onlyCDO returns (uint256) {
        // @TODO check tokenAmount - baseAssets flow from paranets
        SafeERC20.safeTransferFrom(IERC20(token), owner, address(this), tokenAmount);

        if (token == address(USDe)) {
            SafeERC20.forceApprove(USDe, address(sUSDe), tokenAmount);
            sUSDe.deposit(tokenAmount, address(this));
            return tokenAmount;
        }
        if (token == address(sUSDe)) {
            //baseAssets = sUSDe.previewRedeem(tokenAmount);
            return baseAssets;
        }
        revert UnsupportedToken(token);
    }

    function withdraw (address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address receiver) external onlyCDO returns (uint256) {
        // @TODO check tokenAmount - baseAssets flow from paranets
        uint256 shares = sUSDe.previewWithdraw(baseAssets);
        if (token == address(sUSDe)) {
            uint256 cooldownSeconds = cdo.isJrt (tranche) ? sUSDeCooldownJrt : sUSDeCooldownSrt;
            erc20Cooldown.transfer(sUSDe, receiver, shares, cooldownSeconds);
            return shares;
        }
        if (token == address(USDe)) {
            unstakeCooldown.transfer(sUSDe, receiver, shares);
            return baseAssets;
        }
        revert UnsupportedToken(token);
    }

    function reduceReserve (address token, uint256 tokenAmount, address receiver) external onlyCDO {
        if (token == address(sUSDe)) {
            erc20Cooldown.transfer(sUSDe, receiver, tokenAmount, 0);
            return;
        }
        if (token == address(USDe)) {
            unstakeCooldown.transfer(sUSDe, receiver, tokenAmount);
            return;
        }
        revert UnsupportedToken(token);
    }

    function totalAssets () external view returns (uint256 baseAssets) {
        uint256 shares = sUSDe.balanceOf(address(this));
        baseAssets = sUSDe.previewRedeem(shares);
        return baseAssets;
    }

    function convertToAssets (address token, uint256 tokenAmount, Math.Rounding rounding) external view returns (uint256) {
        if (token == address(sUSDe)) {
            return rounding == Math.Rounding.Floor
                ? sUSDe.previewRedeem(tokenAmount) // aka convertToAssets(tokenAmount)
                : sUSDe.previewMint(tokenAmount);
        }
        if (token == address(USDe)) {
            return tokenAmount;
        }
        revert UnsupportedToken(token);
    }

    function convertToTokens (address token, uint256 baseAssets, Math.Rounding rounding) external view returns (uint256) {
        if (token == address(sUSDe)) {
            return rounding == Math.Rounding.Floor
                ? sUSDe.previewDeposit(baseAssets) // aka convertToShares(baseAssets)
                : sUSDe.previewWithdraw(baseAssets);
        }
        if (token == address(USDe)) {
            return baseAssets;
        }
        revert UnsupportedToken(token);
    }

    function getSupportedTokens () external view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = IERC20(address(sUSDe));
        tokens[1] = USDe;
        return tokens;
    }

    function setCooldowns (uint256 sUSDeCooldownJrt_, uint256 sUSDeCooldownSrt_) external onlyRole(UPDATER_STRAT_CONFIG_ROLE) {
        uint256 WEEK = 7 days;
        if (sUSDeCooldownJrt_ > WEEK || sUSDeCooldownSrt_ > WEEK) {
            revert InvalidConfigCooldown();
        }
        sUSDeCooldownJrt = sUSDeCooldownJrt_;
        sUSDeCooldownSrt = sUSDeCooldownSrt_;
        emit CooldownsChanged(sUSDeCooldownJrt_, sUSDeCooldownSrt_);
    }
}
