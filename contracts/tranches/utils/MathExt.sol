// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


library MathExt {

    function max(int256 x, int256 y) internal pure returns (int256) {
        return x < y ? y : x;
    }

    function abs(int256 x) internal pure returns (uint256) {
        return x < 0 ? uint256(-x) : uint256(x);
    }
}
