// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UD60x18 } from "@prb/math/src/ud60x18/ValueType.sol";

import { Accounting } from "../../../contracts/tranches/Accounting.sol";
import { AprPairFeed } from "../../../contracts/tranches/oracles/AprPairFeed.sol";
import { IAprPairFeed } from "../../../contracts/tranches/interfaces/IAprPairFeed.sol";
import {
    AaveAprPairProvider,
    IAavePool
} from "../../../contracts/tranches/strategies/ethena/AaveAprPairProvider.sol";

interface IAavePoolActions {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// @notice Mainnet-fork-only diagnostic. It does not transact against production.
/// It measures how much the deployed Strata Aave APR provider moves when an ordinary
/// Aave supplier temporarily changes benchmark liquidity and aToken supply.
contract AaveAprProviderForkSensitivityTest is Test {
    address internal constant DEPLOYED_PROVIDER = 0x1c137776e04803F807616c382AbBA12d9BF0AF73;
    address internal constant DEPLOYED_FEED = 0x2bb416614D740E5313aA64A0E3e419B39e800EC2;
    address internal constant DEPLOYED_ACCOUNTING = 0xa436c5Dd1Ba62c55D112C10cd10E988bb3355102;

    AaveAprPairProvider internal provider;
    IAavePoolActions internal pool;

    function setUp() public {
        vm.createSelectFork(vm.envString("RPC_ETH"));
        provider = AaveAprPairProvider(DEPLOYED_PROVIDER);
        pool = IAavePoolActions(address(provider.aave()));
    }

    function test_liveStrataFeedStateAndFallbackBoundary() public {
        AprPairFeed feed = AprPairFeed(DEPLOYED_FEED);
        Accounting accounting = Accounting(DEPLOYED_ACCOUNTING);

        assertEq(address(feed.provider()), DEPLOYED_PROVIDER, "deployed feed/provider mismatch");

        (
            int64 pushedTarget,
            int64 pushedBase,
            uint64 pushedUpdatedAt,
            uint64 pushedRoundId
        ) = feed.latestRound();

        IAprPairFeed.TRound memory effectiveNow = feed.latestRoundData();
        int64 providerTargetNow = provider.getAPRtarget();
        int64 providerBaseNow = provider.getAPRbase();
        uint256 staleAfter = feed.roundStaleAfter();
        uint256 sourceMode = uint256(feed.sourcePref());
        uint256 storedTarget = UD60x18.unwrap(accounting.aprTarget());
        uint256 storedBase = UD60x18.unwrap(accounting.aprBase());
        uint256 storedSeniorApr = UD60x18.unwrap(accounting.aprSrt());

        console2.log("fork timestamp", block.timestamp);
        console2.log("feed source mode (0=Feed,1=Strategy)", sourceMode);
        console2.log("feed stale after seconds", staleAfter);
        console2.log("pushed target (1e12)", uint256(uint64(pushedTarget)));
        console2.log("pushed base (1e12)", pushedBase >= 0 ? uint256(uint64(pushedBase)) : 0);
        console2.log("pushed updatedAt", pushedUpdatedAt);
        console2.log("pushed round id", pushedRoundId);
        console2.log("effective target now (1e12)", uint256(uint64(effectiveNow.aprTarget)));
        console2.log("provider target now (1e12)", uint256(uint64(providerTargetNow)));
        console2.log("provider base now (1e12)", providerBaseNow >= 0 ? uint256(uint64(providerBaseNow)) : 0);
        console2.log("Accounting stored target (1e18)", storedTarget);
        console2.log("Accounting stored base (1e18)", storedBase);
        console2.log("Accounting stored Senior APR (1e18)", storedSeniorApr);
        console2.log("target floor currently binding", storedSeniorApr == storedTarget);

        // Force only the fork clock beyond the pushed-round freshness boundary.
        // This proves what the live feed will return after its documented stale period
        // without sending a transaction to Ethereum.
        if (sourceMode == uint256(AprPairFeed.ESourcePref.Feed)) {
            uint256 staleAt = uint256(pushedUpdatedAt) + staleAfter + 1;
            if (block.timestamp < staleAt) vm.warp(staleAt);
        }

        IAprPairFeed.TRound memory effectiveAfterBoundary = feed.latestRoundData();
        int64 providerTargetAfterBoundary = provider.getAPRtarget();
        assertEq(
            effectiveAfterBoundary.aprTarget,
            providerTargetAfterBoundary,
            "stale/strategy feed did not resolve to live Aave provider target"
        );
    }

    function _tryMeasure(uint256 marketIndex, uint256 amount) internal returns (bool success, uint256 movedAbs) {
        address token = provider.benchmarkTokens(marketIndex);
        (uint256 marketAprBefore, uint256 marketSupplyBefore) = provider.getAaveAsset(marketIndex);
        uint256 targetBefore = uint256(uint64(provider.getAPRtarget()));

        deal(token, address(this), amount);
        IERC20(token).approve(address(pool), type(uint256).max);

        (success,) = address(pool).call(
            abi.encodeWithSelector(
                IAavePoolActions.supply.selector,
                token,
                amount,
                address(this),
                uint16(0)
            )
        );
        if (!success) {
            console2.log("supply rejected market", marketIndex);
            console2.log("amount", amount);
            return (false, 0);
        }

        (uint256 marketAprDuring, uint256 marketSupplyDuring) = provider.getAaveAsset(marketIndex);
        uint256 targetDuring = uint256(uint64(provider.getAPRtarget()));

        movedAbs = targetDuring > targetBefore ? targetDuring - targetBefore : targetBefore - targetDuring;

        console2.log("market", marketIndex);
        console2.log("temporary supply", amount);
        console2.log("market APR before (1e12)", marketAprBefore);
        console2.log("market APR during (1e12)", marketAprDuring);
        console2.log("market supply before", marketSupplyBefore);
        console2.log("market supply during", marketSupplyDuring);
        console2.log("Strata target before (1e12)", targetBefore);
        console2.log("Strata target during (1e12)", targetDuring);
        console2.log("absolute target move (1e12)", movedAbs);

        uint256 withdrawn = pool.withdraw(token, type(uint256).max, address(this));
        assertGt(withdrawn, 0, "fork cleanup withdrew nothing");

        uint256 targetAfter = uint256(uint64(provider.getAPRtarget()));
        console2.log("Strata target after cleanup (1e12)", targetAfter);

        // Same-block cleanup should restore the benchmark very closely; one unit of
        // 1e12 precision is allowed for Aave index/rate rounding.
        assertApproxEqAbs(targetAfter, targetBefore, 1, "Aave target did not restore after cleanup");
    }

    function test_deployedProviderRespondsToTemporaryBenchmarkSupply() public {
        uint256[4] memory notionals = [
            uint256(1_000_000e6),
            uint256(10_000_000e6),
            uint256(50_000_000e6),
            uint256(100_000_000e6)
        ];

        uint256 successfulMeasurements;
        uint256 maxMove;

        for (uint256 market; market < 2; ++market) {
            for (uint256 i; i < notionals.length; ++i) {
                (bool ok, uint256 moveAbs) = _tryMeasure(market, notionals[i]);
                if (!ok) continue;
                successfulMeasurements += 1;
                if (moveAbs > maxMove) maxMove = moveAbs;
            }
        }

        assertGt(successfulMeasurements, 0, "no benchmark supply size was accepted on fork");
        assertGt(maxMove, 0, "deployed provider was insensitive to unprivileged Aave supply");
    }
}
