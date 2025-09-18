// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { UD60x18Ext } from "./utils/UD60x18Ext.sol";
import { MathExt } from "./utils/MathExt.sol";
import { UD60x18, pow, mul } from "@prb/math/src/ud60x18/Math.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { IAccounting } from "./interfaces/IAccounting.sol";
import { IStrataCDO } from "./interfaces/IStrataCDO.sol";
import { IAprTupleFeed } from "./interfaces/IAprFeed.sol";
import { CDOComponent } from "./base/CDOComponent.sol";
import "hardhat/console.sol";

/**
 * @title CDO::Accounting
 * @dev Pure math contract to track the in-flow and out-flow of assets and balance the gain/loss between Junior (Jrt) and Senior (Srt) Tranche Value Locked (TVL).
 */
contract Accounting is IAccounting, CDOComponent {

    uint256 constant SECONDS_PER_YEAR = 31_536_000;

    int64 private constant APR_BOUNDARY_MAX = 200 * 1e12;
    int64 private constant APR_BOUNDARY_MIN = 0;

    /// @dev The oracle to fetch the latest APR floor and APR base.
    /// @notice When the oracle is updated, it can actively push the latest values to this contract, allowing us to adjust srtTargetIndex.
    IAprTupleFeed public aprsFeed;

    /// @dev External floor target APR for Srt
    UD60x18 public aprTarget;

    /// @dev External APR for the underlying protocol
    UD60x18 public aprBase;

    /// @dev The calculated target APR for Srt; the primary objective in calculations.
    UD60x18 public aprSrt;

    uint256 public indexTimestamp;
    uint256 public srtTargetIndex;


    uint256 public reserveBps;
    uint256 constant PERCENTAGE_100 = 1e18;
    uint256 constant RESERVE_BPS_MAX = 0.02e18;

    /// @dev Latest balances at T0 (latest protocol interrogation)
    uint256 public nav;
    uint256 public jrtNav;
    uint256 public srtNav;
    uint256 public reserveNav;

    /// @dev Risk parameters for Risk Premium calculation.
    /// @notice See `calculateRiskPremium()` for usage details.
    UD60x18 public riskX;
    UD60x18 public riskY;
    UD60x18 public riskK;

    error InvalidNavSpit(uint256 navT1, uint256 jrtAssets, uint256 srtAssets, uint256 reserveAssets);

    event AprsPushed(uint256 aprTarget, uint256 aprBase);
    event AprsFeedChanged(address aprsFeed);
    event ReservePercentageChanged(uint256 reserveBps);

    function initialize(
        address owner_,
        address acm_,
        IStrataCDO cdo_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);
        cdo = cdo_;

        riskX = UD60x18.wrap(0.2e18);
        riskY = UD60x18.wrap(0.2e18);
        riskK = UD60x18.wrap(0.3e18);

        srtTargetIndex = 1e18;
        indexTimestamp = block.timestamp;
    }

    /// @notice Returns the current total assets for each tranche and the reserve
    /// @dev This method is used by the Tranches to get their updated total assets for the current block
    /// @param navT1 The current total Net Asset Value
    /// @return jrtNavT1 The updated Junior Tranche TVL
    /// @return srtNavT1 The updated Senior Tranche TVL
    /// @return reserveNavT1 The updated Reserve TVL
    function totalAssets (uint256 navT1) public view returns (uint256 jrtNavT1, uint256 srtNavT1, uint256 reserveNavT1) {
        (
            jrtNavT1,
            srtNavT1,
            reserveNavT1
        ) = calculateNAVSplit(nav, jrtNav, srtNav, reserveNav, navT1);
        return (jrtNavT1, srtNavT1, reserveNavT1);
    }

    /// @notice Returns the latest saved reserve value without recalculating the current TVL split
    /// @dev This method returns the maximum amount that `reduceReserve` can handle
    /// @dev It returns the latest reserve value without affecting Srt/Jrt TVLs
    /// @return The current reserve Net Asset Value (NAV)
    function totalReserveT0 () external view returns (uint256) {
        return reserveNav;
    }

    /// @notice Reduces the reserve by the specified amount
    /// @dev This function is called by the CDO contract to reduce the reserve
    /// @dev The CDO contract is responsible for withdrawing the appropriate amount to the treasury
    /// @param amount The amount by which to reduce the reserve NAV
    function reduceReserve (uint256 amount) external onlyCDO {
        require(amount <= reserveNav, "NOT_ENOUGH_RESERVE");
        reserveNav = reserveNav - amount;
        nav = nav - amount;
    }

    /// @notice Updates the accounting for the CDO, calculating new TVL split
    /// @dev This method should be called before any deposits or withdrawals in tranches
    /// @dev It calculates the new TVL split, allowing tranches to accurately calculate their share prices
    /// @param navT1 The current total assets (Net Asset Value) held by the CDO in the strategy
    function updateAccounting (
        uint256 navT1
    ) external onlyCDO {
        (
            uint256 jrtNavT1,
            uint256 srtNavT1,
            uint256 reserveNavT1
        ) = calculateNAVSplit(nav, jrtNav, srtNav, reserveNav, navT1);

        updateIndexes(aprTarget, aprBase);
        nav = navT1;
        jrtNav = jrtNavT1;
        srtNav = srtNavT1;
        reserveNav = reserveNavT1;
    }

    /// @notice Updates the Net Asset Values (NAVs) after deposits or withdrawals
    /// @dev This method should be called after any deposits or withdrawals are made in the tranches
    /// @dev It adjusts the NAVs for both Junior and Senior tranches, as well as the total NAV
    /// @param jrtAssetsIn Amount of assets deposited into the Junior tranche
    /// @param jrtAssetsOut Amount of assets withdrawn from the Junior tranche
    /// @param srtAssetsIn Amount of assets deposited into the Senior tranche
    /// @param srtAssetsOut Amount of assets withdrawn from the Senior tranche
    function updateBalanceFlow (
        uint256 jrtAssetsIn,
        uint256 jrtAssetsOut,
        uint256 srtAssetsIn,
        uint256 srtAssetsOut
    ) external onlyCDO {
        jrtNav = jrtNav + jrtAssetsIn - jrtAssetsOut;
        srtNav = srtNav + srtAssetsIn - srtAssetsOut;
        nav = nav + jrtAssetsIn + srtAssetsIn - jrtAssetsOut - srtAssetsOut;
    }

    /// @notice Calculates the updated Net Asset Values (NAVs) for Junior, Senior tranches, and Reserve
    /// @dev This function performs the following operations:
    /// 1. Calculates and distributes gains or losses across tranches
    /// 2. Allocates a portion of gains to the Reserve based on reserveBps
    /// 3. Ensures the Senior tranche reaches its target APR, potentially using Junior tranche funds
    /// 4. Verifies the final NAV split is consistent with the total NAV
    /// @param navT0 Total Net Asset Value at the previous timestamp
    /// @param jrtNavT0 Junior tranche NAV at the previous timestamp
    /// @param srtNavT0 Senior tranche NAV at the previous timestamp
    /// @param reserveNavT0 Reserve NAV at the previous timestamp
    /// @param navT1 Current total Net Asset Value
    /// @return jrtNavT1 Updated Junior tranche NAV
    /// @return srtNavT1 Updated Senior tranche NAV
    /// @return reserveNavT1 Updated Reserve NAV
    function calculateNAVSplit (
        uint256 navT0,
        uint256 jrtNavT0,
        uint256 srtNavT0,
        uint256 reserveNavT0,

        uint256 navT1
    ) public view returns (uint jrtNavT1, uint srtNavT1, uint reserveNavT1) {
        int256 gain_dT = int256(navT1) - int256(navT0);

        if (gain_dT < 0) {
            // Should never happen to USDe, but in such edge case the Loss is covered by Jrt, then Reserve, then Srt
            uint256 loss = uint256(-gain_dT);
            console.log("  Loss  : ", loss);

            uint256 jrtLoss = Math.min(jrtNavT0, loss);

            loss -= jrtLoss;
            uint256 reserveLoss = Math.min(reserveNavT0, loss);

            loss -= reserveLoss;
            uint256 srtLoss = Math.min(srtNavT0, loss);
            require(srtLoss == loss, "Loss>navT0");

            jrtNavT0 -= jrtLoss;
            srtNavT0  -= srtLoss;
            reserveNavT0 -= reserveLoss;
            gain_dT = 0;
        }
        uint256 gain_dTAbs = uint256(gain_dT);


        console.log("  Current Strategy Gain  : ", uint256(gain_dT));
        console.log("  srtNavT0      :", srtNavT0);
        console.log("  jrtNavT0      :", jrtNavT0);

        // console.log("  index latest       :", srtTargetIndex);
        // console.log("  index current      :", srtTargetIndexCurrent);
        // console.log("  apr srt            :", aprSrt.unwrap());


        // #1 Final new reserve
        uint256 reserve_dT = 0;
        if (gain_dTAbs > 0 && reserveBps > 0) {
            reserve_dT = gain_dTAbs * reserveBps / PERCENTAGE_100;
            gain_dTAbs -= reserve_dT;
        }
        reserveNavT1 = reserveNavT0 + reserve_dT;

        // Give the total gain (if any) to Juniors, later here, we subtract from Juniors the disered Gain of Seniors
        jrtNavT1 = jrtNavT0 + gain_dTAbs;

        // Calculate Srt gain
        uint256 srtTargetIndexT1 = getSrtTargetIndexT1();
        // Gain = Assets * (TargetIndex1 / TargetIndex0 - 1);
        int256 srtGainTarget = calculateGain(srtNavT0, srtTargetIndexT1, srtTargetIndex);
        console.log("  Srt Gain Target : ", uint256(srtGainTarget));

        if (srtGainTarget < 0) {
            uint256 los = uint256(-srtGainTarget);
            uint256 srtLos = Math.min(srtNavT0, los);

            srtNavT0 -= srtLos;
            jrtNavT0 += srtLos;
            srtGainTarget = 0;
        }
        uint256 srtGainTargetAbs = Math.min(
            uint256(srtGainTarget),
            Math.saturatingSub(jrtNavT1, 1e18)
        );

        // #2 Final new Jrt
        jrtNavT1 = jrtNavT1 - srtGainTargetAbs;
        // #3 Final new Srt
        srtNavT1 = srtNavT0 + srtGainTargetAbs;


        if (navT1 != (jrtNavT1 + srtNavT1 + reserveNavT1)) {
            console.log("navT0    :", navT0);
            console.log("jrtNavT0 :", jrtNavT0);
            console.log("srtNavT0 :", srtNavT0);
            console.log("jrtNavT1 :", jrtNavT1);
            console.log("srtNavT1 :", srtNavT1);
            revert InvalidNavSpit(navT1, jrtNavT1, srtNavT1, reserveNavT1);
        }

        return (jrtNavT1, srtNavT1, reserveNavT1);
    }

    /// @notice Calculates the target index for the current block
    function getSrtTargetIndexT1 () internal view returns (uint256) {
        return calculateTargetIndex(srtTargetIndex, indexTimestamp, block.timestamp, aprSrt);
    }

    /// @notice Calculates the target index based on the latest index, time period, and APR using compound interest formula
    function calculateTargetIndex (uint256 targetIndex, uint256 t0, uint256 t1, UD60x18 apr) internal pure returns (uint256) {
        uint256 dt = t1 - t0;
        if (dt == 0) {
            return targetIndex;
        }
        // Calculate the interest factor: (APR * time elapsed) / seconds per year
        uint256 interestFactor = apr.unwrap() * dt / SECONDS_PER_YEAR;
        // Apply the interest factor to the initial target index
        // newIndex = oldIndex * (1 + interestFactor)
        uint256 targetIndexT1 = targetIndex * (1e18 + interestFactor) / 1e18;
        return targetIndexT1;
    }


    function calculateRiskPremium () public view returns (UD60x18){
        // RiskPremium = x + y * TVL_ratio_sr ^ k
        UD60x18 tvlRatio = UD60x18.wrap(srtNav == 0 ? 0 : (srtNav * 1e18 / (srtNav + jrtNav)));
        UD60x18 riskPremium = riskX + riskY * pow(tvlRatio, riskK);
        return riskPremium;
    }

    // Push new APRs to update srtIndex
    function onAprChanged (/* SD7x12 */ int64 newAprTarget, /* SD7x12 */ int64 newAprBase) external onlyRole(UPDATER_CDO_APR_ROLE)  {
        UD60x18 aprTargetNew = mapApr(newAprTarget);
        UD60x18 aprBaseNew = mapApr(newAprBase);

        aprTarget = aprTargetNew;
        aprBase = aprBaseNew;
        updateIndexes(aprTargetNew, aprBaseNew);
        emit AprsPushed(aprTargetNew.unwrap(), aprBaseNew.unwrap());
    }

    // Fetch APRs from Feed
    function updateAprs () internal  {
        if (address(aprsFeed) == address(0)) {
            return;
        }
        IAprTupleFeed.Round memory round = aprsFeed.latestRoundData();

        UD60x18 aprTargetNew = mapApr(round.aprTarget);
        UD60x18 aprBaseNew = mapApr(round.aprBase);
        if (aprTargetNew != aprTarget || aprBaseNew != aprBase) {
            aprTarget = aprTargetNew;
            aprBase = aprBaseNew;
            updateIndexes(aprTargetNew, aprBaseNew);
        }
    }

    function updateIndexes (UD60x18 aprTarget_, UD60x18 aprBase_) internal {
        UD60x18 risk = calculateRiskPremium();
        UD60x18 aprSrt1 = mul(aprBase_, UD60x18.wrap(1e18) - risk);

        aprSrt = UD60x18Ext.max(aprTarget_, aprSrt1);
        srtTargetIndex = getSrtTargetIndexT1();
        indexTimestamp = block.timestamp;

        console.log("Update Indexes");
        console.log("      aprTarget: ", aprTarget_.unwrap());
        console.log("      aprBase  : ", aprBase_.unwrap());
        console.log("      aprSrt1  : ", aprSrt1.unwrap());
        console.log("      aprSrt   : ", aprSrt.unwrap());
    }

    /// @dev Calculates the desired gain based on the change in target index over a period
    /// @return The calculated gain (positive) or loss (negative) as an int256
    function calculateGain (uint256 navT0, uint256 targetIndexT1, uint256 targetIndexT0) internal pure returns (int256) {
        // Gain = Assets * (TargetIndex1 / TargetIndex0 - 1);
        return int256(navT0 * targetIndexT1 / targetIndexT0) - int256(navT0);
    }

    /// @dev Converts APR from Feed's compact format (12 decimal places, stored in 1 SLOT) to UD60x18
    /// @return The APR value as a UD60x18
    function mapApr (/* SD7x12 */ int64 apr) internal pure returns (UD60x18) {
        require(
            APR_BOUNDARY_MIN <= apr && apr <= APR_BOUNDARY_MAX,
            "invalid apr"
        );
        uint256 decimals = 12;
        return UD60x18.wrap(uint256(int256(apr)) * (10 ** (18 - decimals)));
    }

    /// @notice Sets the risk premium parameters used in calculating the risk-adjusted APR
    /// @param riskX_ Base risk premium
    /// @param riskY_ Coefficient for the TVL ratio-dependent component
    /// @param riskK_ Exponent for the TVL ratio in the risk calculation
    /// @dev Only callable by accounts with UPDATER_STRAT_CONFIG_ROLE
    function setRiskParameters (
        UD60x18 riskX_,
        UD60x18 riskY_,
        UD60x18 riskK_
    ) external onlyRole(UPDATER_STRAT_CONFIG_ROLE) {
        riskX = riskX_;
        riskY = riskY_;
        riskK = riskK_;
        UD60x18 risk = calculateRiskPremium();
        require(risk.unwrap() < PERCENTAGE_100, ">=100%");
    }

    /// @notice Sets the APRs Feed contract for fetching APR target and APR base
    /// @dev This feed provides the external APR values used in calculations
    /// @param aprsFeed_ The address of the new APRs Feed contract
    /// @dev Only callable by the protocol owner
    function setAprsFeed (IAprTupleFeed aprsFeed_) external onlyOwner {
        aprsFeed = aprsFeed_;
        emit AprsFeedChanged(address(aprsFeed_));
    }

    /// @notice Sets the percentage of gains allocated to the reserve
    /// @param bps The new reserve percentage in basis points (1e18 = 100%)
    /// @dev Only callable by the protocol owner
    /// @dev The maximum allowed value is defined by RESERVE_BPS_MAX
    function setReserveBps (uint256 bps) external onlyOwner {
        require(bps <= RESERVE_BPS_MAX, "RESERVE_BPS_MAX");
        reserveBps = bps;
        emit ReservePercentageChanged(reserveBps);
    }
}
