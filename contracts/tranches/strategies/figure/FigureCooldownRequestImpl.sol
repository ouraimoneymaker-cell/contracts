// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUnstakeHandler} from "../../interfaces/cooldown/IUnstakeHandler.sol";
import {IYieldVault} from "./interfaces/IYieldVault.sol";

/**
 * @title FigureCooldownRequestImpl
 * @dev Implementation of the unstake process for Figure (Prime) yield vault tokens
 *      with non-deterministic cooldown period.
 *      This contract is designed to be used within the UnstakeCooldown contract.
 *      Each user gets their own cloned proxy, giving each proxy its own redemption slot
 *      on the yield vault (which supports only one pending request per address).
 */
contract FigureCooldownRequestImpl is IUnstakeHandler, Initializable {
    using SafeERC20 for IERC20;

    IYieldVault public immutable yieldVault;
    IERC20 public immutable usdc;

    /// @notice Pessimistic estimate for redemption settlement
    uint256 public constant PESSIMISTIC_SETTLEMENT_PERIOD = 1 days;

    address public handler;
    address public user;
    address public receiver;
    uint256 public requestedAt;
    uint256 public requestedAmount;
    bool    public pending;

    error HasActiveRequest();

    constructor(IYieldVault yieldVault_, IERC20 usdc_) {
        _disableInitializers();
        yieldVault = yieldVault_;
        usdc = usdc_;
    }

    function initialize(address handler_, address user_) public virtual initializer {
        user = user_;
        handler = handler_;
    }

    function request() external returns (uint256 unlockAt) {
        return request(user);
    }

    function request(address receiver_) public returns (uint256 unlockAt) {
        require(msg.sender == handler, "NotAuthorized");
        require(!pending, "HasActiveRequest");

        uint256 shares = IERC20(address(yieldVault)).balanceOf(address(this));
        require(shares > 0, "NoSharesToRedeem");

        yieldVault.requestRedeem(shares);

        // get locked assets amount
        (, , uint256 assets) = yieldVault.getPendingRedemption(address(this));

        requestedAt = block.timestamp;
        receiver = receiver_;
        pending = true;
        requestedAmount = assets;

        return block.timestamp + PESSIMISTIC_SETTLEMENT_PERIOD;
    }

    /**
     * @dev Completes the unstake request and transfers USDC to the receiver.
     * Reverts if the yield vault redemption is still pending
     * this allows UnstakeCooldown to skip unready requests
     */
    function finalize() external returns (uint256 amount) {
        require(msg.sender == handler, "NotAuthorized");

        // If the yield vault still has a pending redemption for this proxy, revert.
        // UnstakeCooldown.finalize() wraps this in try/catch and will retry later.
        (bool hasPending, , ) = yieldVault.getPendingRedemption(address(this));
        require(!hasPending, "RedemptionPending");

        // USDC was delivered to this proxy by the admin completeRedeem(proxyAddress)
        amount = usdc.balanceOf(address(this));
        if (amount > 0) {
            usdc.safeTransfer(receiver, amount);
        }

        pending = false;
        requestedAmount = 0;
        return amount;
    }

    /**
     * @dev Sweeps any residual USDC balance to the receiver.
     * Permissionless — when pending is false, this proxy is no longer managed
     * by UnstakeCooldown, so anyone can trigger the late settlement.
     * Useful if USDC arrives after finalization due to timing edge cases.
     */
    function finalizeLateSettlement() external returns (uint256 amount) {
        require(!pending, "HasActiveRequest");

        amount = usdc.balanceOf(address(this));
        if (amount > 0) {
            usdc.safeTransfer(receiver, amount);
        }
        return amount;
    }

    function getPendingAmount() external view returns (uint256 amount) {
        amount = requestedAmount;
        return amount;
    }

    /**
     * @notice Figure yield vault redemptions always go through the async flow.
     * @dev Returns true so that the cooldown flow is always used.
     */
    function isCooldownActive() public pure returns (bool) {
        return true;
    }
}
