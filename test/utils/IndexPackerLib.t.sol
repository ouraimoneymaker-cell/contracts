// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../../contracts/tranches/utils/IndexPackerLib.sol";

contract IndexPackerLibTest is Test {
    using IndexPackerLib for uint256;

    // Constants matching the library
    uint256 private constant LENGTH_SHIFT = 248;

    /*//////////////////////////////////////////////////////////////
                        BASIC FUNCTIONALITY
    //////////////////////////////////////////////////////////////*/

    function test_pack1_BasicCase() public pure {
        uint256 packed = IndexPackerLib.pack1(0);
        assertEq(IndexPackerLib.length(packed), 1, "pack1(0) incorrect length");
        assertEq(IndexPackerLib.unpack(packed, 0), 0, "pack1(0) incorrect unpack");

        packed = IndexPackerLib.pack1(1);
        assertEq(IndexPackerLib.length(packed), 1, "pack1(1) incorrect length");
        assertEq(IndexPackerLib.unpack(packed, 0), 1, "pack1(1) incorrect unpack");

        packed = IndexPackerLib.pack1(2);
        assertEq(IndexPackerLib.length(packed), 1, "pack1(2) incorrect length");
        assertEq(IndexPackerLib.unpack(packed, 0), 2, "pack1(2) incorrect unpack");
    }

    function test_pack2_BasicCase() public pure {
        uint256 packed = IndexPackerLib.pack2(1, 0);
        uint256 expected = (2 << LENGTH_SHIFT) | (0 << 8) | 1;
        assertEq(packed, expected, "pack2(1, 0) incorrect");

        assertEq(IndexPackerLib.length(packed), 2, "pack2(1, 0) incorrect length");
        assertEq(IndexPackerLib.unpack(packed, 0), 1, "pack2(1, 0) incorrect unpack");
        assertEq(IndexPackerLib.unpack(packed, 1), 0, "pack2(1, 0) incorrect unpack");
    }

    function test_pack3_BasicCase() public pure {
        uint256 packed = IndexPackerLib.pack3(3, 1, 0);

        assertEq(IndexPackerLib.length(packed), 3, "pack2(1, 0) incorrect length");
        assertEq(IndexPackerLib.unpack(packed, 0), 3, "pack3(3, 1, 0) incorrect unpack");
        assertEq(IndexPackerLib.unpack(packed, 1), 1, "pack3(3, 1, 0) incorrect unpack");
        assertEq(IndexPackerLib.unpack(packed, 2), 0, "pack3(3, 1, 0) incorrect unpack");
    }

    function test_pack2_ReverseOrder() public pure {
        uint256 packed = IndexPackerLib.pack2(0, 1);
        uint256 expected = (2 << LENGTH_SHIFT) | (1 << 8) | 0;
        assertEq(packed, expected, "pack2(0, 1) incorrect");
    }

    function test_length_Pack2() public pure {
        uint256 packed = IndexPackerLib.pack2(1, 0);
        assertEq(packed.length(), 2, "Length should be 2");
    }

    function test_unpack_Positions() public pure {
        uint256 packed = IndexPackerLib.pack2(42, 99);
        assertEq(packed.unpack(0), 42, "Position 0 should be 42");
        assertEq(packed.unpack(1), 99, "Position 1 should be 99");
    }

    function testFuzz_pack2_RoundTrip(uint8 a, uint8 b) public pure {
        uint256 packed = IndexPackerLib.pack2(a, b);
        assertEq(packed.length(), 2, "Length should be 2");
        assertEq(packed.unpack(0), a, "Round trip failed for a");
        assertEq(packed.unpack(1), b, "Round trip failed for b");
    }

    /*//////////////////////////////////////////////////////////////
                        EDGE CASES
    //////////////////////////////////////////////////////////////*/

    function test_edgeCase_MaxValues() public pure {
        uint256 packed = IndexPackerLib.pack2(255, 255);
        assertEq(packed.unpack(0), 255, "Max value position 0");
        assertEq(packed.unpack(1), 255, "Max value position 1");
    }

    function test_edgeCase_ZeroValues() public pure {
        uint256 packed = IndexPackerLib.pack2(0, 0);
        assertEq(packed.unpack(0), 0, "Zero value position 0");
        assertEq(packed.unpack(1), 0, "Zero value position 1");
    }

    function test_edgeCase_DifferentOrders() public pure {
        uint256 order1 = IndexPackerLib.pack2(1, 0);
        uint256 order2 = IndexPackerLib.pack2(0, 1);
        assertTrue(order1 != order2, "Different orders should produce different values");
    }

    function testFuzz_edgeCase_OrderMatters(uint8 a, uint8 b) public pure {
        vm.assume(a != b);
        uint256 packed1 = IndexPackerLib.pack2(a, b);
        uint256 packed2 = IndexPackerLib.pack2(b, a);
        assertTrue(packed1 != packed2, "Order should matter");
    }

    /*//////////////////////////////////////////////////////////////
                        BIT LAYOUT
    //////////////////////////////////////////////////////////////*/

    function test_bitLayout_LengthPosition() public pure {
        uint256 packed = IndexPackerLib.pack2(0, 0);
        uint256 lengthBits = packed >> 248;
        assertEq(lengthBits, 2, "Length not in correct bit position");
    }

    function test_bitLayout_IndexPositions() public pure {
        uint256 packed = IndexPackerLib.pack2(0x12, 0x34);

        // Index 0 in bits [7:0]
        uint256 index0Bits = packed & 0xFF;
        assertEq(index0Bits, 0x12, "Index 0 not in correct bit position");

        // Index 1 in bits [15:8]
        uint256 index1Bits = (packed >> 8) & 0xFF;
        assertEq(index1Bits, 0x34, "Index 1 not in correct bit position");
    }

    function test_bitLayout_UnusedBitsZero() public pure {
        uint256 packed = IndexPackerLib.pack2(255, 255);
        // Bits [247:16] should be zero
        uint256 unusedBits = (packed >> 16) & ((1 << 232) - 1);
        assertEq(unusedBits, 0, "Unused bits should be zero");
    }

    function test_bitLayout_ExpectedHex() public pure {
        // Verify exact hex representation
        uint256 packed1 = IndexPackerLib.pack2(1, 0);
        uint256 expected1 = 0x0200000000000000000000000000000000000000000000000000000000000001;
        assertEq(packed1, expected1, "Hex representation mismatch for pack2(1, 0)");

        uint256 packed2 = IndexPackerLib.pack2(0, 1);
        uint256 expected2 = 0x0200000000000000000000000000000000000000000000000000000000000100;
        assertEq(packed2, expected2, "Hex representation mismatch for pack2(0, 1)");
    }

    /*//////////////////////////////////////////////////////////////
                        INTEGRATION TESTS
    //////////////////////////////////////////////////////////////*/

    function test_integration_JRTWithdrawOrder() public pure {
        // JRT withdraws from senior (1) first, then junior (0)
        uint256 jrtOrder = IndexPackerLib.pack2(1, 0);

        assertEq(jrtOrder.length(), 2, "JRT order length incorrect");
        assertEq(jrtOrder.unpack(0), 1, "JRT should withdraw from senior first");
        assertEq(jrtOrder.unpack(1), 0, "JRT should withdraw from junior second");
    }

    function test_integration_SRTWithdrawOrder() public pure {
        // SRT withdraws from junior (0) first, then senior (1)
        uint256 srtOrder = IndexPackerLib.pack2(0, 1);

        assertEq(srtOrder.length(), 2, "SRT order length incorrect");
        assertEq(srtOrder.unpack(0), 0, "SRT should withdraw from junior first");
        assertEq(srtOrder.unpack(1), 1, "SRT should withdraw from senior second");
    }

    function test_integration_MultiProtocolStrategy() public pure {
        // Simulate a strategy with 5 protocols
        // Withdrawal priority: 4 -> 3 -> 2 -> 1 -> 0
        uint256 packed = (5 << LENGTH_SHIFT) | (0 << 32) | (1 << 24) | (2 << 16) | (3 << 8) | 4;

        assertEq(packed.length(), 5, "Should have 5 protocols");
        assertEq(packed.unpack(0), 4, "First withdrawal from protocol 4");
        assertEq(packed.unpack(1), 3, "Second withdrawal from protocol 3");
        assertEq(packed.unpack(2), 2, "Third withdrawal from protocol 2");
        assertEq(packed.unpack(3), 1, "Fourth withdrawal from protocol 1");
        assertEq(packed.unpack(4), 0, "Fifth withdrawal from protocol 0");
    }

    function test_integration_WithdrawalLoop() public pure {
        // Simulate actual withdrawal loop usage
        uint256 withdrawOrder = IndexPackerLib.pack2(1, 0);
        uint256 len = withdrawOrder.length();

        uint256[] memory withdrawnFrom = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            withdrawnFrom[i] = withdrawOrder.unpack(i);
        }

        assertEq(withdrawnFrom[0], 1, "First withdrawal incorrect");
        assertEq(withdrawnFrom[1], 0, "Second withdrawal incorrect");
    }
}
