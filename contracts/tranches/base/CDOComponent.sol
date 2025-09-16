// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IErrors } from "../interfaces/IErrors.sol";
import { IStrataCDO } from "../interfaces/IStrataCDO.sol";
import { ICDOComponent } from "../interfaces/ICDOComponent.sol";

abstract contract CDOComponent is ICDOComponent, IErrors {

    IStrataCDO public cdo;

    /// @notice ensure cooldownDuration is zero
    modifier onlyCDO() {
        if (msg.sender != address(cdo)) {
            revert InvalidCaller(msg.sender);
        }
        _;
    }

    function getCDOAddress() external view returns (address) {
        return address(cdo);
    }
}
