// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { UD60x18Extra } from "./utils/UD60x18Extra.sol";
import { UD60x18, pow, mul } from "@prb/math/src/ud60x18/Math.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { AccessControlled } from "../governance/AccessControlled.sol";
import { OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { IYieldAccounting } from "./interfaces/IYieldAccounting.sol";
import { IStrataCDO } from "./interfaces/IStrataCDO.sol";
import { CDOComponent } from "./base/CDOComponent.sol";
import "hardhat/console.sol";

contract YieldAccounting is IYieldAccounting, CDOComponent, AccessControlled {

    bytes32 public constant APR_UPDATER_ROLE = keccak256("APR_UPDATER");

    uint256 constant SECONDS_PER_YEAR = 31_536_000;

    int64 private constant APR_BOUNDARY_MAX = 200 * 1e12;
    int64 private constant APR_BOUNDARY_MIN = 0;


    address public aprTargetFeed;
    address public aprBaseFeed;

    UD60x18 public aprTarget;
    UD60x18 public aprBase;

    UD60x18 public aprSrt;
    UD60x18 public aprJrt;

    uint256 public srtTargetIndexTimestamp;
    uint256 public srtTargetIndex;
    uint256 public srtTargetIndexFloor;

    uint256 public reserveBps;
    uint256 constant PERCENTAGE_100 = 1e18;
    uint256 constant FEE_MAX = 2e17;

    // Balances
    uint256 public nav;
    uint256 public jrtNav;
    uint256 public srtNav;
    uint256 public reserveNav;

    // Track Jrt Fundings to repay later when srtGain > srtGainFloor
    uint256 public jrtFundingNav;

    UD60x18 public riskX;
    UD60x18 public riskY;
    UD60x18 public riskK;


    error InvalidAssets(uint256 currentNAV, uint256 jrtAssets, uint256 srtAssets, uint256 reserveAssets);

    event AprChanged(uint256 aprTarget, uint256 aprBase);

    function initialize(
        address owner_,
        address acm_,
        IStrataCDO cdo_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);
        cdo = cdo_;

        riskX = UD60x18.wrap(2e17);
        riskY = UD60x18.wrap(2e17);
        riskK = UD60x18.wrap(3e17);

        srtTargetIndex = 1e18;
        srtTargetIndexFloor = 1e18;
        srtTargetIndexTimestamp = block.timestamp;
    }

    function totalAssets (uint256 currentNAV) public view returns (uint jrtAssets, uint srtAssets, uint reserveAssets) {
        (
            jrtAssets,
            srtAssets,
            reserveAssets,
        ) = calculateNAVSplit(nav, jrtNav, srtNav, reserveNav, currentNAV);
        return (jrtAssets, srtAssets, reserveAssets);
    }

    function updateAccounting (
        uint256 currentNAV
    ) external onlyCDO {
        (
            uint256 jrtNav_,
            uint256 srtNav_,
            uint256 reserveNav_,
            uint256 jrtFundingTotal_
        ) = calculateNAVSplit(nav, jrtNav, srtNav, reserveNav, currentNAV);

        updateIndexes(aprTarget, aprBase);
        nav = currentNAV;
        jrtNav = jrtNav_;
        srtNav = srtNav_;
        reserveNav = reserveNav_;
        jrtFundingNav = jrtFundingTotal_;
    }

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

    /**
     * @notice Update jrt/srt/reserves TVL to current Net Asset Value (e.g. TVL USDe)
     * 1. Redistributes Gain accordingly
     * 2. if Target APR(APY) for SRT is not reached, fund Srt with Reserves or/and Jrt's TVL
     */
    function calculateNAVSplit (
        uint256 lastNav,
        uint256 lastJrtNav,
        uint256 lastSrtNav,
        uint256 lastReserveNav,

        uint256 currentNAV
    ) public view returns (uint navJrt, uint navSrt, uint navReserve, uint navJrtFundingTotal) {
        uint256 srtTargetIndexCurrent = getSrtTargetIndexCurrent();
        uint256 srtTargetIndexFloorCurrent = getSrtTargetIndexFloorCurrent();
        // Gain = Assets * (TargetIndex1 / TargetIndex0 - 1);
        uint256 srtGainTarget = calculateGain(lastSrtNav, srtTargetIndexCurrent, srtTargetIndex); //srtTargetIndex == 0 ? 0 : (lastSrtNav * srtTargetIndexCurrent / srtTargetIndex - lastSrtNav);
        uint256 srtGainTargetFloor = calculateGain(lastSrtNav, srtTargetIndexFloorCurrent, srtTargetIndexFloor); //srtTargetIndexFloor == 0 ? 0 : (lastSrtNav * srtTargetIndexFloorCurrent / srtTargetIndexFloor - lastSrtNav);

        int256 currentGain = int256(currentNAV) - int256(lastNav);
        uint256 currentGainAbs = currentGain < 0 ? 0 : uint256(currentGain);

        console.log("srtGainTarget : ", srtGainTarget);
        console.log("srtGainTargetF: ", srtGainTargetFloor);
        console.log("Current Gain: ", currentGainAbs);

        console.log("index latest       :", srtTargetIndex);
        console.log("index current      :", srtTargetIndexCurrent);
        console.log("index current floor:", srtTargetIndexFloorCurrent);

        uint256 reserve = 0;
        if (currentGainAbs > 0 && reserveBps > 0) {
            reserve = currentGainAbs * reserveBps / PERCENTAGE_100;
            currentGainAbs -= reserve;
        }

        // if juniors have previously funded Srt, pick the Floor APR (APRssr) to refund juniors
        navJrtFundingTotal = jrtFundingNav;
        if (navJrtFundingTotal > 0 && srtGainTargetFloor < srtGainTarget) {
            uint256 extra = srtGainTarget - srtGainTargetFloor;
            if (extra > navJrtFundingTotal) {
                // Take minimum required gain to cover APR_target and repay juniors
                srtGainTarget = srtGainTargetFloor;
                navJrtFundingTotal -= extra;
            } else {
                // Current extra is already enough to cover total juniors funding
                srtGainTarget -= navJrtFundingTotal;
                navJrtFundingTotal = 0;
            }
        }

        uint256 funding = currentGainAbs >= srtGainTarget ? 0 : (srtGainTarget - currentGainAbs);
        uint256 fundingFromReserve = Math.min(funding, reserveNav);

        uint256 fundingFromJrt = fundingFromReserve < funding
            ? funding - fundingFromReserve
            : 0;
        if (fundingFromJrt > lastJrtNav) {
            // In worst case, ensure jrt funding is not larger than jrt liquidity
            srtGainTarget -= fundingFromJrt - lastJrtNav;
            fundingFromJrt = lastJrtNav;
        }

        int256 jrtGain = int256(currentGainAbs) - int256(srtGainTarget);
        uint256 jrtGainAbs = jrtGain < 0 ? 0 : uint256(jrtGain);


        navJrt = lastJrtNav + jrtGainAbs - fundingFromJrt;
        navSrt = lastSrtNav + srtGainTarget;
        navReserve = lastReserveNav + reserve - fundingFromReserve;
        navJrtFundingTotal += fundingFromJrt;

        if (currentNAV != (navJrt + navSrt + navReserve)) {
            console.log("jrtGainAbs", jrtGainAbs);
            console.log("lastNav", lastNav);
            console.log("lastJrtNav", lastJrtNav);
            revert InvalidAssets(currentNAV, navJrt, navSrt, navReserve);
        }

        return (navJrt, navSrt, navReserve, navJrtFundingTotal);
    }

    function getSrtTargetIndexCurrent () internal view returns (uint256) {
        return calculateTargetIndex(srtTargetIndex, srtTargetIndexTimestamp, block.timestamp, aprSrt);
    }
    function getSrtTargetIndexFloorCurrent () internal view returns (uint256) {
        return calculateTargetIndex(srtTargetIndexFloor, srtTargetIndexTimestamp, block.timestamp, aprTarget);
    }

    function calculateTargetIndex (uint256 targetIndex, uint256 t0, uint256 t1, UD60x18 apr) internal pure returns (uint256) {
        uint256 dt = t1 - t0;
        if (dt == 0) {
            return targetIndex;
        }
        uint256 interestFactor = apr.unwrap() * dt / SECONDS_PER_YEAR;
        uint256 targetIndexCurrent = targetIndex * (1e18 + interestFactor) / 1e18;
        return targetIndexCurrent;
    }

    function calculateRiskPremium () public view returns (UD60x18){
        // RiskPremium = x + y * TVL_ratio_sr ^ k
        UD60x18 tvlRatio = UD60x18.wrap(srtNav == 0 ? 0 : (srtNav * 1e18 / (srtNav + jrtNav)));
        UD60x18 riskPremium = riskX + riskY * pow(tvlRatio, riskK);
        return riskPremium;
    }

    function onAprChanged (/* SD7x12 */ int64 newAprTarget, /* SD7x12 */ int64 newAprBase) external onlyRole(APR_UPDATER_ROLE)  {
        UD60x18 aprTargetNew = mapApr(newAprTarget);
        UD60x18 aprBaseNew = mapApr(newAprBase);

        aprTarget = aprTargetNew;
        aprBase = aprBaseNew;
        emit AprChanged(aprTargetNew.unwrap(), aprBaseNew.unwrap());
        updateIndexes(aprTargetNew, aprBaseNew);
    }

    function updateIndexes (UD60x18 aprTarget_, UD60x18 aprBase_) internal {
        UD60x18 risk = calculateRiskPremium();
        UD60x18 aprSrt1 = mul(aprBase_, UD60x18.wrap(1e18) - risk);

        aprSrt = UD60x18Extra.max(aprTarget_, aprSrt1);
        srtTargetIndex = getSrtTargetIndexCurrent();
        srtTargetIndexFloor = getSrtTargetIndexFloorCurrent();
        srtTargetIndexTimestamp = block.timestamp;

        console.log("Update Indexes");
        console.log("      aprTarget: ", aprTarget_.unwrap());
        console.log("      aprBase  : ", aprTarget_.unwrap());
        console.log("      aprSrt1  : ", aprSrt1.unwrap());
        console.log("      aprSrt   : ", aprSrt.unwrap());
    }


    function calculateGain (uint256 lastNav, uint256 targetIndexCurrent, uint256 targetIndex) internal pure returns (uint256) {
        // Gain = Assets * (TargetIndex1 / TargetIndex0 - 1);
        if (targetIndexCurrent <= targetIndex) {
            // If zero or negative targetIndex, no gain
            return 0;
        }
        return lastNav * targetIndexCurrent / targetIndex - lastNav;
    }


    function mapApr (/* SD7x12 */ int64 apr) internal pure returns (UD60x18) {
        require(
            APR_BOUNDARY_MIN <= apr && apr <= APR_BOUNDARY_MAX,
            "invalid apr"
        );
        uint256 decimals = 12;
        return UD60x18.wrap(uint256(int256(apr)) * (10 ** (18 - decimals)));
    }
}
