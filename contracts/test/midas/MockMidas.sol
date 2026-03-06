// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    IRoundDataOracle
} from "../../tranches/strategies/midas/AaveOracleAprPairProvider.sol";
import {
    IDepositVault
} from "../../tranches/strategies/midas/interfaces/IDepositVault.sol";
import {
    IRedemptionVault
} from "../../tranches/strategies/midas/interfaces/IRedemptionVault.sol";

/**
 * @title MockMToken
 * @dev Simple ERC20 mock for mHYPER in tests
 */
contract MockMToken is ERC20 {
    constructor() ERC20("Mock mHYPER", "mHYPER") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/**
 * @title MockBaseAsset
 * @dev Simple ERC20 mock for USDC in tests
 */
contract MockBaseAsset is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/**
 * @title MockOracle
 * @dev Chainlink-style mock oracle with setable round data
 */
contract MockOracle is IRoundDataOracle {
    struct RoundData {
        uint80 roundId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    mapping(uint80 => RoundData) public rounds;
    uint80 public latestRound;

    function setRoundData(
        uint80 roundId,
        int256 answer,
        uint256 updatedAt
    ) external {
        rounds[roundId] = RoundData(
            roundId,
            answer,
            updatedAt,
            updatedAt,
            roundId
        );
        if (roundId > latestRound) {
            latestRound = roundId;
        }
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        RoundData memory rd = rounds[latestRound];
        return (
            rd.roundId,
            rd.answer,
            rd.startedAt,
            rd.updatedAt,
            rd.answeredInRound
        );
    }

    function getRoundData(
        uint80 _roundId
    )
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        RoundData memory rd = rounds[_roundId];
        return (
            rd.roundId,
            rd.answer,
            rd.startedAt,
            rd.updatedAt,
            rd.answeredInRound
        );
    }
}

/**
 * @title MockDepositVault
 * @dev Mock Midas DepositVault that mints mToken on depositInstant
 */
contract MockDepositVault {
    MockMToken public mToken;

    // Exchange rate: how many mToken per unit of tokenIn (scaled 1e18)
    uint256 public rate;

    constructor(MockMToken _mToken) {
        mToken = _mToken;
        rate = 1e18; // 1:1 by default
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function depositInstant(
        address tokenIn,
        uint256 amountToken,
        uint256 /* minReceiveAmount */,
        bytes32 /* referrerId */
    ) external {
        // Transfer tokenIn from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountToken);
        // Mint mToken to caller based on rate
        uint256 mTokenAmount = (amountToken * 1e18) / rate;
        mToken.mint(msg.sender, mTokenAmount);
    }
}

/**
 * @title MockRedemptionVault
 * @dev Mock Midas RedemptionVault that accepts redeemRequest and allows admin to fulfill
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

    constructor(MockMToken _mToken, MockBaseAsset _baseAsset) {
        mToken = _mToken;
        baseAsset = _baseAsset;
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
