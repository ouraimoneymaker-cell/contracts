// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC4626Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { IStrataCDO }  from "./interfaces/IStrataCDO.sol";
import { IStrategy } from "./interfaces/IStrategy.sol";
import { CDOComponent }  from "./base/CDOComponent.sol";

contract Tranche is CDOComponent, ERC4626Upgradeable, ERC20PermitUpgradeable {

    /// @notice Minimum non-zero shares amount to prevent donation attack
    uint256 private constant MIN_SHARES = 0.1 ether;

    event OnMetaDeposit(address indexed owner, address indexed token, uint256 tokenAssets, uint256 shares);
    event OnMetaWithdraw(address indexed owner, address indexed token, uint256 tokenAssets, uint256 shares);

    function initialize(
        address owner_,
        address acm_,
        string memory name,
        string memory symbol,
        IERC20 baseAsset,
        IStrataCDO cdo_
    ) public virtual initializer {
        __ERC20_init_unchained(name, symbol);
        __ERC4626_init_unchained(baseAsset);
        __ERC20Permit_init(name);
        AccessControlled_init(owner_, acm_);

        cdo = cdo_;
    }


    /// @return uint256 The total assets for this tranche
    function totalAssets() public view override returns (uint256) {
        return cdo.totalAssets(address(this));
    }

    function decimals() public view override(ERC20Upgradeable, ERC4626Upgradeable) returns (uint8) {
        return super.decimals();
    }

    /**
     * ============================================
     *              ERC4626 max*|preview* methods
     * ============================================
     */

    /** @dev Extends {IERC4626-maxDeposit} to handle the paused state and the TVL ratio */
    function maxDeposit(address owner) public view override returns (uint256) {
        return cdo.maxDeposit(address(this));
    }

    /** @dev Extends {IERC4626-maxMint} to handle the paused state and the TVL ratio */
    function maxMint(address owner) public view override returns (uint256) {
        uint256 assets = cdo.maxDeposit(address(this));
        if (assets == type(uint256).max) {
            // No mint-cap
            return type(uint256).max;
        }
        return convertToShares(assets);
    }

    /** @dev Extends {IERC4626-maxWithdraw} to handle the paused state and the TVL ratio */
    function maxWithdraw(address owner) public view override returns (uint256 assetsNet) {
        uint256 sharesGross = balanceOf(owner);
        assetsNet = Math.min(previewRedeem(sharesGross), cdo.maxWithdraw(address(this)));
    }

    /** @dev Extends {IERC4626-maxRedeem} to handle the paused state and the TVL ratio */
    function maxRedeem(address owner) public view override returns (uint256 sharesGross) {
        uint256 assetsProtocolMax = cdo.maxWithdraw(address(this));
        uint256 sharesProtocolMax = convertToShares(assetsProtocolMax);
        sharesGross = Math.min(super.maxRedeem(owner), sharesProtocolMax);
    }

    /** @dev Extends {IERC4626-previewRedeem} to handle fee calculation */
    function previewRedeem(uint256 sharesGross) public view override returns (uint256 assetsNet) {
        uint256 fee = cdo.calculateExitFee(address(this), sharesGross, true);
        assetsNet = super.previewRedeem(sharesGross - fee);
    }

    /** @dev Extends {IERC4626-previewWithdraw} to handle fee calculation */
    function previewWithdraw(uint256 assetsNet) public view override returns (uint256 sharesGross) {
        uint256 sharesNet = super.previewWithdraw(assetsNet);
        uint256 fee = cdo.calculateExitFee(address(this), sharesNet, false);
        sharesGross = sharesNet + fee;
    }

    /**
     * ============================================
     *              MetaVault max*|preview* methods
     * ============================================
     */

    /** @dev Overloads {IERC4626-maxWithdraw} to return the withdrawable amount denominated in the specified Meta Token. */
    function maxWithdraw(address token, address owner) public view returns (uint256) {
        uint256 baseAssets = maxWithdraw(owner);
        uint256 tokenAssets = cdo.strategy().convertToTokens(token, baseAssets, Math.Rounding.Ceil);
        return tokenAssets;
    }

    /** @dev Overloads {IERC4626-maxDeposit} to return the maximum deposit amount denominated in the specified Meta Token. */
    function maxDeposit(address token, address owner) public view returns (uint256) {
        uint256 baseAssets = maxDeposit(owner);
        uint256 tokenAssets = cdo.strategy().convertToTokens(token, baseAssets, Math.Rounding.Floor);
        return tokenAssets;
    }

    /** @dev Overloads {IERC4626-previewDeposit} to calculate the shares for a given Meta Token deposit amount. */
    function previewDeposit(address token, uint256 tokenAmount) public view returns (uint256) {
        uint256 baseAssets = cdo.strategy().convertToAssets(token, tokenAmount, Math.Rounding.Floor);
        uint256 shares = previewDeposit(baseAssets);
        return shares;
    }

    /** @dev Overloads {IERC4626-previewMint} to return the required Meta Token amount for minting the given number of shares. */
    function previewMint(address token, uint256 shares) public view returns (uint256) {
        uint256 baseAssets = previewMint(shares);
        uint256 tokenAssets = cdo.strategy().convertToTokens(token, baseAssets, Math.Rounding.Ceil);
        return tokenAssets;
    }

    /** @dev Overloads {IERC4626-previewRedeem} to return the redeemable Meta Token amount for the given number of shares. */
    function previewRedeem(address token, uint256 shares) public view returns (uint256) {
        uint256 baseAssets = previewRedeem(shares);
        uint256 tokenAssets = cdo.strategy().convertToTokens(token, baseAssets, Math.Rounding.Ceil);
        return tokenAssets;
    }

    /** @dev Overloads {IERC4626-previewWithdraw} to calculate the shares required to withdraw the given Meta Token amount. */
    function previewWithdraw(address token, uint256 tokenAmount) public view returns (uint256) {
        uint256 baseAssets = cdo.strategy().convertToAssets(token, tokenAmount, Math.Rounding.Floor);
        uint256 shares = previewWithdraw(baseAssets);
        return shares;
    }

    /**
     * ============================================
     *        ERC4626 and Meta deposit/mint methods
     * ============================================
     */

    /** @dev See {IERC4626-deposit}. */
    function deposit(uint256 tokenAssets, address receiver) public override returns (uint256) {
        cdo.updateAccounting();
        uint256 shares = super.deposit(tokenAssets, receiver);
        return shares;
    }
    function deposit(address token, uint256 tokenAmount, address receiver) public virtual returns (uint256) {
        if (token == asset()) {
            return deposit(tokenAmount, receiver);
        }
        cdo.updateAccounting();
        // {Optimistic path} Reverts if token is not supported
        uint256 baseAssets = cdo.strategy().convertToAssets(token, tokenAmount, Math.Rounding.Floor);
        uint256 shares = previewDeposit(baseAssets);
        _deposit(token, _msgSender(), receiver, baseAssets, tokenAmount, shares);
        return shares;
    }
    /** @dev See {IERC4626-mint}. */
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        cdo.updateAccounting();
        uint256 assets = super.mint(shares, receiver);
        return assets;
    }
    function mint(address token, uint256 shares, address receiver) public virtual returns (uint256) {
        if (token == asset()) {
            return mint(shares, receiver);
        }
        cdo.updateAccounting();

        uint256 baseAssets = previewMint(shares);
        // {Optimistic path} Reverts if token is not supported
        uint256 tokenAssets = cdo.strategy().convertToTokens(token, baseAssets, Math.Rounding.Ceil);
        _deposit(token, _msgSender(), receiver, baseAssets, tokenAssets, shares);
        return tokenAssets;
    }

    /**
     * @dev Deposit/mint common workflow for base token
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        cdo.deposit(address(this), asset(), assets, assets);
    }

    /**
     * @dev Deposit/mint common workflow for meta token
     */
    function _deposit(address token, address caller, address receiver, uint256 baseAssets, uint256 tokenAssets, uint256 shares) internal virtual {
        // Ensure the caller can withdraw the deposited tokenAssets amount
        uint256 maxTokenToBaseAssetsWithdraw = IERC4626(token).maxWithdraw(caller);
        require(maxTokenToBaseAssetsWithdraw >= baseAssets, "MetaVaultExceededMaxWithdraw");

        SafeERC20.safeTransferFrom(IERC20(token), caller, address(this), tokenAssets);
        _mint(receiver, shares);

        cdo.deposit(address(this), token, tokenAssets, baseAssets);
        emit Deposit(caller, receiver, baseAssets, shares);
        emit OnMetaDeposit(receiver, token, tokenAssets, shares);
    }

    /**
     * ============================================
     *     ERC4626 and Meta withdraw/redeem methods
     * ============================================
     */

    /** @dev See {IERC4626-withdraw}. */
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        cdo.updateAccounting();
        uint256 shares = super.withdraw(assets, receiver, owner);
        return shares;
    }
    function withdraw(address token, uint256 tokenAmount, address receiver, address owner) public virtual returns (uint256) {
        if (token == asset()) {
            return withdraw(tokenAmount, receiver, owner);
        }
        cdo.updateAccounting();
        // {Optimistic path} Reverts if token is not supported
        uint256 baseAssets = cdo.strategy().convertToAssets(token, tokenAmount, Math.Rounding.Floor);
        uint256 maxAssets = maxWithdraw(owner);
        if (baseAssets > maxAssets) {
            revert ERC4626ExceededMaxWithdraw(owner, baseAssets, maxAssets);
        }
        uint256 shares = previewWithdraw(baseAssets);
        _withdraw(token, _msgSender(), receiver, owner, baseAssets, tokenAmount, shares);
        return shares;
    }

    /** @dev See {IERC4626-redeem}. */
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        cdo.updateAccounting();
        uint256 assets = super.redeem(shares, receiver, owner);
        return assets;
    }
    function redeem(address token, uint256 shares, address receiver, address owner) public virtual returns (uint256) {
        if (token == asset()) {
            return redeem(shares, receiver, owner);
        }
        cdo.updateAccounting();
        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) {
            revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);
        }

        uint256 baseAssets = previewRedeem(shares);
        // {Optimistic path} Reverts if token is not supported
        uint256 tokenAssets = cdo.strategy().convertToTokens(token, baseAssets, Math.Rounding.Ceil);
        _withdraw(token, _msgSender(), receiver, owner, baseAssets, tokenAssets, shares);
        return tokenAssets;
    }

    /**
     * @dev Withdraw/redeem common workflow for base token
     * assets ~ net
     * shares ~ gross
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assetsNet,
        uint256 sharesGross
    ) internal override {
        if (caller != owner) {
            _spendAllowance(owner, caller, sharesGross);
        }
        uint256 assetsGross = convertToAssets(sharesGross);
        uint256 fee = Math.saturatingSub(assetsGross, assetsNet);

        _burn(owner, sharesGross);
        cdo.accrueFee(address(this), fee);
        cdo.withdraw(address(this), asset(), assetsNet, assetsNet, owner, receiver);

        _onAfterWithdrawalChecks();
        emit Withdraw(caller, receiver, owner, assetsNet, sharesGross);
    }

    /**
     * @dev Withdraw/redeem common workflow for meta token
     */
    function _withdraw(
        address token,
        address caller,
        address receiver,
        address owner,
        uint256 baseAssets,
        uint256 tokenAssets,
        uint256 sharesGross
    ) internal virtual {
        if (caller != owner) {
            _spendAllowance(owner, caller, sharesGross);
        }
        uint256 baseAssetsGross = convertToAssets(sharesGross);
        uint256 fee = Math.saturatingSub(baseAssetsGross, baseAssets);

        _burn(owner, sharesGross);
        cdo.accrueFee(address(this), fee);
        cdo.withdraw(address(this), token, tokenAssets, baseAssets, owner, receiver);
        _onAfterWithdrawalChecks();
        emit Withdraw(caller, receiver, owner, baseAssets, sharesGross);
        emit OnMetaWithdraw(receiver, token, tokenAssets, sharesGross);
    }

    /**
     * ============================================
     *        Configuration
     * ============================================
     * @dev During deposit, CDO requests Strategy to process the assets.
     *      Here, we allow the strategy to fetch the assets from the Vault.
     */
    function configure () external onlyCDO {
        address strategy = address(cdo.strategy());
        IERC20[] memory tokens = IStrategy(strategy).getSupportedTokens();
        uint256 len = tokens.length;
        for (uint256 i; i < len; ) {
            SafeERC20.forceApprove(tokens[i], strategy, type(uint256).max);
            unchecked { i++; }
        }
    }

    /**
     * ============================================
     *        Internals
     * ============================================
     */

    function _onAfterWithdrawalChecks () internal view {
        if (totalSupply() < MIN_SHARES) {
            revert MinSharesViolation();
        }
    }
}
