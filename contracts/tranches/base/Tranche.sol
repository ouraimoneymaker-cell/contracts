// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IStrataCDO }  from "../interfaces/IStrataCDO.sol";
import { CDOComponent }  from "../base/CDOComponent.sol";
import { AccessControlled } from "../../governance/AccessControlled.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC4626Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";

contract Tranche is CDOComponent, AccessControlled, ERC4626Upgradeable {

    /// @notice Minimum non-zero shares amount to prevent donation attack
    uint256 private constant MIN_SHARES = 0.1 ether;

    bool public depositsEnabled;
    bool public withdrawalsEnabled;

    event OnMetaDeposit(address indexed owner, address indexed token, uint256 tokenAssets, uint256 shares);
    event OnMetaWithdraw(address indexed owner, address indexed token, uint256 tokenAssets, uint256 shares);

    function initialize(
        address owner_,
        address acm_,
        string memory name,
        string memory symbol,
        IERC20 stakedAsset,
        IStrataCDO cdo_
    ) public virtual initializer {
        __ERC20_init_unchained(name, symbol);
        __ERC4626_init_unchained(stakedAsset);
        AccessControlled_init(owner_, acm_);

        cdo = cdo_;
    }

    /// @return uint256 The total assets for this tranche
    function totalAssets() public view override returns (uint256) {
        return cdo.totalAssets(address(this));
    }

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
        _onAfterDepositChecks();
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
        _onAfterDepositChecks();
        emit Deposit(caller, receiver, baseAssets, shares);
        emit OnMetaDeposit(receiver, token, tokenAssets, shares);
    }

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
        uint256 assets = super.withdraw(shares, receiver, owner);
        return assets;
    }
    function redeem(address token, uint256 shares, address receiver, address owner) public virtual returns (uint256) {
        if (token == asset()) {
            return redeem(shares, receiver, owner);
        }
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
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        _burn(owner, shares);
        cdo.withdraw(address(this), asset(), assets, assets, receiver);
        _onAfterWithdrawalChecks();
        emit Withdraw(caller, receiver, owner, assets, shares);
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
        uint256 shares
    ) internal virtual {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);
        cdo.withdraw(address(this), token, baseAssets, tokenAssets, receiver);
        _onAfterWithdrawalChecks();
        emit Withdraw(caller, receiver, owner, baseAssets, shares);
        emit OnMetaWithdraw(receiver, token, tokenAssets, shares);
    }

    function configure () external onlyCDO {

        IERC20[] memory tokens = cdo.strategy().getSupportedTokens();
        uint256 len = tokens.length;
        address strategy = address(cdo.strategy());
        for (uint256 i = 0; i < len; i++) {
            SafeERC20.forceApprove(tokens[i], strategy, type(uint256).max);
        }
    }

    function _onAfterDepositChecks () internal view {

    }
    function _onAfterWithdrawalChecks () internal view {
        if (totalSupply() < MIN_SHARES) {
            revert MinSharesViolation();
        }
    }
}
