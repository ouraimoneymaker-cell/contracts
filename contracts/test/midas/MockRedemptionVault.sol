// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MockMToken} from "./MockMToken.sol";
import {MockBaseAsset} from "./MockBaseAsset.sol";
import {MockOracle} from "./MockOracle.sol";
import {
    Request,
    RequestStatus
} from "../../tranches/strategies/midas/interfaces/IRedemptionVault.sol";

/**
 * @title MockRedemptionVault
 * @dev Mock Midas RedemptionVault that accepts redeemInstant and redeemRequest
 */
contract MockRedemptionVault {
    MockMToken public mToken;
    MockBaseAsset public baseAsset;

    uint256 public nextRequestId;
    mapping(uint256 => Request) public _requests;

    /// @dev Controls whether redeemInstant succeeds or reverts
    bool public instantEnabled;

    /// @dev Mock rate: 1.05e18 (mToken price in base18)
    uint256 public mTokenRate = 1_050000000000000000;
    /// @dev Mock rate: 1e18 (stablecoin = $1)
    uint256 public tokenOutRate = 1_000000000000000000;

    MockOracle public oracle;

    constructor(MockMToken _mToken, MockBaseAsset _baseAsset) {
        mToken = _mToken;
        baseAsset = _baseAsset;
        instantEnabled = false;
    }

    function setInstantEnabled(bool _enabled) external {
        instantEnabled = _enabled;
    }

    function setRates(uint256 _mTokenRate, uint256 _tokenOutRate) external {
        mTokenRate = _mTokenRate;
        tokenOutRate = _tokenOutRate;
    }

    function setOracle(MockOracle oracle_) external {
        oracle = oracle_;
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
        uint256 baseAssetAmount = amountMTokenIn * getMTokenRate() / 10**(36 - IERC20Metadata(baseAsset).decimals());
        baseAsset.mint(msg.sender, baseAssetAmount); // simple 18→6 decimal conversion
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
        _requests[requestId] = Request(
            msg.sender,
            tokenOut,
            RequestStatus.Pending,
            amountMTokenIn,
            getMTokenRate(),
            tokenOutRate
        );
        return requestId;
    }

    function redeemRequests(
        uint256 requestId
    ) external view returns (Request memory) {
        return _requests[requestId];
    }

    // Admin function to fulfill a redeem request — sends baseAsset to the original sender (proxy)
    function fulfillRequest(
        uint256 requestId
    ) external {
        Request storage req = _requests[requestId];
        require(req.status == RequestStatus.Pending, "Not pending");
        req.status = RequestStatus.Processed;

        uint256 baseAssetAmount = req.amountMToken * req.mTokenRate / 10**(36 - IERC20Metadata(baseAsset).decimals());

        // Mint baseAsset and send to the original sender (the proxy contract)
        baseAsset.mint(req.sender, baseAssetAmount);
    }

    function getMTokenRate () internal view returns (uint256) {
        if (address(oracle) != address(0)) {
            (, int256 rate, , , ) = oracle.latestRoundData();
            return uint256(rate) * 1e10;
        }
        return mTokenRate;
    }
}
