// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IStrategy } from "./interfaces/IStrategy.sol";
import { CDOComponent }  from "./base/CDOComponent.sol";

/// @title Strategy
/// @notice Abstract base contract for CDO investment strategies
/// @dev Provides a foundation for concrete strategy implementations
/// @dev Concrete strategies must implement specific investment logic by extending this contract
abstract contract Strategy is IStrategy, CDOComponent {

}
