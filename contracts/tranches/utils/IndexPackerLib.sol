// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library IndexPackerLib {
    uint256 private constant BITS_PER_INDEX = 8;
    uint256 private constant INDEX_MASK = 0xFF;
    uint256 private constant LENGTH_SHIFT = 248;

    /// @dev Packs 1 index into a single uint256 with length prefix
    /// @return packed Format: [length:8][unused:240][idx0:8]
    function pack1(uint256 a) internal pure returns (uint256 packed) {
        return (1 << LENGTH_SHIFT) | a;
    }

    /// @dev Packs 2 indexes into a single uint256 with length prefix
    /// @return packed Format: [length:8][unused:232][idx1:8][idx0:8]
    function pack2(uint256 a, uint256 b) internal pure returns (uint256 packed) {
        return (2 << LENGTH_SHIFT) | (b << 8) | a;
    }

    /// @dev Packs 3 indexes into a single uint256 with length prefix
    /// @return packed Format: [length:8][unused:224][idx2:8][idx1:8][idx0:8]
    function pack3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256 packed) {
        return (3 << LENGTH_SHIFT) | (c << 16) | (b << 8) | a;
    }


    /// @dev Gets the number of indexes stored in packed data
    function length(uint256 packed) internal pure returns (uint256) {
        return packed >> LENGTH_SHIFT;
    }

    /// @dev Unpacks a single index at the specified position
    /// @param packed The packed uint256 containing multiple indexes
    /// @param position The position to extract (0 = rightmost/first, 1 = second, etc.)
    /// @return The index value at the specified position
    function unpack(uint256 packed, uint256 position) internal pure returns (uint256) {
        return (packed >> (position * BITS_PER_INDEX)) & INDEX_MASK;
    }
}
