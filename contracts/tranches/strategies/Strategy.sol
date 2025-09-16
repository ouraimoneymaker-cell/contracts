// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IStrategy } from "../interfaces/IStrategy.sol";
import { IErrors } from "../interfaces/IErrors.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControlled } from "../../governance/AccessControlled.sol";

abstract contract Strategy is IErrors, IStrategy, AccessControlled {

}
