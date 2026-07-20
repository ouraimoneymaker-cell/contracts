// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    IERC20Metadata
} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUnstakeHandler} from "../../tranches/interfaces/cooldown/IUnstakeHandler.sol";
import {IMToken} from "../../tranches/strategies/midas/interfaces/IMToken.sol";
import { MockRedemptionVault } from "./MockRedemptionVault.sol";

/**
 * @title MidasCooldownRequestImpl
 * @dev Implementation of the unstake process for Midas tokens with cooldown period.
 * This contract is designed to be used within the UnstakeCooldown contract.
 * It handles the cooldown request, finalization, and asset transfer for unstaking Midas tokens.
 *
 * Flow:
 * 1. `request()` - calls `redeemRequest` on the Midas RedemptionVault.
 *    Midas creates a Request struct and holds the mTokens in the vault.
 * 2. Midas admin approves the request off-chain, which transfers the base asset (e.g. USDC)
 *    from the `requestRedeemer` to this proxy contract.
 * 3. `finalize()` - transfers the received base asset to the receiver.
 *
 * Note: For instant redemption (bypassing cooldown), users should redeem Tranche tokens
 * to mToken first, then manually call Midas `redeemInstant` to get the base asset immediately,
 * paying the Midas instant redemption fee.
 */
contract MockMidasCooldownInstantImpl is IUnstakeHandler, Initializable {
    IMToken public immutable mToken;
    IERC20 public immutable baseAsset;
    MockRedemptionVault public immutable redemptionVault;

    uint256 public requestedAt;

    address public handler;
    address public user;
    address public receiver;

    constructor(
        IERC20 baseAsset_,
        IMToken mToken_,
        MockRedemptionVault redemptionVault_
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

        uint256 shares = mToken.balanceOf(address(this));
        require(shares > 0, "NoMTokenToRedeem");

        SafeERC20.forceApprove(
            IERC20(address(mToken)),
            address(redemptionVault),
            shares
        );

        redemptionVault.redeemInstant(
            address(baseAsset),
            shares,
            0
        );
        baseAsset.transfer(
            receiver_,
            baseAsset.balanceOf(address(this))
        );
        return block.timestamp;
    }

    /**
     * @dev Completes the unstake request and transfers assets to the receiver.
     * After Midas admin approves the request, the base asset is transferred
     * from the requestRedeemer to this proxy. This function transfers those assets
     * to the final receiver.
     * Reverts if Midas request is still pending (not yet approved or canceled) —
     * this allows UnstakeCooldown to skip unready requests via try/catch
     * without marking them as completed.
     * Can be called by the UnstakeHandler, which can be triggered permissionlessly.
     */
    function finalize() external returns (uint256 amount) {
        revert("IsInstant");
    }

    function getPendingAmount() external view returns (uint256 amount) {
        return 0;
    }

    /**
     * @notice Midas redemptions go through the cooldown flow.
     * @dev Returns true so that the cooldown flow is always used.
     */
    function isCooldownActive() public pure returns (bool) {
        return true;
    }
}
