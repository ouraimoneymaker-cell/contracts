// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    DiscreteAccountingSemanticTest,
    DiscreteAccountingConservationInvariantTest
} from "../test/PoC/Guardian/DiscreteAccountingConservationInvariant.t.sol";

/// @dev Isolated Foundry entrypoint for the bug-hunt CI profile. Keeping this
///      wrapper outside the repository's legacy test tree prevents unrelated,
///      pre-existing Guardian PoCs from being compiled by the focused run.
contract BughuntDiscreteAccountingSemanticTest is DiscreteAccountingSemanticTest { }

contract BughuntDiscreteAccountingConservationInvariantTest is
    DiscreteAccountingConservationInvariantTest
{ }
