// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import { AccessControlled } from "../governance/AccessControlled.sol";

import { IYieldAccounting } from "./interfaces/IYieldAccounting.sol";
import { IStrategy } from "./interfaces/IStrategy.sol";
import { ITranche } from "./interfaces/ITranche.sol";

import { IErrors } from "./interfaces/IErrors.sol";
import { IStrataCDO } from "./interfaces/IStrataCDO.sol";


contract StrataCDO is IErrors, IStrataCDO, AccessControlled {

    IYieldAccounting public accounting;
    IStrategy public strategy;

    // Junior (BB) Tranche
    ITranche public jrtVault;

    // Sinior (AA) Tranche
    ITranche public srtVault;


    /// @notice
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
    }

    function totalAssets(address tranche) external view returns (uint256) {
        uint totalAssetsOverall = strategy.totalAssets();
        (uint256 jrtAssets, uint256 srtAssets, ) = accounting.totalAssets(
            totalAssetsOverall
        );
        if (tranche == address(jrtVault)) {
            return jrtAssets;
        }
        if (tranche == address(srtVault)) {
            return srtAssets;
        }
        revert InvalidTranche(tranche);
    }

    function updateAccounting () external onlyTranche {
        uint256 totalAssetsOverall = strategy.totalAssets();
        accounting.updateAccounting(totalAssetsOverall);
    }

    function deposit(address tranche, address token, uint256 tokenAmount, uint256 baseAssets) external onlyTranche {
        // @TODO check enabled
        strategy.deposit(tranche, token, tokenAmount, baseAssets, /* owner: */ tranche);
        uint jrtAssetsIn = tranche == address(jrtVault) ? baseAssets : 0;
        uint srtAssetsIn = tranche == address(srtVault) ? baseAssets : 0;
        accounting.updateBalanceFlow(jrtAssetsIn, 0, srtAssetsIn, 0);
    }

    function withdraw(address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address receiver) external onlyTranche {
        // @TODO check enabled
        strategy.withdraw(tranche, token, tokenAmount, baseAssets, receiver);
        uint jrtAssetsOut = tranche == address(jrtVault) ? baseAssets : 0;
        uint srtAssetsOut = tranche == address(srtVault) ? baseAssets : 0;
        accounting.updateBalanceFlow(0, jrtAssetsOut, 0, srtAssetsOut);
    }

    function isJrt (address tranche) external view returns (bool) {
        if (tranche == address(0)) {
            revert InvalidTranche(tranche);
        }
        if (tranche == address(jrtVault)) {
            return true;
        }
        if (tranche == address(srtVault)) {
            return false;
        }
        revert InvalidTranche(tranche);
    }

    // Deploy and configure the CDO components first with this CDO
    function configure (
        IYieldAccounting accounting_,
        IStrategy strategy_,
        ITranche jrtVault_,
        ITranche srtVault_
    ) external onlyOwner {
        if (address(accounting) != address(0)) {
            revert AlreadyConfigured();
        }
        require(address(this) == accounting_.getCDOAddress(), "A1");
        require(address(this) == strategy_.getCDOAddress()  , "A2");
        require(address(this) == jrtVault_.getCDOAddress()  , "A3");
        require(address(this) == srtVault_.getCDOAddress()  , "A4");

        accounting = accounting_;
        strategy = strategy_;
        jrtVault = jrtVault_;
        srtVault = srtVault_;

        jrtVault_.configure();
        srtVault_.configure();
    }
}
