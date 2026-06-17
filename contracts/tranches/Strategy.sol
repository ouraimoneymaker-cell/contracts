// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import { IStrategy } from "./interfaces/IStrategy.sol";
import { CDOComponent }  from "./base/CDOComponent.sol";

/// @title Strategy
/// @notice Abstract base contract for CDO investment strategies
/// @dev Provides a foundation for concrete strategy implementations
/// @dev Concrete strategies must implement specific investment logic by extending this contract
abstract contract Strategy is IStrategy, CDOComponent {

    function deposit (
        address /*tranche*/,
        address /*token*/,
        uint256 /*tokenAmount*/,
        uint256 /*baseAssets*/,
        address /*owner*/,
        bytes memory /*options*/
    ) external virtual returns (uint256) {
        revert ("NotImplemented");
    }

    function withdraw (
        address /*tranche*/,
        address /*token*/,
        uint256 /*tokenAmount*/,
        uint256 /*baseAssets*/,
        address /*sender*/,
        address /*receiver*/,
        bool /*shouldSkipCooldown*/,
        bytes memory /*options*/
    ) external virtual returns (uint256) {
        revert ("NotImplemented");
    }

    /**
     * @notice Returns the deposit fee percentage for the underlying protocol
     * @return feeBps The deposit fee in basis points (e.g., 10 = 0.1%)
     */
    function depositFeeBps (address) external virtual view returns (uint256 feeBps) {
        return 0;
    }

    /**
     * @notice Returns the maximum deposit amount allowed by the strategy
     * @dev Override this method to implement deposit limits per tranche/token
     * @dev e.g. checking the underlying protocol's deposit state
     */
    function maxDeposit(address tranche, address tokenIn, uint256 tokenAmout) external virtual view returns (uint256 assets) {
        return type(uint256).max;
    }

    /**
     * @notice Returns the maximum withdrawal amount allowed by the strategy
     * @dev Override this method to implement withdrawal limits per tranche/token
     * @dev e.g. checking the underlying protocol's withdrawal state
     */
    function maxWithdraw(address tranche, address tokenOut, uint256 tokenAmout) external virtual view returns (uint256 assets) {
        return type(uint256).max;
    }

}
