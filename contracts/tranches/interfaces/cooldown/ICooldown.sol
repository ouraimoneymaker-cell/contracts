// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICooldown {
     struct TBalanceState {
        uint256 pending;
        uint256 claimable;
        uint256 nextUnlockAt;
        uint256 nextUnlockAmount;
    }

    function finalize(IERC20 token, address user) external returns (uint256 claimed);
    function finalize(IERC20 token, address user, uint256 at) external returns (uint256 claimed);

    function balanceOf (IERC20 token, address user) external view returns (TBalanceState memory);
    function balanceOf (IERC20 token, address user, uint256 at) external view returns (TBalanceState memory);
}


interface IERC20Cooldown is ICooldown {
    function transfer(IERC20 token, address to, uint256 amount, uint256 cooldownSeconds) external;
}

interface IUnstakeCooldown is ICooldown {
    function transfer(IERC20 token, address to, uint256 amount) external;
}
