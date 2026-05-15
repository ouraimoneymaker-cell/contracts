// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title MockHastraNavEngine  
 * @notice On-chain NAV calculation engine that Chainlink DON reads from
 * @dev ✅ Conforms to Chainlink Schema v7 (Redemption Rates) - returns int192 exchange rate
 */
contract MockHastraNavEngine is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    
    struct NavEngineStorage {
        address updater;
        uint256 maxDifferencePercent;
        int192 minRate;    // Schema v7 int192
        int192 maxRate;    // Schema v7 int192
        uint256 latestUpdateTime;
        uint256 latestTotalSupply;
        uint256 latestTVL;
        int192 latestRate; // Schema v7 int192
    }

    // ERC-7201: keccak256(abi.encode(uint256(keccak256("hastra.storage.NavEngine")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NAV_ENGINE_STORAGE_SLOT =
        0x993f277ac229bbe15da412d652fbea5e3a685c7d321444df0ee913d0c6efbc00;

    uint256 public constant RATE_PRECISION = 1e18;

    error TVLIsZero();
    error TVLDifferenceExceeded(uint256 previousTVL, uint256 newTVL, uint256 difference, uint256 maxAllowed);
    error RateOutOfBounds(int192 rate, int192 minRate, int192 maxRate);
    error TotalSupplyIsZero();
    error RateOverflow(uint256 calculatedRate);
    error InvalidUpdater();
    error InvalidRate();
    error InvalidMaxDifferencePercent();
    event UpdaterSet(address indexed updater);
    event MinRateSet(int192 minRate);
    event MaxRateSet(int192 maxRate);
    event MaxDifferencePercentSet(uint256 maxDifferencePercent);
    event RateUpdated(int192 indexed rate, uint256 totalSupply, uint256 totalTVL, uint256 indexed timestamp);

    modifier onlyUpdater() {
        require(msg.sender == _getStorage().updater, "Not updater");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address updater_,
        uint256 maxDifferencePercent_,
        int192 minRate_,
        int192 maxRate_,
        uint256 initialTotalSupply_, 
        uint256 initialTotalTVL_

    ) public initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        _setUpdater(updater_);
        _setMaxDifferencePercent(maxDifferencePercent_);
        _setMinRate(minRate_);
        _setMaxRate(maxRate_);

        updateRate(initialTotalSupply_, initialTotalTVL_); //initial rate setup
    }

    /**
     * @notice Updates the NAV exchange rate based on vault state
     * @dev Can only be called by the updater role when not paused.
     *      Calculates rate as: (totalTVL * 1e18) / totalSupply
     *      Rate represents wYLDS per pToken (equivalent to USDC per pToken due to 1:1 ratio)
     * @param totalSupply_ Total pTokens (Prime tokens) issued by the vault
     * @param totalTVL_ Total wYLDS backing by vault
     * @return The calculated exchange rate as int192, scaled by 1e18 (e.g., 1.5e18 = 1.5 wYLDS per pToken)
     */
    // totalSupply = Total pTokens (Prime tokens) issued
    // totalAssets = Total wYLDS held = Total USDC value (since 1:1)
    function updateRate(uint256 totalSupply_, uint256 totalTVL_) public whenNotPaused returns (int192) {
        if (totalSupply_ == 0) revert TotalSupplyIsZero();
        NavEngineStorage storage $ = _getStorage();

        if (totalTVL_ == 0) {
            revert TVLIsZero();
        }

        if ($.latestUpdateTime != 0) {
            uint256 oldTVL = $.latestTVL;
            uint256 absDiff = totalTVL_ > oldTVL ? totalTVL_ - oldTVL : oldTVL - totalTVL_;
            uint256 difference = Math.mulDiv(absDiff, RATE_PRECISION, oldTVL);
            if (difference > $.maxDifferencePercent) {
                revert TVLDifferenceExceeded($.latestTVL, totalTVL_, difference, $.maxDifferencePercent);
            }
        }

        uint256 calculatedRate = Math.mulDiv(totalTVL_, RATE_PRECISION, totalSupply_);
        if (calculatedRate > uint256(uint192(type(int192).max))) revert RateOverflow(calculatedRate);
        int192 newRate = int192(int256(calculatedRate));

        if (newRate < $.minRate || newRate > $.maxRate) {
            revert RateOutOfBounds(newRate, $.minRate, $.maxRate);
        }

        $.latestTVL = totalTVL_;
        $.latestTotalSupply = totalSupply_;
        $.latestUpdateTime = block.timestamp;
        $.latestRate = newRate;

        emit RateUpdated(newRate, totalSupply_, totalTVL_, block.timestamp);
        return newRate;
    }

    function getRate() external view returns (int192) {
        return _getStorage().latestRate;
    }

    function getUpdater() external view returns (address) { return _getStorage().updater; }
    function getMaxDifferencePercent() external view returns (uint256) { return _getStorage().maxDifferencePercent; }
    function getMinRate() external view returns (int192) { return _getStorage().minRate; }
    function getMaxRate() external view returns (int192) { return _getStorage().maxRate; }
    function getLatestTotalSupply() external view returns (uint256) { return _getStorage().latestTotalSupply; }
    function getLatestTVL() external view returns (uint256) { return _getStorage().latestTVL; }
    function getLatestUpdateTime() external view returns (uint256) { return _getStorage().latestUpdateTime; }

    function setUpdater(address updater_) external onlyOwner { _setUpdater(updater_); }
    function setMaxDifferencePercent(uint256 maxDifferencePercent_) external onlyOwner { _setMaxDifferencePercent(maxDifferencePercent_); }
    function setMinRate(int192 minRate_) external onlyOwner { _setMinRate(minRate_); }
    function setMaxRate(int192 maxRate_) external onlyOwner { _setMaxRate(maxRate_); }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _getStorage() private pure returns (NavEngineStorage storage $) {
        assembly { $.slot := NAV_ENGINE_STORAGE_SLOT }
    }

    function _setUpdater(address updater_) internal {
        if (updater_ == address(0)) revert InvalidUpdater();
        _getStorage().updater = updater_;
        emit UpdaterSet(updater_);
    }

    function _setMinRate(int192 minRate_) internal {
        if (minRate_ <= 0) revert InvalidRate();
        NavEngineStorage storage $ = _getStorage();
        if ($.maxRate != 0 && minRate_ > $.maxRate) revert InvalidRate();
        $.minRate = minRate_;
        emit MinRateSet(minRate_);
    }

    function _setMaxRate(int192 maxRate_) internal {
        if (maxRate_ <= 0) revert InvalidRate();
        NavEngineStorage storage $ = _getStorage();
        if ($.minRate != 0 && maxRate_ < $.minRate) revert InvalidRate();
        $.maxRate = maxRate_;
        emit MaxRateSet(maxRate_);
    }

    function _setMaxDifferencePercent(uint256 maxDifferencePercent_) internal {
        if (maxDifferencePercent_ == 0 || maxDifferencePercent_ > RATE_PRECISION) revert InvalidMaxDifferencePercent();
        _getStorage().maxDifferencePercent = maxDifferencePercent_;
        emit MaxDifferencePercentSet(maxDifferencePercent_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}