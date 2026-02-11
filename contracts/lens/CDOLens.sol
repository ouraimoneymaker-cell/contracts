// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IAprPairFeed } from "../tranches/interfaces/IAprPairFeed.sol";
import { IStrataCDO } from "../tranches/interfaces/IStrataCDO.sol";
import { IAccounting } from "../tranches/interfaces/IAccounting.sol";
import { UD60x18, pow, mul } from "@prb/math/src/ud60x18/Math.sol";
import { UD60x18Ext } from "../tranches/utils/UD60x18Ext.sol";

/**
 * @title Strata CDO Contract Helper
 * @author Strata
 */
contract CDOLens is OwnableUpgradeable {


    struct TAPRs {
        int64 base;
        int64 target;
        int64 jrt;
        int64 srt;
    }

    IStrataCDOApi[] public cdos;

    function initialize(address owner) external initializer {
        __Ownable_init_unchained(owner);
    }

    function getAPRs (IStrataCDOApi cdo) external view returns (TAPRs memory) {
        IAccountingApi accounting = cdo.accounting();

        IAprPairFeed feed = accounting.aprPairFeed();

        IAprPairFeed.TRound memory round = feed.latestRoundData();

        uint256 nav = cdo.totalStrategyAssets();
        (uint256 jrtNav, uint256 srtNav, ) = accounting.totalAssets(nav);

        UD60x18 riskX = accounting.riskX();
        UD60x18 riskY = accounting.riskY();
        UD60x18 riskK = accounting.riskK();

        UD60x18 tvlRatioSrt = UD60x18.wrap(srtNav == 0 ? 0 : (srtNav * 1e18 / (srtNav + jrtNav)));
        UD60x18 tvlRatioJrt = UD60x18.wrap(jrtNav == 0 ? 0 : (jrtNav * 1e18 / (srtNav + jrtNav)));
        UD60x18 risk = calculateRiskPremiumInner(riskX, riskY, riskK, tvlRatioSrt);

        int256 aprBase   = int256(round.aprBase);
        int256 aprTarget = int256(round.aprTarget);

        UD60x18 aprSrt1 = mul(UD60x18.wrap(uint256(aprBase)), UD60x18.wrap(1e18) - risk);
        int256 aprSrt = int256(UD60x18Ext.max(UD60x18.wrap(uint256(aprTarget)), aprSrt1).unwrap());

        int256 aprJrtSpread = (int256(round.aprBase) - aprSrt) * int256(tvlRatioSrt.unwrap()) / int256(tvlRatioJrt.unwrap());
        int256 aprJrt = int256(round.aprBase) + aprJrtSpread;

        uint256 reserveBps = accounting.reserveBps();
        if (aprJrt > 0 && reserveBps > 0) {
            // Net APR = grossApr * (1 - performanceFee)
            uint256 factor = 1e18 - reserveBps;
            aprJrt = (aprJrt * int256(factor)) / int256(1e18);
        }

        return TAPRs({
            base: int64(round.aprBase),
            target: int64(round.aprTarget),
            jrt: int64(aprJrt),
            srt: int64(aprSrt)
        });
    }

    /**
     * @notice Add partner's protocols to the contract, if they are not already added
     * @param arr The array of ICDO instances
     */
    function addCDOs (IStrataCDOApi[] memory arr) external onlyOwner {
        for (uint i = 0; i < arr.length; i++) {
            address cdo = address(arr[i]);
            removeCDOInner(cdo);
            cdos.push(IStrataCDOApi(cdo));
        }
    }

    /**
     * @notice Remove partner's protocols from the contract
     * @param arr The array of ICDO instances
     */
    function removeCDOs (IStrataCDOApi[] memory arr) external onlyOwner {
        for (uint i = 0; i < arr.length; i++) {
            address cdo = address(arr[i]);
            removeCDOInner(cdo);
        }
    }

    function removeCDOInner(address cdo) internal {
        uint length = cdos.length;
        for (uint i = 0; i < length; i++) {
            if (address(cdos[i]) == cdo) {
                if (i != length - 1) {
                    cdos[i] = cdos[length - 1];
                }
                cdos.pop();
                break;
            }
        }
    }


    function calculateRiskPremiumInner (UD60x18 x, UD60x18 y, UD60x18 k, UD60x18 tvlRatioSrt) internal pure returns (UD60x18){
        // RiskPremium = x + y * TVL_ratio_sr ^ k
        UD60x18 riskPremium = x + y * pow(tvlRatioSrt, k);
        return riskPremium;
    }
}


interface IAccountingApi is IAccounting {
    function aprPairFeed() external view returns (IAprPairFeed);
    function riskX () external view returns (UD60x18);
    function riskY () external view returns (UD60x18);
    function riskK () external view returns (UD60x18);
    function reserveBps () external view returns (uint256);
}
interface IStrataCDOApi is IStrataCDO{
    function accounting() external view returns (IAccountingApi);
}
