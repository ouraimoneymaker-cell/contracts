// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { IUnstakeHandler } from "../../interfaces/cooldown/IUnstakeHandler.sol";
import { IUnstakeCooldown } from "../../interfaces/cooldown/ICooldown.sol";
import { AccessControlled } from "../../../governance/AccessControlled.sol";

/**
 * @title Strata Unstake Cooldown Manager
 */
contract UnstakeCooldown is IUnstakeCooldown, AccessControlled {

    event Requested(address indexed token, address indexed user, uint256 amount, uint256 unlockAt);
    event Unstaked(address indexed token, address indexed user, uint256 amount);
    event UserProxyCreated(address indexed user, address proxy);
    event UserProxyImplementationSet(address token, address impl);

    error InvalidTime ();
    error UnsupportedToken(address token);
    error NothingToFinalize ();

    struct TRequest {
        uint64 unlockAt;
        IUnstakeHandler proxy;
    }

    mapping(address token => IUnstakeHandler unstakeImpl) public implementations;

    /// @dev Active requests
    mapping(address token => mapping(address account => TRequest[] requests)) public activeRequests;

    /// @dev Maintain proxies Pool, after the request is completed, the proxy is returned to the pool
    mapping(address token => mapping(address account => IUnstakeHandler[] proxy)) public proxiesPool;

    function initialize(
        address owner_,
        address acm_
    ) public virtual initializer {
        AccessControlled_init(owner_, acm_);
    }

    function transfer(IERC20 token, address to, uint256 amount) external onlyRole(COOLDOWN_WORKER_ROLE) {
        address from = msg.sender;
        if (amount == 0) {
            return;
        }
        address impl = address(implementations[address(token)]);
        if (impl == address(0)) {
            revert UnsupportedToken(address(token));
        }

        TRequest[] storage requests = activeRequests[address(token)][to];
        IUnstakeHandler[] storage proxies = proxiesPool[address(token)][to];

        IUnstakeHandler proxy;
        uint256 len = proxies.length;
        if (len > 0) {
            proxy = IUnstakeHandler(proxies[len - 1]);
            proxies.pop();
            if (impl != getImplementation(address(proxy))) {
                proxy = createFor(impl, to);
            }
        } else {
            proxy = createFor(impl, to);
        }


        SafeERC20.safeTransferFrom(token, from, address(proxy), amount);

        uint256 unlockAt = proxy.request();
        if (unlockAt <= block.timestamp) {
            // Already transfered, return proxy to pool and exit
            proxies.push(proxy);
            return;
        }
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
        IUnstakeHandler[] storage proxies = proxiesPool[address(token)][user];
        IUnstakeHandler imp = implementations[address(token)];

        // Emergency exit: check the underlying protocol if the cooldown is still active
        bool isCooldownActive = imp.isCooldownActive();
        uint256 len = requests.length;
        for (uint256 i; i < len; ) {
            TRequest memory req = requests[i];
            if (req.unlockAt > at && isCooldownActive) {
                // Still pending
                unchecked { i++; }
                continue;
            }

            claimed += req.proxy.finalize();
            // Return proxy to the pool (reuse later)
            proxies.push(req.proxy);

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

    function balanceOf (IERC20 token, address user) external view returns (TBalanceState memory) {
        return balanceOf(token, user, block.timestamp);
    }

    function balanceOf (IERC20 token, address user, uint256 at) public view returns (TBalanceState memory) {
        TRequest[] storage requests = activeRequests[address(token)][user];
        IUnstakeHandler imp = implementations[address(token)];
        bool isCooldownActive = imp.isCooldownActive();

        uint256 l = requests.length;

        uint256 pending;
        uint256 claimable;
        uint256 nextUnlockAt;
        uint256 nextUnlockAmount;

        for (uint256 i; i < l; i++) {
            TRequest memory req = requests[i];
            uint256 amount = req.proxy.getPendingAmount();
            if (req.unlockAt > at && isCooldownActive) {
                pending += amount;
                if (nextUnlockAt == 0 || req.unlockAt < nextUnlockAt) {
                    nextUnlockAt = req.unlockAt;
                    nextUnlockAmount = amount;
                    continue;
                }
                if (req.unlockAt == nextUnlockAt) {
                    nextUnlockAmount += amount;
                }
                continue;
            }
            claimable += amount;
        }
        return TBalanceState({
            pending: pending,
            claimable: claimable,
            nextUnlockAt: nextUnlockAt,
            nextUnlockAmount: nextUnlockAmount
        });
    }

    function createFor(address implementation, address user) internal returns (IUnstakeHandler proxy) {
        proxy = IUnstakeHandler(Clones.clone(implementation, 0));
        proxy.initialize(address(this), user);
        emit UserProxyCreated(user, address(proxy));
        return proxy;
    }

    /**
     * @dev Updates the implementations for tokens. Implementation can be ZERO address in case we want to remove supported token.
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

    function getImplementation(address proxy) internal view returns (address implementation) {
        assembly {
            // Clones.clone := 0x363d3d373d3d3d363d73<20-byte implementation>5af43d82803e903d91602b57fd5bf3
            let ptr := mload(0x40)
            extcodecopy(proxy, ptr, 10, 32)
            implementation := shr(96, mload(ptr)) // right-shift to 20 bytes
        }
    }
}
