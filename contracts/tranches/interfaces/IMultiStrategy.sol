// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStrategy} from "./IStrategy.sol";

interface IMultiStrategy is IStrategy {
    function getSupportedTokens(address tranche) external view returns (IERC20[] memory);
}
