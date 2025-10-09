// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ICDOComponent } from "./ICDOComponent.sol";
import { IMetaVault } from "./IMetaVault.sol";

interface ITranche is ICDOComponent, IMetaVault {

    function configure () external;
}
