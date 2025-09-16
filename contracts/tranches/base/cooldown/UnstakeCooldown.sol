// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { IUnstakeHandler } from "../../interfaces/cooldown/IUnstakeHandler.sol";
import { IUnstakeCooldown } from "../../interfaces/cooldown/IUnstakeCooldown.sol";
import { AccessControlled } from "../../../governance/AccessControlled.sol";
import "hardhat/console.sol";

/**
 * @title Strata sUSDe redemption worker
 */
contract UnstakeCooldown is IUnstakeCooldown, AccessControlled {

    event Requested(address indexed token, address indexed user, uint256 amount, uint256 unlockAt);
    event Unstaked(address indexed token, address indexed user, uint256 amount);
    event UserProxyCreated(address indexed user, uint256 idx, address proxy);
    event UserProxyImplementationSet(address token, address impl);

    error InvalidTime ();
    error UnsupportedToken(address token);
    error NothingToFinalize ();

    struct TRequest {
        uint64 unlockAt;
        IUnstakeHandler proxy;
    }

    mapping(address token => IUnstakeHandler unstakeImpl) public implementations;

    /**
     * @dev Active request
     */
    mapping(address token => mapping(address account => TRequest[] requests)) public activeRequests;
    mapping(address token => mapping(address account => mapping(uint256 idx => IUnstakeHandler proxy))) public proxies;

    function initialize(
        address owner_,
        address acm_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);
    }

    function transfer(IERC20 token, address to, uint256 amount) external {
        address from = msg.sender;
        if (amount == 0) {
            return;
        }
        address impl = address(implementations[address(token)]);
        if (impl == address(0)) {
            revert UnsupportedToken(address(token));
        }

        TRequest[] storage requests = activeRequests[address(token)][to];

        uint256 i = requests.length;
        IUnstakeHandler proxy = proxies[address(token)][to][i];
        if (address(proxy) == address(0)) {
            proxy = createDeterministicFor(impl, to, i);
            proxies[address(token)][to][i] = proxy;
        }

        SafeERC20.safeTransferFrom(token, from, address(proxy), amount);

        uint256 unlockAt = proxy.request();

        requests.push(TRequest(uint64(unlockAt), proxy));
        emit Requested(address(token), to, amount, unlockAt);
    }

    function finalize(IERC20 token, address user) external returns (uint256 claimed) {
        return finalize(token, user, block.timestamp);
    }
    function finalize(IERC20 token, address user, uint256 at) public returns (uint256 claimed) {
        if (at > block.timestamp) {
            revert InvalidTime();
        }
        TRequest[] storage requests = activeRequests[address(token)][user];

        uint256 len = requests.length;
        for (uint256 i; i < len; ) {
            TRequest memory req = requests[i];
            if (req.unlockAt > at) {
                // still pending
                unchecked { i++; }
                continue;
            }

            claimed += req.proxy.finalize();

            if (i < len - 1) {
                requests[i] = requests[len - 1];
            }
            requests.pop();
            unchecked { len--; }
        }
        if (claimed == 0) {
            revert NothingToFinalize();
        }

        emit Unstaked(address(token), user, claimed);
        return claimed;
    }

    function balanceOf (IERC20 token, address user) external view returns (uint256) {
        return balanceOf(token, user, block.timestamp);
    }

    function balanceOf (IERC20 token, address user, uint256 at) public view returns (uint256) {
        TRequest[] storage requests = activeRequests[address(token)][user];
        uint256 l = requests.length;
        uint256 balance = 0;
        for (uint256 i = 0; i < l; i++) {
            TRequest memory req = requests[i];
            if (req.unlockAt <= at) {
                balance += req.proxy.getPending();
            }
        }
        return balance;
    }

    function createDeterministicFor(address implementation, address user, uint256 idx) internal returns (IUnstakeHandler proxy) {
        proxy = IUnstakeHandler(Clones.cloneDeterministic(implementation, bytes32(idx)));
        proxy.initialize(user);
        emit UserProxyCreated(user, idx, address(proxy));
        return proxy;
    }

    /**
     * @dev Updates the implementations for a tokens. Implementation can be ZERO address in case we want to remove supported token.
     */
    function setImplementations(address[] calldata tokens_, IUnstakeHandler[] calldata implementations_) external onlyOwner {
        uint256 len = tokens_.length;
        for (uint256 i = 0; i < len; ) {
            address token = tokens_[i];
            IUnstakeHandler impl = implementations_[i];
            implementations[token] = impl;
            emit UserProxyImplementationSet(token, address(impl));
            unchecked { i++; }
        }
    }
}
