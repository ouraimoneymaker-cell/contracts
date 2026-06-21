// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlled} from "../../../governance/AccessControlled.sol";
import {IRebalancer, IRebalanceable} from "../../interfaces/IRebalancer.sol";
import {IUnstakeCooldown, ICooldown} from "../../interfaces/cooldown/ICooldown.sol";

// Handles the rebalance flow between strats in a MultiStrategy.
//
// initiateRebalance withdraws from the source strat. If assets arrive immediately
// (e.g. Midas instant redemption), the deposit to the destination strat completes in the
// same transaction. If the withdrawal is deferred (e.g. Ethena cooldown), a PendingRebalance
// is stored; the operator finalises the underlying cooldown externally, then calls
// completeRebalance once the depositToken balance has arrived.
//
// totalAssets reports the baseAssets value locked in pending rebalances so that
// MultiStrategy can include them in its own totalAssets.
contract Rebalancer is IRebalancer, AccessControlled {
    using SafeERC20 for IERC20;

    struct PendingRebalance {
        uint256 fromStratIdx;
        uint256 toStratIdx;
        address withdrawToken;
        address shareToken;     // underlying protocol share token registered in unstakeCooldown (e.g. mHYPER for Midas)
        address depositToken;
        uint256 baseAssets;
        uint256 tokenAmount;
    }

    IRebalanceable public strategy;
    IUnstakeCooldown public unstakeCooldown;

    PendingRebalance[] public pendingRebalances;
    mapping(uint256 => uint256) private _pendingToStrat;

    event RebalanceInitiated(uint256 indexed fromStratIdx, uint256 indexed toStratIdx, uint256 baseAssets);
    event RebalanceCompleted(uint256 indexed fromStratIdx, uint256 indexed toStratIdx, uint256 baseAssets);
    event RebalanceCanceled(uint256 indexed fromStratIdx, uint256 indexed toStratIdx, uint256 baseAssets);

    function initialize(address owner_, address acm_, IRebalanceable strategy_, IUnstakeCooldown unstakeCooldown_) external initializer {
        AccessControlled_init(owner_, acm_);
        strategy = strategy_;
        unstakeCooldown = unstakeCooldown_;
    }

    // Initiates a rebalance from one strat to another.
    // withdrawToken: token to pull from the source strat (must be supported by that strat).
    // depositToken:  token to deposit to the destination strat (may differ if a swap is
    //                needed; for same-base-asset strategies they are the same).
    // baseAssets must not exceed the outstanding debt in the given direction, if any.
    // Detects deferral by checking whether depositToken arrived at this contract after the
    // withdrawal. If not (deferred cooldown), tracks as pending until completeRebalance.
    function initiateRebalance(
        uint256 fromStratIdx,
        uint256 toStratIdx,
        address withdrawToken,
        address depositToken,
        uint256 baseAssets
    ) external onlyRole(UPDATER_STRAT_CONFIG_ROLE) {
        require(fromStratIdx != toStratIdx, "SameStrat");
        (uint256 toJunior, uint256 toSenior) = strategy.debts();

        if (fromStratIdx == 1 && toStratIdx == 0 && toJunior > 0) {
            require(baseAssets <= toJunior, "ExceedsDebt");
        } else if (fromStratIdx == 0 && toStratIdx == 1 && toSenior > 0) {
            require(baseAssets <= toSenior, "ExceedsDebt");
        }

        _initiateRebalance(fromStratIdx, toStratIdx, withdrawToken, depositToken, baseAssets);
    }

    /// @notice Reads the outstanding debt from the strategy and initiates a rebalance for the
    ///         full amount in the correct direction. Caller only needs to supply the tokens.
    function initiateRebalanceByDebt(
        address withdrawToken,
        address depositToken
    ) external onlyRole(UPDATER_STRAT_CONFIG_ROLE) {
        (uint256 toJunior, uint256 toSenior) = strategy.debts();
        require(toJunior > 0 || toSenior > 0, "NoDebt");
        if (toJunior >= toSenior) {
            _initiateRebalance(1, 0, withdrawToken, depositToken, toJunior);
        } else {
            _initiateRebalance(0, 1, withdrawToken, depositToken, toSenior);
        }
    }

    function _initiateRebalance(
        uint256 fromStratIdx,
        uint256 toStratIdx,
        address withdrawToken,
        address depositToken,
        uint256 baseAssets
    ) private {
        // No swap path exists: source and destination use the same base asset; equality prevents stranded funds.
        require(withdrawToken == depositToken, "TokenMismatch");

        uint256 balBefore = IERC20(depositToken).balanceOf(address(this));
        uint256 tokenAmount = strategy.withdrawForRebalance(fromStratIdx, withdrawToken, baseAssets, address(this));
        uint256 received = IERC20(depositToken).balanceOf(address(this)) - balBefore;

        if (received > 0) {
            IERC20(depositToken).forceApprove(address(strategy), received);
            strategy.depositForRebalance(toStratIdx, depositToken, received, baseAssets);

            emit RebalanceCompleted(fromStratIdx, toStratIdx, baseAssets);
        } else {
            address shareToken = strategy.getStratShareToken(fromStratIdx);
            pendingRebalances.push(PendingRebalance({
                fromStratIdx: fromStratIdx,
                toStratIdx: toStratIdx,
                withdrawToken: withdrawToken,
                shareToken: shareToken,
                depositToken: depositToken,
                baseAssets: baseAssets,
                tokenAmount: tokenAmount
            }));
            _pendingToStrat[toStratIdx] += baseAssets;

            emit RebalanceInitiated(fromStratIdx, toStratIdx, baseAssets);
        }
    }

    /// Completes a deferred rebalance: finalises the underlying cooldown so the deposit token
    /// arrives at this contract, then deposits it into the destination strat.
    ///
    /// When multiple pending entries share the same shareToken, a single finalize() call drains
    /// all matured cooldown proxies at once. The first completeRebalance caps its deposit at
    /// pending.baseAssets and leaves the excess in this contract for subsequent calls.
    /// Subsequent calls detect this via balanceOf(shareToken) == 0 (all proxies gone) and skip
    /// finalize, consuming the pre-loaded balance instead.
    ///
    /// @param idx The index of the pending rebalance entry to complete.
    /// @param minAssets The minimum assets expected from the redemption request. Useful in case
    ///        the underlying protocol charges a fee on redemption, ensuring the operator can
    ///        enforce a slippage tolerance.
    function completeRebalance(uint256 idx, uint256 minAssets) external onlyRole(UPDATER_STRAT_CONFIG_ROLE) {
        require(idx < pendingRebalances.length, "InvalidIndex");
        PendingRebalance memory pending = pendingRebalances[idx];

        ICooldown.TBalanceState memory state = unstakeCooldown.balanceOf(
            IERC20(pending.shareToken), address(this)
        );
        if (state.claimable > 0) {
            // Finalize claimable, if any
            unstakeCooldown.finalize(IERC20(pending.shareToken), address(this));
        }

        uint256 available = IERC20(pending.depositToken).balanceOf(address(this));
        require(available >= minAssets, "AssetsNotAvailable");

        uint256 baseAssets = Math.min(available, pending.baseAssets);

        IERC20(pending.depositToken).forceApprove(address(strategy), baseAssets);
        strategy.depositForRebalance(pending.toStratIdx, pending.depositToken, baseAssets, baseAssets);

        // Reduce by the expected pending baseAssets
        _pendingToStrat[pending.toStratIdx] -= pending.baseAssets;

        uint256 last = pendingRebalances.length - 1;
        if (idx < last) {
            pendingRebalances[idx] = pendingRebalances[last];
        }
        pendingRebalances.pop();
        emit RebalanceCompleted(pending.fromStratIdx, pending.toStratIdx, pending.baseAssets);
    }

    /// @notice Cancels a pending rebalance when the underlying redemption is canceled by the protocol.
    /// @dev Recovers share tokens from cooldown proxies, returns them to the source strategy,
    ///      and reverses the pending credit to maintain NAV consistency.
    /// @param idx The index of the pending rebalance to cancel.
    /// @param minShares Minimum share tokens to recover.
    function cancelRebalance(uint256 idx, uint256 minShares) external onlyRole(UPDATER_STRAT_CONFIG_ROLE) {
        PendingRebalance memory pending = pendingRebalances[idx];
        address shareToken = pending.shareToken;
        uint256 fromStratIdx = pending.fromStratIdx;

        // Pull the returned share tokens out of the cooldown proxies into this contract.
        ICooldown.TBalanceState memory state = unstakeCooldown.balanceOf(IERC20(shareToken), address(this));
        if (state.claimable > 0) {
            // Finalize any claimable shares. The minShares check below ensures sufficient recovery.
            unstakeCooldown.finalize(IERC20(shareToken), address(this));
        }
        uint256 recovered = IERC20(shareToken).balanceOf(address(this));
        require(recovered >= minShares, "InsufficientRecovery");

        uint256 tokenAmount = Math.min(recovered, pending.tokenAmount);

        // Return them to the source strat, restoring its (balanceOf-based) totalAssets so the credit
        // reversals below net to zero change in total NAV.
        IERC20(shareToken).safeTransfer(address(strategy.strats(fromStratIdx)), tokenAmount);

        // Reduce by the expected pending baseAssets
        _pendingToStrat[pending.toStratIdx] -= pending.baseAssets;

        uint256 last = pendingRebalances.length - 1;
        if (idx < last) {
            pendingRebalances[idx] = pendingRebalances[last];
        }
        pendingRebalances.pop();
        emit RebalanceCanceled(pending.fromStratIdx, pending.toStratIdx, pending.baseAssets);
    }

    /// @notice Returns the total base assets locked in pending rebalances.
    /// @dev Reports the requested baseAssets amount until completion or cancellation,
    ///      independent of the underlying unstake request status.
    function totalAssets() external view returns (uint256 assets) {
        uint256 len = pendingRebalances.length;
        for (uint256 i = 0; i < len; i++) {
            assets += pendingRebalances[i].baseAssets;
        }
        return assets;
    }

    function pendingCount() external view returns (uint256) {
        return pendingRebalances.length;
    }

    function pendingToStrats() external view returns (uint256 toJunior, uint256 toSenior) {
        return (_pendingToStrat[0], _pendingToStrat[1]);
    }
}
