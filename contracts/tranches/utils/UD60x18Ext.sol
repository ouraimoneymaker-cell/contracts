// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UD60x18 } from "@prb/math/src/UD60x18.sol";

library UD60x18Ext {
    /// @notice x + y (both already scaled to 1e18).
    function add(UD60x18 x, UD60x18 y) internal pure returns (UD60x18) {
        return UD60x18.wrap(UD60x18.unwrap(x) + UD60x18.unwrap(y));
    }

    /// @notice x - y, reverts if y > x.
    function sub(UD60x18 x, UD60x18 y) internal pure returns (UD60x18) {
        uint256 a = UD60x18.unwrap(x);
        uint256 b = UD60x18.unwrap(y);
        require(b <= a, "UD60x18Ext: underflow");
        return UD60x18.wrap(a - b);
    }

    /// @notice min(x, y)
    function min(UD60x18 x, UD60x18 y) internal pure returns (UD60x18) {
        return UD60x18.unwrap(x) <= UD60x18.unwrap(y) ? x : y;
    }

    /// @notice max(x, y)
    function max(UD60x18 x, UD60x18 y) internal pure returns (UD60x18) {
        return UD60x18.unwrap(x) >= UD60x18.unwrap(y) ? x : y;
    }

    function diffAbs (UD60x18 x, UD60x18 y) internal pure returns (UD60x18) {
        uint256 a = UD60x18.unwrap(x);
        uint256 b = UD60x18.unwrap(y);
        return UD60x18.wrap(a > b ? (a - b) : (b - a));
    }
}
