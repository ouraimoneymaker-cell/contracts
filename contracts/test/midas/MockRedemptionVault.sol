// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockMToken} from "./MockMToken.sol";
import {MockBaseAsset} from "./MockBaseAsset.sol";

/**
 * @title MockRedemptionVault
 * @dev Mock Midas RedemptionVault that accepts redeemInstant and redeemRequest
 */
contract MockRedemptionVault {
    MockMToken public mToken;
    MockBaseAsset public baseAsset;

    struct RedeemRequest {
        address sender;
        address tokenOut;
        uint256 amountMToken;
        bool processed;
    }

    uint256 public nextRequestId;
    mapping(uint256 => RedeemRequest) public requests;

    /// @dev Controls whether redeemInstant succeeds or reverts
    bool public instantEnabled;

    constructor(MockMToken _mToken, MockBaseAsset _baseAsset) {
        mToken = _mToken;
        baseAsset = _baseAsset;
        instantEnabled = false;
    }

    function setInstantEnabled(bool _enabled) external {
        instantEnabled = _enabled;
    }

    function redeemInstant(
        address tokenOut,
        uint256 amountMTokenIn,
        uint256 /* minReceiveAmount */
    ) external {
        require(instantEnabled, "Instant redemption disabled");

        // Transfer mToken from caller and burn
        IERC20(address(mToken)).transferFrom(
            msg.sender,
            address(this),
            amountMTokenIn
        );
        mToken.burn(address(this), amountMTokenIn);

        // Mint baseAsset directly to the caller (simulates instant redemption)
        baseAsset.mint(msg.sender, amountMTokenIn / 1e12); // simple 18→6 decimal conversion
    }

    function redeemRequest(
        address tokenOut,
        uint256 amountMTokenIn
    ) external returns (uint256) {
        // Transfer mToken from caller
        IERC20(address(mToken)).transferFrom(
            msg.sender,
            address(this),
            amountMTokenIn
        );

        uint256 requestId = nextRequestId++;
        requests[requestId] = RedeemRequest(
            msg.sender,
            tokenOut,
            amountMTokenIn,
            false
        );
        return requestId;
    }

    // Admin function to fulfill a redeem request — sends baseAsset to the original sender (proxy)
    function fulfillRequest(
        uint256 requestId,
        uint256 baseAssetAmount
    ) external {
        RedeemRequest storage req = requests[requestId];
        require(!req.processed, "Already processed");
        req.processed = true;

        // Mint baseAsset and send to the original sender (the proxy contract)
        baseAsset.mint(req.sender, baseAssetAmount);
    }
}
