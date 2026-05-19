// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;


interface IErrors {

    error InvalidTranche(address tranche);
    error InvalidCaller(address caller);

    error UnsupportedToken(address token);

    error AlreadyConfigured();

    error MinSharesViolation();

    error WithdrawalsDisabled(address tranche);
    error DepositsDisabled(address tranche);

    error WithdrawalRejectedByStrategy(address tranche, address token);
    error DepositRejectedByStrategy(address tranche, address token);

    error DepositCapReached(address tranche);
    error WithdrawalCapReached(address tranche);

    error InvalidConfigCooldown();

    error ZeroAmount();
}
