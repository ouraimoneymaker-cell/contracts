// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IUnstakeHandler } from "../../interfaces/cooldown/IUnstakeHandler.sol";
import { IMToken } from "./interfaces/IMToken.sol";
import { IRedemptionVault } from "./interfaces/IRedemptionVault.sol";

/**
 * @title MidasCooldownRequestImpl
 * @dev Implementation of the unstake process for Midas tokens with cooldown period.
 * This contract is designed to be used within the UnstakeCooldown contract.
 * It handles the cooldown request, finalization, and asset transfer for unstaking Midas tokens.
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

    bool    public pending;

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

    function initialize(address handler_, address user_) public virtual initializer {
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

        if (isCooldownActive() == false) {
            // @TODO redeemInstant
            return block.timestamp;
        }
        // @TODO redeemRequest

        requestedAt = block.timestamp;
        receiver = receiver_;
        pending = true;

        // @TODO save the amount to be expected
        requestedAmount = 0;

        // @TODO What is the cooldown END
        return block.timestamp + 3 days;
    }

    /**
     * @dev Completes the unstake request and transfers assets to the receiver.
     * Can be called by the UnstakeHandler, which can be triggered permissionlessly.
     */
    function finalize() external returns (uint256 amount)  {
        require(msg.sender == handler, "NotAuthorized");
        amount = requestedAmount;

        // @TODO Check the airdroped assets and transfer them to the receiver

        pending = false;
        return amount;
    }

    function getPendingAmount () external view returns (uint256 amount) {
        amount = requestedAmount;
        return amount;
    }

    function isCooldownActive() public view returns (bool) {
        // @TODO Determine if the instantRedeem is possible, might require additional parameters
        return false;
    }
}
