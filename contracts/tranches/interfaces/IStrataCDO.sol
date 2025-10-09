// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IStrategy } from "./IStrategy.sol";
import { ITranche } from "./ITranche.sol";

interface IStrataCDO {

    function strategy() external view returns (IStrategy);

    function totalAssets (address tranche) external view returns (uint256);
    function totalStrategyAssets () external view returns (uint256);
    function updateAccounting () external;

    function deposit (address tranche, address token, uint256 tokenAmount, uint256 baseAssets) external;
    function withdraw (address tranche, address token, uint256 tokenAmount, uint256 baseAssets, address owner, address receiver) external;

    function maxWithdraw(address tranche) external view returns (uint256);
    function maxDeposit(address tranche) external view returns (uint256);

    // reverts if neither Jrt nor Srt
    function isJrt (address tranche) external view returns (bool);

    function jrtVault() external view returns (ITranche);
    function srtVault() external view returns (ITranche);
}
