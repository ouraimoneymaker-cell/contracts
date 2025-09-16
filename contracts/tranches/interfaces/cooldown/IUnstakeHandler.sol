// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;


interface IUnstakeHandler {
    function initialize (address user) external;

    function request () external returns (uint256 unlockAt);
    function request (address receiver) external returns (uint256 unlockAt);

    function finalize() external returns (uint256);

    function getPending () external view returns (uint256 amount);
}
