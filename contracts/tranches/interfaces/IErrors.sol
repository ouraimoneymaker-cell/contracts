// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;


interface IErrors {

    error InvalidTranche(address tranche);
    error InvalidCaller(address caller);

    error UnsupportedToken(address token);

    error AlreadyConfigured();

    error MinSharesViolation();

    error WithdrawalsDisabled();
    error DepositsDisabled();

    error InvalidConfigCooldown();
}
