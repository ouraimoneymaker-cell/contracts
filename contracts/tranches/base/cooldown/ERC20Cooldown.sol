// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Cooldown } from "../../interfaces/cooldown/IERC20Cooldown.sol";

/**
 * @title Strata Cooldown Vault for generic IERC20 tokens
 * @notice The Silo allows to store USDe during the cooldown process.
 */
contract ERC20Cooldown is IERC20Cooldown {

    event Requested(address indexed user, uint256 amount, uint256 unlockAt);
    event Claimed(address indexed user, uint256 amount);

    error InvalidTime ();
    error NothingToFinalize ();

    struct TRequest {
        uint64 unlockAt;
        uint192 amount;
    }

    mapping(address token => mapping(address account => TRequest[] requests)) public cooldowns;


    function transfer(IERC20 token, address to, uint256 amount, uint256 cooldownSeconds) external {
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

        emit Requested(to, amount, unlockAt);
    }

    function finalize(IERC20 token, address user) external returns (uint256 claimed) {
        return finalize(token, user, block.timestamp);
    }
    function finalize(IERC20 token, address user, uint256 at) public returns (uint256 claimed) {
        if (at > block.timestamp) {
            revert InvalidTime();
        }
        TRequest[] storage requests = cooldowns[address(token)][user];

        uint256 len = requests.length;
        for (uint256 i; i < len; ) {
            TRequest memory req = requests[i];
            if (req.unlockAt > at) {
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
            emit Claimed(user, claimed);
        } else {
            revert NothingToFinalize();
        }
        return claimed;
    }

    function balanceOf (IERC20 token, address user) external view returns (uint256) {
        return balanceOf(token, user, block.timestamp);
    }

    function balanceOf (IERC20 token, address user, uint256 at) public view returns (uint256) {
        TRequest[] storage requests = cooldowns[address(token)][user];
        uint256 l = requests.length;
        uint256 balance = 0;
        for (uint256 i = 0; i < l; i++) {
            TRequest memory req = requests[i];
            if (req.unlockAt <= at) {
                balance += req.amount;
            }
        }
        return balance;
    }
}
