// SPDX-License-Identifier: MIT
//Source code: https://github.com/provenance-io/hastra-eth-vault/blob/main/contracts/chainlink/HastraNavEngine.sol
pragma solidity ^0.8.28;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title HastraNavEngine
 * @notice On-chain NAV calculation engine that Chainlink DON reads from
 * @dev ✅ Conforms to Chainlink Schema v7 (Redemption Rates) - returns int192 exchange rate
 */
contract MockFeedVerifier {

    uint256[302] private _gap;

    /// @notice Latest verified price per feedId (1e18 scaled int192).
    mapping(bytes32 => int192) public priceByFeed;

    /// @notice Latest observation timestamp per feedId.
    mapping(bytes32 => uint32) public timestampByFeed;

    int192 public price;
    uint32 public defaultMaxStaleness;

    constructor(int192 _price) {
        price = _price;
        defaultMaxStaleness = 3600;
    }

    function priceOf(bytes32 /*feedId*/) external view returns (int192) {
        return price;
    }

    function setMaxStaleness(uint32 maxStaleness_) external {
        defaultMaxStaleness = maxStaleness_;
    }

}
