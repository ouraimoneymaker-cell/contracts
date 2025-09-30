// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 ____  _             _          ____ ____   ___
/ ___|| |_ _ __ __ _| |_ __ _  / ___|  _ \ / _ \
\___ \| __| '__/ _` | __/ _` || |   | | | | | | |
 ___) | |_| | | (_| | || (_| || |___| |_| | |_| |
|____/ \__|_|  \__,_|\__\__,_| \____|____/ \___/
*/

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { AccessControlled } from "../governance/AccessControlled.sol";
import { IErrors } from "./interfaces/IErrors.sol";
import { ITranche } from "./interfaces/ITranche.sol";
import { IStrategy } from "./interfaces/IStrategy.sol";
import { IStrataCDO } from "./interfaces/IStrataCDO.sol";
import { TActionState } from "./structs/TActionState.sol";
import { IAccounting } from "./interfaces/IAccounting.sol";

/// @notice Core CDO contract that orchestrates Tranches, Accounting, and Strategy
/// @dev Manages deposits, withdrawals, and asset distribution between tranches
contract StrataCDO is IErrors, IStrataCDO, AccessControlled {

    /// @dev Accounting contract for managing asset flows and TVL redistribution
    /// @notice This contract handles the calculation of asset distribution between tranches based on target APRs
    /// @dev It's responsible for updating tranche balances, calculating risk-adjusted returns, and maintaining the reserve
    IAccounting public accounting;

    /// @dev The underlying investment strategy contract for this CDO
    /// @notice This contract implements the specific investment logic, e.g., USDe staking
    /// @dev Responsible for handling deposits, withdrawals, and calculating total assets
    /// @dev Interacts directly with external protocol to generate returns
    IStrategy public strategy;

    /// @notice Junior (BB) Tranche
    ITranche public jrtVault;

    /// @notice Senior (AA) Tranche
    ITranche public srtVault;

    /// @dev Address of the treasury wallet
    /// @dev Used as the recipient when reducing reserves
    /// @dev Can be updated by the RESERVE_MANAGER_ROLE
    address public treasury;

    /// @dev Controls the ability to deposit into or withdraw from the junior tranche
    TActionState public actionsJrt;

    /// @dev Controls the ability to deposit into or withdraw from the senior tranche
    TActionState public actionsSrt;

    /// @dev Configurable minimum JRT price per share, below which the protocol automatically pauses deposits
    uint256 public jrtShortfallPausePrice;

    event DepositsStateChanged(address indexed tranche, bool enabled);
    event WithdrawalsStateChanged(address indexed tranche, bool enabled);
    event ReserveReduced(address token, uint256 amount);
    event TreasurySet(address treasury);
    event ShortfallPaused();
    event JrtShortfallPausePriceSet(uint256 pricePerShare);


    /// @notice Restricts function access to only the junior (JRT) or senior (SRT) tranche contracts
    modifier onlyTranche() {
        if (msg.sender != address(jrtVault) && msg.sender != address(srtVault)) {
            revert InvalidCaller(msg.sender);
        }
        _;
    }

    function initialize(
        address owner_,
        address acm_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);
        jrtShortfallPausePrice = 0.01e18;
    }

    /// @notice Calculates the total assets for a specific tranche
    /// @dev Retrieves the overall TVL from the strategy and determines the asset split
    /// @param tranche The address of the tranche (junior or senior) to return assets for
    /// @return The total assets allocated to the specified tranche
    /// @dev This function:
    ///      1. Gets the total TVL from the strategy
    ///      2. Uses the accounting contract to calculate the asset split
    ///      3. Returns the assets allocated to the specified tranche
    function totalAssets(address tranche) public view returns (uint256) {
        uint256 totalAssetsOverall = strategy.totalAssets();
        (uint256 jrtAssets, uint256 srtAssets, ) = accounting.totalAssets(
            totalAssetsOverall
        );
        if (isJrt(tranche)) {
            return jrtAssets;
        }
        return srtAssets;
    }

    /// @notice Returns the current total assets held in the strategy
    /// @dev This method retrieves the fresh amount of assets directly from the strategy contract
    /// @return uint256 The current total assets in the strategy
    function totalStrategyAssets() public view returns (uint256) {
        return strategy.totalAssets();
    }

    function pricePerShare(address tranche) public view returns (uint256) {
        uint256 assets = totalAssets(tranche);
        uint256 supply = ITranche(tranche).totalSupply();
        return calculatePricePerShare(assets, supply);
    }

    function maxDeposit(address tranche) external view returns (uint256) {
        bool isJrt_ = isJrt(tranche);
        bool isDepositEnabled = isJrt_ ? actionsJrt.isDepositEnabled : actionsSrt.isDepositEnabled;
        if (isDepositEnabled == false) {
            return 0;
        }
        return accounting.maxDeposit(isJrt_);
    }
    function maxWithdraw(address tranche) external view returns (uint256) {
        bool isJrt_ = isJrt(tranche);
        bool isWithdrawEnabled = isJrt_ ? actionsJrt.isWithdrawEnabled : actionsSrt.isWithdrawEnabled;
        if (isWithdrawEnabled == false) {
            return 0;
        }
        return accounting.maxWithdraw(isJrt_);
    }

    function updateAccounting () external onlyTranche {
        uint256 totalAssetsOverall = strategy.totalAssets();
        accounting.updateAccounting(totalAssetsOverall);
    }

    function deposit(address tranche, address token, uint256 tokenAmount, uint256 baseAssets) external onlyTranche nonReentrant {
        bool isJrt_ = isJrt(tranche);
        bool enabled = isJrt_ ? actionsJrt.isDepositEnabled : actionsSrt.isDepositEnabled;
        if (!enabled) {
            revert DepositsDisabled(tranche);
        }
        if (baseAssets > accounting.maxDeposit(isJrt_)) {
            revert DepositCapReached(tranche);
        }
        if (tokenAmount == 0 || baseAssets == 0) {
            revert ZeroAmount();
        }
        strategy.deposit(tranche, token, tokenAmount, baseAssets, /* owner: */ tranche);
        uint256 jrtAssetsIn = isJrt_ ? baseAssets : 0;
        uint256 srtAssetsIn = isJrt_ ? 0          : baseAssets;
        accounting.updateBalanceFlow(jrtAssetsIn, 0, srtAssetsIn, 0);
        shortfallPauser();
    }

    function withdraw(address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address sender, address receiver) external onlyTranche nonReentrant {
        bool isJrt_ = isJrt(tranche);
        bool enabled = isJrt_ ? actionsJrt.isWithdrawEnabled : actionsSrt.isWithdrawEnabled;
        if (!enabled) {
            revert WithdrawalsDisabled(tranche);
        }
        if (baseAssets > accounting.maxWithdraw(isJrt_)) {
            revert WithdrawalCapReached(tranche);
        }
        if (tokenAmount == 0 || baseAssets == 0) {
            revert ZeroAmount();
        }
        strategy.withdraw(tranche, token, tokenAmount, baseAssets, sender, receiver);
        uint256 jrtAssetsOut = isJrt_ ? baseAssets : 0;
        uint256 srtAssetsOut = isJrt_ ? 0          : baseAssets;
        accounting.updateBalanceFlow(0, jrtAssetsOut, 0, srtAssetsOut);
        shortfallPauser();
    }

    /// @notice Determines if the given address is the Junior (BB) Tranche
    /// @dev Used to differentiate between Junior and Senior Tranches
    /// @param tranche The address to check
    /// @return bool True if the address is the Junior Tranche, false if it's the Senior Tranche
    /// @dev Reverts with InvalidTranche error if the address is neither Junior nor Senior Tranche
    function isJrt (address tranche) public view returns (bool) {
        if (tranche == address(jrtVault)) {
            return true;
        }
        if (tranche == address(srtVault)) {
            return false;
        }
        revert InvalidTranche(tranche);
    }

    /// @notice Configures the CDO with its components
    /// @dev Can only be called once by the owner after components deployment
    function configure (
        IAccounting accounting_,
        IStrategy strategy_,
        ITranche jrtVault_,
        ITranche srtVault_
    ) external onlyOwner {
        if (address(accounting) != address(0)) {
            revert AlreadyConfigured();
        }
        require(address(this) == accounting_.getCDOAddress(), "A1");
        require(address(this) ==   strategy_.getCDOAddress(), "A2");
        require(address(this) ==   jrtVault_.getCDOAddress(), "A3");
        require(address(this) ==   srtVault_.getCDOAddress(), "A4");

        accounting = accounting_;
        strategy = strategy_;
        jrtVault = jrtVault_;
        srtVault = srtVault_;

        jrtVault_.configure();
        srtVault_.configure();
    }

    /// @notice Reduces the reserve and transfers tokens to the treasury
    /// @dev Only callable by RESERVE_MANAGER_ROLE
    function reduceReserve (address token, uint256 tokenAmount) external onlyRole(RESERVE_MANAGER_ROLE) {
        if (treasury == address(0)) {
            revert ZeroAddress();
        }
        // Reverts if the token is not supported
        uint256 baseAssets = strategy.convertToAssets(token, tokenAmount, Math.Rounding.Floor);
        // Reverts if not enough reserve
        accounting.reduceReserve(baseAssets);
        // Transfers tokens out instantly if possible, or through the cooldown process
        strategy.reduceReserve(token, tokenAmount, treasury);
        emit ReserveReduced(token, tokenAmount);
    }

    /// @notice Sets the address of the reserve treasury
    function setReserveTreasury (address treasury_) external onlyRole(RESERVE_MANAGER_ROLE) {
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Sets action states for the tranche; zero address affects both tranches
    function setActionStates (address tranche, bool isDepositEnabled, bool isWithdrawEnabled) external onlyRole(PAUSER_ROLE) {
        if (address(tranche) == address(0)) {
            setActionStatesInner(address(jrtVault), isDepositEnabled, isWithdrawEnabled);
            setActionStatesInner(address(srtVault), isDepositEnabled, isWithdrawEnabled);
            return;
        }
        setActionStatesInner(tranche, isDepositEnabled, isWithdrawEnabled);
    }

    /// @notice Internal function to set deposit and withdrawal states for a tranche
    function setActionStatesInner (address tranche, bool isDepositEnabled, bool isWithdrawEnabled) internal {
        TActionState storage state = isJrt(tranche)? actionsJrt : actionsSrt;
        if (state.isDepositEnabled != isDepositEnabled) {
            state.isDepositEnabled = isDepositEnabled;
            emit DepositsStateChanged(tranche, isDepositEnabled);
        }
        if (state.isWithdrawEnabled != isWithdrawEnabled) {
            state.isWithdrawEnabled = isWithdrawEnabled;
            emit WithdrawalsStateChanged(tranche, isWithdrawEnabled);
        }
    }

    /// @notice Sets the JRT shortfall price to automatically pause the deposits, when the price falls below this price
    function setJrtShortfallPausePrice (uint256 jrtShortfallPausePrice_) external onlyRole(PAUSER_ROLE) {
        // If the shortfall pause price is above current price, deposits must be paused manually by the Pauser
        require(jrtShortfallPausePrice_ <= pricePerShare(address(jrtVault)), "ShortfallPriceTooLarge");
        jrtShortfallPausePrice = jrtShortfallPausePrice_;
        emit JrtShortfallPausePriceSet(jrtShortfallPausePrice_);
    }

    function shortfallPauser () internal {
        (uint256 jrtNav,,) = accounting.totalAssetsT0();
        uint256 jrtPrice = calculatePricePerShare(jrtNav, jrtVault.totalSupply());
        if (jrtPrice <= jrtShortfallPausePrice) {
            actionsJrt.isDepositEnabled = false;
            actionsSrt.isDepositEnabled = false;
            emit DepositsStateChanged(address(jrtVault), false);
            emit DepositsStateChanged(address(srtVault), false);
            emit ShortfallPaused();
        }
    }

    function calculatePricePerShare (uint256 assets, uint256 supply) internal pure returns (uint256) {
        return supply == 0
            ? 1e18
            : Math.mulDiv(assets, 1e18, supply, Math.Rounding.Floor);
    }
}
