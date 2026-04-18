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
import {IsUSDat} from "./IsUSDat.sol";

/**
 * @title SaturnCooldownRequestImpl
 * @dev Implementation of the unstake process for sUSDat tokens via Saturn's WithdrawalQueueERC721.
 * This contract is designed to be used within the UnstakeCooldown contract.
 *
 * Flow:
 * 1. `request()` - calls `sUSDat.requestRedeem(shares, 0)` which:
 *    - Internally transfers sUSDat shares from this contract to the WithdrawalQueue
 *    - Mints an ERC721 NFT representing the withdrawal request to this contract
 *    - No approval needed: requestRedeem uses internal _transfer
 * 2. Saturn's off-chain processor processes the withdrawal request:
 *    - Converts STRC to USDat as needed
 *    - Marks the request as Processed in the WithdrawalQueue
 * 3. `finalize()` - calls `sUSDat.claim()` which:
 *    - Calls WithdrawalQueue.claimAllFor(this) — transfers USDat to this contract
 *    - Reverts with NothingToClaim if not yet processed (caught by UnstakeCooldown's try/catch)
 *    - This contract then transfers USDat to the receiver
 *
 * Note: Saturn's withdrawal queue has no fixed SLA. Processing typically takes ~7 days.
 */
contract SaturnCooldownRequestImpl is IUnstakeHandler, Initializable {
    IsUSDat public immutable sUSDat;
    IERC20 public immutable USDat;

    address public handler;
    address public user;
    address public receiver;
    uint256 public requestedAt;
    uint256 public requestedAmount;

    bool public pending;

    error HasActiveRequest();

    constructor(IsUSDat sUSDat_) {
        _disableInitializers();

        sUSDat = sUSDat_;
        USDat = IERC20(sUSDat_.asset());
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
        require(pending == false, "HasActiveRequest");

        uint256 shares = sUSDat.balanceOf(address(this));
        require(shares > 0, "NoSharesToRedeem");

        // Record the expected base asset value before the request
        // (shares will be transferred to the withdrawal queue)
        requestedAmount = sUSDat.previewRedeem(shares);

        // requestRedeem internally transfers shares from this contract to the WithdrawalQueue.
        // No approval needed — sUSDat uses internal _transfer.
        // minUsdatReceived = 0 (no slippage protection at this stage)
        sUSDat.requestRedeem(shares, 0);

        requestedAt = block.timestamp;
        receiver = receiver_;
        pending = true;

        // Saturn typically processes requests within 7 days
        return block.timestamp + 7 days;
    }

    /**
     * @dev Completes the unstake request and transfers USDat to the receiver.
     * Calls sUSDat.claim() which internally calls WithdrawalQueue.claimAllFor(this).
     * If the request has not yet been processed by Saturn, claim() reverts with
     * NothingToClaim — UnstakeCooldown catches this via try/catch and skips
     * the unready request without marking it as completed.
     * Can be called by the UnstakeHandler, which can be triggered permissionlessly.
     */
    function finalize() external returns (uint256 amount) {
        require(msg.sender == handler, "NotAuthorized");

        // claim() reverts if no processed requests exist (NothingToClaim).
        // This is the desired behavior — UnstakeCooldown wraps in try/catch.
        sUSDat.claim();

        amount = USDat.balanceOf(address(this));
        if (amount > 0) {
            SafeERC20.safeTransfer(USDat, receiver, amount);
        }

        pending = false;
        requestedAmount = 0;
        return amount;
    }

    /**
     * @dev Sweeps any residual USDat balance to the receiver.
     * Permissionless — when pending is false, this proxy is no longer managed
     * by UnstakeCooldown, so anyone can trigger the late settlement.
     * Useful if assets arrive after finalization, or if a small remainder
     * is left behind due to rounding or partial fulfillment.
     */
    function finalizeLateSettlement() external returns (uint256 amount) {
        require(pending == false, "HasActiveRequest");

        amount = USDat.balanceOf(address(this));
        if (amount > 0) {
            SafeERC20.safeTransfer(USDat, receiver, amount);
        }
        return amount;
    }

    function getPendingAmount() external view returns (uint256 amount) {
        amount = requestedAmount;
        return amount;
    }

    /**
     * @notice Saturn withdrawals always go through the queue.
     * @dev Returns true so that the cooldown flow is always used.
     */
    function isCooldownActive() public pure returns (bool) {
        return true;
    }
}
