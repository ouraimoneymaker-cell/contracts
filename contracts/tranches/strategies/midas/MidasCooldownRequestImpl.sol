// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUnstakeHandler} from "../../interfaces/cooldown/IUnstakeHandler.sol";
import {IMToken} from "./interfaces/IMToken.sol";
import {IRedemptionVault} from "./interfaces/IRedemptionVault.sol";

/**
 * @title MidasCooldownRequestImpl
 * @dev Implementation of the unstake process for Midas tokens with cooldown period.
 * This contract is designed to be used within the UnstakeCooldown contract.
 * It handles the cooldown request, finalization, and asset transfer for unstaking Midas tokens.
 *
 * Flow:
 * 1. `request()` — tries instant redemption first via `redeemInstant` (wrapped in try/catch).
 *    If instant fails (e.g. daily limit exceeded), falls back to `redeemRequest`.
 *    Midas creates a Request struct and holds the mTokens.
 * 2. Midas admin approves the request off-chain, which transfers the base asset (e.g. USDC)
 *    from the `requestRedeemer` to this proxy contract.
 * 3. `finalize()` — transfers the received base asset to the receiver.
 */
contract MidasCooldownRequestImpl is IUnstakeHandler, Initializable {
    IMToken public immutable mToken;
    IERC20 public immutable baseAsset;
    IRedemptionVault public immutable redemptionVault;

    address public handler;
    address public user;
    address public receiver;
    uint256 public requestedAt;
    uint256 public requestedAmount;

    bool public pending;

    error HasActiveRequest();

    constructor(
        IERC20 baseAsset_,
        IMToken mToken_,
        IRedemptionVault redemptionVault_
    ) {
        _disableInitializers();

        baseAsset = baseAsset_;
        mToken = mToken_;
        redemptionVault = redemptionVault_;
    }

    function initialize(
        address handler_,
        address user_
    ) public virtual initializer {
        user = user_;
        handler = handler_;
    }

    function request() external returns (uint256 unlockAt) {
        return request(user);
    }
    function request(address receiver_) public returns (uint256 unlockAt) {
        require(msg.sender == handler, "NotAuthorized");
        require(pending == false, "Already has an active request");

        uint256 shares = mToken.balanceOf(address(this));
        require(shares > 0, "No mToken to redeem");

        SafeERC20.forceApprove(
            IERC20(address(mToken)),
            address(redemptionVault),
            shares
        );

        // Try instant redemption first (may fail when daily limits are exceeded)
        try redemptionVault.redeemInstant(address(baseAsset), shares, 0) {
            // Instant succeeded — transfer baseAsset directly to receiver
            uint256 received = baseAsset.balanceOf(address(this));
            if (received > 0) {
                SafeERC20.safeTransfer(baseAsset, receiver_, received);
            }
            return block.timestamp; // signals instant to UnstakeCooldown
        } catch {
            // Instant failed — fall back to redeemRequest
            redemptionVault.redeemRequest(address(baseAsset), shares);

            requestedAt = block.timestamp;
            receiver = receiver_;
            pending = true;
            requestedAmount = shares;

            // Midas typically processes requests within 1-3 days
            return block.timestamp + 3 days;
        }
    }

    /**
     * @dev Completes the unstake request and transfers assets to the receiver.
     * After Midas admin approves the request, the base asset is transferred
     * from the requestRedeemer to this proxy. This function transfers those assets
     * to the final receiver.
     * Reverts if assets have not been received yet — this allows UnstakeCooldown
     * to skip unready requests via try/catch without marking them as completed.
     * Can be called by the UnstakeHandler, which can be triggered permissionlessly.
     */
    function finalize() external returns (uint256 amount) {
        require(msg.sender == handler, "NotAuthorized");

        amount = baseAsset.balanceOf(address(this));
        require(amount > 0, "Assets not received");
        SafeERC20.safeTransfer(baseAsset, receiver, amount);

        pending = false;
        requestedAmount = 0;
        return amount;
    }

    function getPendingAmount() external view returns (uint256 amount) {
        amount = requestedAmount;
        return amount;
    }

    /**
     * @notice Midas redemptions go through the cooldown flow.
     * @dev Returns true so that the cooldown flow is always used.
     *      The instant path is handled inside `request()` via try/catch —
     *      if redeemInstant succeeds, `request()` returns block.timestamp,
     *      which UnstakeCooldown treats as an instant transfer (no TRequest stored).
     */
    function isCooldownActive() public pure returns (bool) {
        return true;
    }
}
