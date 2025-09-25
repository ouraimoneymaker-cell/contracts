// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ICooldown, IERC20Cooldown } from "../../interfaces/cooldown/ICooldown.sol";
import { AccessControlled } from "../../../governance/AccessControlled.sol";
/**
 * @title Strata Cooldown Vault for generic IERC20 tokens
 * @notice The Silo allows to store USDe during the cooldown process.
 */
contract ERC20Cooldown is IERC20Cooldown, AccessControlled {

    event Requested(IERC20 indexed token, address indexed user, uint256 amount, uint256 unlockAt);
    event Claimed(IERC20 indexed token, address indexed user, uint256 amount);

    error InvalidTime ();
    error NothingToFinalize ();

    struct TRequest {
        uint64 unlockAt;
        uint192 amount;
    }

    mapping(address token => mapping(address account => TRequest[] requests)) public cooldowns;
    mapping(address token => bool isCooldownDisabled) public cooldownDisabled;

    function initialize(
        address owner_,
        address acm_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);
    }

    function transfer(IERC20 token, address to, uint256 amount, uint256 cooldownSeconds) external onlyRole(COOLDOWN_WORKER_ROLE) {
        address from = msg.sender;
        if (amount == 0) {
            return;
        }
        if (cooldownSeconds == 0) {
            SafeERC20.safeTransferFrom(token, from, to, amount);
            return;
        }
        SafeERC20.safeTransferFrom(token, from, address(this), amount);

        uint256 unlockAt = block.timestamp + cooldownSeconds;
        cooldowns[address(token)][to].push(TRequest(uint64(unlockAt), uint192(amount)));

        emit Requested(token, to, amount, unlockAt);
    }

    function finalize(IERC20 token, address user) external returns (uint256 claimed) {
        return finalize(token, user, block.timestamp);
    }
    function finalize(IERC20 token, address user, uint256 at) public returns (uint256 claimed) {
        if (at > block.timestamp) {
            revert InvalidTime();
        }
        TRequest[] storage requests = cooldowns[address(token)][user];
        bool isCooldownActive = cooldownDisabled[address(token)] == false;

        uint256 len = requests.length;
        for (uint256 i; i < len;) {
            TRequest memory req = requests[i];
            if (req.unlockAt > at && isCooldownActive) {
                // still pending
                unchecked { i++; }
                continue;
            }
            claimed += req.amount;

            if (i < len - 1) {
                requests[i] = requests[len - 1];
            }
            requests.pop();
            unchecked { len--; }
        }
        if (claimed > 0) {
            SafeERC20.safeTransfer(token, user, claimed);
            emit Claimed(token, user, claimed);
        } else {
            revert NothingToFinalize();
        }
        return claimed;
    }

    function balanceOf (IERC20 token, address user) external view returns (ICooldown.TBalanceState memory) {
        return balanceOf(token, user, block.timestamp);
    }

    function balanceOf (IERC20 token, address user, uint256 at) public view returns (ICooldown.TBalanceState memory) {
        TRequest[] storage requests = cooldowns[address(token)][user];
        bool isCooldownActive = cooldownDisabled[address(token)] == false;

        uint256 l = requests.length;
        uint256 pending;
        uint256 claimable;
        uint256 nextUnlockAt;
        uint256 nextUnlockAmount;

        for (uint256 i; i < l; i++) {
            TRequest memory req = requests[i];
            if (req.unlockAt > at && isCooldownActive) {
                pending += req.amount;
                if (nextUnlockAt == 0 || req.unlockAt < nextUnlockAt) {
                    nextUnlockAt = req.unlockAt;
                    nextUnlockAmount = req.amount;
                    continue;
                }
                if (req.unlockAt == nextUnlockAt) {
                    nextUnlockAmount += req.amount;
                }
                continue;
            }
            claimable += req.amount;
        }
        return TBalanceState({
            pending: pending,
            claimable: claimable,
            nextUnlockAt: nextUnlockAt,
            nextUnlockAmount: nextUnlockAmount
        });
    }

    /**
    * @notice Toggles cooldown for a token, allowing immediate withdrawals in emergencies
    * @dev For emergency exits, cooldown worker (Strategy) can disable cooldowns
    * @param token The ERC20 token to set cooldown state
    * @param isCooldownDisabled True to disable cooldown, false to enable (default behavior)
    */
    function setCooldownDisabled(IERC20 token, bool isCooldownDisabled) external onlyRole(COOLDOWN_WORKER_ROLE) {
        cooldownDisabled[address(token)] = isCooldownDisabled;
    }

}
