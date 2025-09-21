// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IsUSDe } from "./IsUSDe.sol";
import { IUnstakeHandler } from "../../interfaces/cooldown/IUnstakeHandler.sol";

contract sUSDeCooldownRequestImpl is IUnstakeHandler, Initializable {

    IsUSDe public immutable sUSDe;

    address public user;
    address public receiver;

    error HasActiveRequest();

    constructor(IsUSDe sUSDe_) {
        _disableInitializers();

        sUSDe = sUSDe_;
    }

    function initialize(address user_) public virtual initializer {
        user = user_;
    }

    function request() external returns (uint256 unlockAt) {
        return request(user);
    }
    function request(address receiver_) public returns (uint256 unlockAt) {
        uint256 currentEnd = sUSDe.cooldowns(address(this)).cooldownEnd;
        if (currentEnd > block.timestamp) {
            revert HasActiveRequest();
        }
        receiver = receiver_;
        uint256 shares = sUSDe.balanceOf(address(this));
        sUSDe.cooldownShares(shares);
        return sUSDe.cooldowns(address(this)).cooldownEnd;
    }

    function finalize() external returns (uint256 amount)  {
        amount = sUSDe.cooldowns(address(this)).underlyingAmount;
        sUSDe.unstake(receiver);
        return amount;
    }

    function getPending () external view returns (uint256 amount) {
        amount = sUSDe.cooldowns(address(this)).underlyingAmount;
        return amount;
    }
}
