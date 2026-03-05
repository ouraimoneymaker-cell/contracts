// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IMToken } from "./interfaces/IMToken.sol";
import { IDepositVault } from "./interfaces/IDepositVault.sol";
import { IRedemptionVault } from "./interfaces/IRedemptionVault.sol";
import { IErrors } from "../../interfaces/IErrors.sol";
import { IStrataCDO } from "../../interfaces/IStrataCDO.sol";
import { IERC20Cooldown, IUnstakeCooldown } from "../../interfaces/cooldown/ICooldown.sol";
import { Strategy } from "../../Strategy.sol";

contract MidasStrategy is Strategy {

    // e.g. mHYPER 0x9b5528528656DBC094765E2abB79F293c21191B9
    IMToken public immutable mToken;

    // e.g. 0xbA9FD2850965053Ffab368Df8AA7eD2486f11024
    IDepositVault public immutable depositVault;

    // e.g. 0x570c15bc5faf98531a8b351d69e22e41e3505e47
    IRedemptionVault public immutable redemptionVault;

    IERC20 public immutable baseAsset;

    // Additional supported tokens to deposit, beyond the base asset and mToken
    mapping(address token => bool isSupported) public depositTokensDict;
    address[] public depositTokens;

    IERC20Cooldown public erc20Cooldown;
    IUnstakeCooldown public unstakeCooldown;

    /** configuration */

    uint256 public mTokenCooldownJrt;
    uint256 public mTokenCooldownSrt;

    event CooldownsChanged(uint256 jrt, uint256 srt);

    constructor (
        IERC20 baseAsset_,
        IMToken mToken_,
        IDepositVault depositVault_,
        IRedemptionVault redemptionVault_,
        address[] memory depositTokens_
    ) {
        baseAsset = baseAsset_;
        mToken = mToken_;
        depositVault = depositVault_;
        redemptionVault = redemptionVault_;
        depositTokens = depositTokens_;

        for (uint256 i = 0; i < depositTokens_.length; i++) {
            depositTokensDict[depositTokens_[i]] = true;
        }
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

        SafeERC20.forceApprove(mToken, address(erc20Cooldown), type(uint256).max);
        SafeERC20.forceApprove(mToken, address(unstakeCooldown), type(uint256).max);
    }

    /**
     * @notice Processes asset deposits for the CDO contract.
     * @dev This method is called by the CDO contract to handle asset deposits.
     *      If the deposited token is USDe, it will be staked to receive Midas.
     *      If the deposited token is already Midas, it will be accepted as is.
     * @param tranche The address of the tranche depositing assets (not used in this strategy)
     * @param token The address of the token being deposited
     * @param tokenAmount The amount of tokens being deposited
     * @param baseAssets The amount of base assets represented by the deposit (used for Midas deposits)
     * @param owner The address of the asset owner from whom to transfer tokens
     * @return The amount of base assets received after deposit
     */
    function deposit (address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address owner) external onlyCDO returns (uint256) {
        SafeERC20.safeTransferFrom(IERC20(token), owner, address(this), tokenAmount);

        if (token == address(baseAsset) || depositTokensDict[address(baseAsset)] == true) {
            SafeERC20.forceApprove(IERC20(token), address(depositVault), tokenAmount);

            // @TODO do we need to pre-calculate
            uint256 minReceiveAmount = 0;
            // @TODO handle via storage variable and constructor to use OUR referred ID
            bytes32 referrerId = bytes32(0);
            depositVault.depositInstant(token, tokenAmount, minReceiveAmount, referrerId);

            // @TODO Convert depositTokensDict (USDT, DAI) to baseAsset (USDC)
            // Convert received mToken to baseAsset
            return tokenAmount;
        }
        if (token == address(mToken)) {
            // already transferred in ↑
            return baseAssets;
        }
        revert UnsupportedToken(token);
    }

    /**
     * @notice Processes asset withdrawals for the CDO contract.
     * @dev This method is called by the CDO contract to handle asset withdrawals.
     *      If withdrawing Midas, a cooldown period is applied based on the tranche type.
     *      If withdrawing USDe, the Midas is unstaked with a cooldown.
     * @param tranche The address of the tranche withdrawing assets
     * @param token The address of the token to be withdrawn
     * @param tokenAmount The amount of tokens to be withdrawn (not used in this implementation)
     * @param baseAssets The amount of base assets to be withdrawn
     * @param receiver The address that will receive the withdrawn assets
     * @param sender The account that initiated the withdrawal
     * @return The amount of tokens withdrawn (shares for Midas, baseAssets for USDe)
     */
    function withdraw (address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address sender, address receiver) external onlyCDO returns (uint256) {
        return withdrawInner(tranche, token, tokenAmount, baseAssets, sender, receiver, false);
    }

    function withdraw (address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address sender, address receiver, bool shouldSkipCooldown) external onlyCDO returns (uint256) {
        return withdrawInner(tranche, token, tokenAmount, baseAssets, sender, receiver, shouldSkipCooldown);
    }

    function withdrawInner (address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address sender, address receiver, bool shouldSkipCooldown) internal returns (uint256) {
        uint256 shares = convertToTokens(address(mToken), baseAssets, Math.Rounding.Ceil); // aka IERC4626::previewWithdraw
        if (token == address(mToken)) {
            uint256 cooldownSeconds = shouldSkipCooldown ? 0 : (cdo.isJrt (tranche) ? mTokenCooldownJrt : mTokenCooldownSrt);
            erc20Cooldown.transfer(mToken, sender, receiver, shares, cooldownSeconds);
            return shares;
        }
        if (token == address(baseAsset)) {
            unstakeCooldown.transfer(mToken, sender, receiver, shares);
            return baseAssets;
        }
        revert UnsupportedToken(token);
    }

    /**
     * @notice Allows the CDO to withdraw tokens from the strategy's reserve
     * @dev This function is part of the reserve reduction process and can only be called by the CDO.
     *      It handles both Midas and USDe tokens, applying different transfer mechanisms for each.
     *      For Midas, it uses erc20Cooldown with no cooldown period.
     *      For USDe, it uses unstakeCooldown to handle the unstaking process.
     * @param token The address of the token to be withdrawn (either Midas or USDe)
     * @param tokenAmount The amount of tokens to be withdrawn
     * @param receiver The address that will receive the withdrawn tokens
     */
    function reduceReserve (address token, uint256 tokenAmount, address receiver) external onlyCDO {
        if (token == address(mToken)) {
            erc20Cooldown.transfer(mToken, receiver, receiver, tokenAmount, 0);
            return;
        }
        if (token == address(baseAsset)) {
            // tokenAmount is in baseAssets, convert to MTokens (Rounding.Floor/in favor of protocol) and trigger unstaking
            uint256 shares = convertToTokens(address(mToken), tokenAmount, Math.Rounding.Floor);
            if (shares == 0) {
                revert ZeroAmount();
            }
            unstakeCooldown.transfer(mToken, receiver, receiver, shares);
            return;
        }
        revert UnsupportedToken(token);
    }

    /**
     * @notice Calculates the total assets managed by this strategy
     * @dev This function returns the current value of the strategy's assets in USDe.
     * @return baseAssets The total amount of USDe managed by this strategy
     */
    function totalAssets () public view returns (uint256 baseAssets) {
        uint256 shares = mToken.balanceOf(address(this));
        baseAssets = convertToAssets(address(mToken), shares, Math.Rounding.Floor); // aka ERC4626::previewRedeem
        return baseAssets;
    }

    /**
     * @notice Calculates the total assets managed by this strategy
     * @dev The strategy vests rewards continuously, so it reports the current total assets.
     * @return baseAssets The total amount of USDe managed by this strategy
     */
    function totalAssets (uint256 latestNav, uint256 timestamp) public view returns (uint256 baseAssets) {
        // @TODO fetch latest Oracle update
        // updatedAt > timestamp => return totalAssets();
        // else => latestNav;

        return totalAssets();
    }

    /**
     * @notice Converts a given amount of supported tokens to their equivalent in USDe
     * @dev This function handles conversion for both Midas and USDe tokens.
     *      For Midas, it uses the vault's exchange rate, considering the rounding direction.
     *      For USDe, it returns the input amount as is.
     * @param token The address of the token to convert (either Midas or USDe)
     * @param tokenAmount The amount of tokens to convert
     * @param rounding The rounding direction to use for the conversion (floor or ceiling)
     * @return The equivalent amount in USDe
     */
    function convertToAssets (address token, uint256 tokenAmount, Math.Rounding rounding) public view returns (uint256) {
        if (token == address(mToken)) {
            // return rounding == Math.Rounding.Floor
            //     ? Midas.previewRedeem(tokenAmount) // aka convertToAssets(tokenAmount)
            //     : Midas.previewMint(tokenAmount);

            // @TODO implement the conversion logic mToken => baseAsset
            return 0;
        }
        if (token == address(baseAsset)) {
            return tokenAmount;
        }

        // @TODO do we need to convert other Tokens to baseAsset (DAI, USDT)?

        revert UnsupportedToken(token);
    }

    /**
     * @notice BaseAsset => Token Amount
     * @dev This function handles conversion for both Midas and USDe tokens.
     *      For Midas, it uses the vault's exchange rate, considering the rounding direction.
     *      For USDe, it returns the input amount as is.
     * @param token The address of the token to convert to (either Midas or USDe)
     * @param baseAssets The amount of base assets (USDe) to convert
     * @param rounding The rounding direction to use for the conversion (floor or ceiling)
     * @return The equivalent amount in the requested token (Midas shares or USDe)
     */
    function convertToTokens (address token, uint256 baseAssets, Math.Rounding rounding) public view returns (uint256) {
        if (token == address(mToken)) {
            // return rounding == Math.Rounding.Floor
            //     ? Midas.previewDeposit(baseAssets) // aka convertToShares(baseAssets)
            //     : Midas.previewWithdraw(baseAssets);

            // @TODO implement the conversion logic baseAssets => mToken
            return 0;
        }
        if (token == address(baseAsset)) {
            return baseAssets;
        }

        // @TODO do we need to convert baseAsset to othe tokens (DAI, USDT)?

        revert UnsupportedToken(token);
    }


     /**
     * @notice Returns an array of supported tokens: Midas and USDe
     */
    function getSupportedTokens () external view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](2 + depositTokens.length);
        tokens[0] = IERC20(address(mToken));
        tokens[1] = baseAsset;
        for (uint i = 0; i < depositTokens.length; i++) {
            tokens[2 + i] = IERC20(depositTokens[i]);
        }
        return tokens;
    }

     /**
     * @notice Updates the cooldown periods for Midas withdrawals (USDe cooldown is already defined by Ethena's unstaking period)
     */
    function setCooldowns (uint256 mTokenCooldownJrt_, uint256 mTokenCooldownSrt_) external onlyRole(UPDATER_STRAT_CONFIG_ROLE) {
        uint256 WEEK = 7 days;
        if (mTokenCooldownJrt_ > WEEK || mTokenCooldownSrt_ > WEEK) {
            revert InvalidConfigCooldown();
        }
        mTokenCooldownJrt = mTokenCooldownJrt_;
        mTokenCooldownSrt = mTokenCooldownSrt_;

        bool isDisabled = mTokenCooldownJrt_ == 0 && mTokenCooldownSrt_ == 0;
        erc20Cooldown.setCooldownDisabled(mToken, isDisabled);
        emit CooldownsChanged(mTokenCooldownJrt_, mTokenCooldownSrt_);
    }
}
