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
import { IsUSDe } from "../../../contracts/tranches/strategies/ethena/IsUSDe.sol";

interface IAavePoolActions {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external;
    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256);
}

/// @notice Mainnet-fork-only diagnostics. They never transact against production.
/// The tests measure whether ordinary external protocol actions can move the APR values
/// consumed by Strata's stale-feed fallback, and whether those external actions can unwind.
contract AaveAprProviderForkSensitivityTest is Test {
    address internal constant DEPLOYED_PROVIDER = 0x1c137776e04803F807616c382AbBA12d9BF0AF73;
    address internal constant DEPLOYED_FEED = 0x2bb416614D740E5313aA64A0E3e419B39e800EC2;
    address internal constant DEPLOYED_ACCOUNTING = 0xa436c5Dd1Ba62c55D112C10cd10E988bb3355102;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    bytes4 internal constant ERC4626_REDEEM_SELECTOR = bytes4(keccak256("redeem(uint256,address,address)"));

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

    function _assertRestoredVeryClosely(uint256 beforeValue, uint256 afterValue, uint256 movedAbs) internal pure {
        uint256 residualAbs = afterValue > beforeValue ? afterValue - beforeValue : beforeValue - afterValue;
        uint256 tolerance = movedAbs / 1_000 + 10_000;
        assertLe(residualAbs, tolerance, "external APR source did not restore closely after cleanup");
    }

    function _tryMeasureAaveSupply(uint256 marketIndex, uint256 amount)
        internal
        returns (bool success, uint256 movedAbs)
    {
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

        console2.log("Aave market", marketIndex);
        console2.log("temporary benchmark supply", amount);
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
        _assertRestoredVeryClosely(targetBefore, targetAfter, movedAbs);
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
                (bool ok, uint256 moveAbs) = _tryMeasureAaveSupply(market, notionals[i]);
                if (!ok) continue;
                successfulMeasurements += 1;
                if (moveAbs > maxMove) maxMove = moveAbs;
            }
        }

        assertGt(successfulMeasurements, 0, "no benchmark supply size was accepted on fork");
        assertGt(maxMove, 0, "deployed provider was insensitive to unprivileged Aave supply");
    }

    function _fundCollateral(uint256 amount) internal {
        deal(WETH, address(this), amount);
        IERC20(WETH).approve(address(pool), type(uint256).max);
        pool.supply(WETH, amount, address(this), 0);
    }

    function _borrowRaw(uint256 marketIndex, uint256 amount) internal returns (bool success) {
        address token = provider.benchmarkTokens(marketIndex);
        (success,) = address(pool).call(
            abi.encodeWithSelector(
                IAavePoolActions.borrow.selector,
                token,
                amount,
                uint256(2),
                uint16(0),
                address(this)
            )
        );
    }

    function _repayAll(uint256 marketIndex) internal returns (uint256 repaid) {
        address token = provider.benchmarkTokens(marketIndex);
        uint256 repaymentBalance = IERC20(token).balanceOf(address(this));
        deal(token, address(this), repaymentBalance + 1_000_000);
        IERC20(token).approve(address(pool), type(uint256).max);
        repaid = pool.repay(token, type(uint256).max, 2, address(this));
    }

    function _tryMeasureAaveBorrow(uint256 marketIndex, uint256 amount)
        internal
        returns (bool success, uint256 movedUp)
    {
        uint256 targetBefore = uint256(uint64(provider.getAPRtarget()));
        uint256 collateralAmount = 100_000 ether;

        _fundCollateral(collateralAmount);
        success = _borrowRaw(marketIndex, amount);
        if (!success) {
            console2.log("borrow rejected market", marketIndex);
            console2.log("borrow amount", amount);
            pool.withdraw(WETH, type(uint256).max, address(this));
            return (false, 0);
        }

        uint256 targetDuring = uint256(uint64(provider.getAPRtarget()));
        movedUp = targetDuring > targetBefore ? targetDuring - targetBefore : 0;

        console2.log("Aave borrow market", marketIndex);
        console2.log("temporary benchmark borrow", amount);
        console2.log("Strata target before borrow (1e12)", targetBefore);
        console2.log("Strata target during borrow (1e12)", targetDuring);
        console2.log("upward target move (1e12)", movedUp);

        uint256 repaid = _repayAll(marketIndex);
        assertGt(repaid, 0, "fork cleanup repaid nothing");
        uint256 collateralOut = pool.withdraw(WETH, type(uint256).max, address(this));
        assertGt(collateralOut, 0, "fork cleanup withdrew no WETH collateral");

        uint256 targetAfter = uint256(uint64(provider.getAPRtarget()));
        console2.log("Strata target after borrow cleanup (1e12)", targetAfter);
        if (movedUp > 0) _assertRestoredVeryClosely(targetBefore, targetAfter, movedUp);
    }

    function test_deployedProviderRespondsToTemporaryBenchmarkBorrow() public {
        uint256[5] memory notionals = [
            uint256(1_000_000e6),
            uint256(10_000_000e6),
            uint256(50_000_000e6),
            uint256(100_000_000e6),
            uint256(150_000_000e6)
        ];

        Accounting accounting = Accounting(DEPLOYED_ACCOUNTING);
        uint256 liveSeniorApr12 = UD60x18.unwrap(accounting.aprSrt()) / 1e6;
        uint256 maxTargetDuring;
        uint256 successfulMeasurements;

        console2.log("live stored Senior APR threshold (1e12)", liveSeniorApr12);

        for (uint256 market; market < 2; ++market) {
            for (uint256 i; i < notionals.length; ++i) {
                (bool ok, uint256 movedUp) = _tryMeasureAaveBorrow(market, notionals[i]);
                if (!ok) continue;
                successfulMeasurements += 1;
                uint256 targetNow = uint256(uint64(provider.getAPRtarget()));
                uint256 peak = targetNow + movedUp;
                if (peak > maxTargetDuring) maxTargetDuring = peak;
            }
        }

        assertGt(successfulMeasurements, 0, "no benchmark borrow size was accepted on fork");
        assertGt(maxTargetDuring, uint256(uint64(provider.getAPRtarget())), "borrowing never raised Strata target");
        console2.log("max temporary Strata target observed (1e12)", maxTargetDuring);
        console2.log("temporary target crossed live Senior APR", maxTargetDuring > liveSeniorApr12);
    }

    function test_nearDrainUsdcBorrowBracketsLiveSeniorAprThreshold() public {
        uint256[6] memory notionals = [
            uint256(120_000_000e6),
            uint256(130_000_000e6),
            uint256(140_000_000e6),
            uint256(145_000_000e6),
            uint256(147_000_000e6),
            uint256(148_000_000e6)
        ];

        uint256 liveSeniorApr12 = UD60x18.unwrap(Accounting(DEPLOYED_ACCOUNTING).aprSrt()) / 1e6;
        uint256 maxPeak;
        uint256 maxAccepted;

        console2.log("near-drain live Senior APR threshold (1e12)", liveSeniorApr12);

        for (uint256 i; i < notionals.length; ++i) {
            (bool ok, uint256 movedUp) = _tryMeasureAaveBorrow(0, notionals[i]);
            if (!ok) continue;
            uint256 restored = uint256(uint64(provider.getAPRtarget()));
            uint256 peak = restored + movedUp;
            maxAccepted = notionals[i];
            if (peak > maxPeak) maxPeak = peak;
            console2.log("near-drain USDC accepted", notionals[i]);
            console2.log("near-drain reconstructed peak target (1e12)", peak);
            console2.log("near-drain crossed Senior APR", peak > liveSeniorApr12);
        }

        assertGt(maxAccepted, 0, "no near-drain USDC borrow was accepted");
        console2.log("largest accepted near-drain USDC borrow", maxAccepted);
        console2.log("maximum near-drain target (1e12)", maxPeak);
        console2.log("maximum near-drain target crossed Senior APR", maxPeak > liveSeniorApr12);
    }

    function test_combinedNearDrainBenchmarkBorrowCanCrossLiveSeniorApr() public {
        uint256 targetBefore = uint256(uint64(provider.getAPRtarget()));
        uint256 liveSeniorApr12 = UD60x18.unwrap(Accounting(DEPLOYED_ACCOUNTING).aprSrt()) / 1e6;
        uint256 collateralAmount = 150_000 ether;

        _fundCollateral(collateralAmount);

        uint256[3] memory usdcCandidates = [uint256(145_000_000e6), uint256(140_000_000e6), uint256(130_000_000e6)];
        uint256 usdcBorrowed;
        for (uint256 i; i < usdcCandidates.length; ++i) {
            if (_borrowRaw(0, usdcCandidates[i])) {
                usdcBorrowed = usdcCandidates[i];
                break;
            }
        }
        assertGt(usdcBorrowed, 0, "combined probe could not borrow USDC");

        uint256 targetAfterUsdc = uint256(uint64(provider.getAPRtarget()));

        uint256[4] memory usdtCandidates = [
            uint256(40_000_000e6),
            uint256(30_000_000e6),
            uint256(20_000_000e6),
            uint256(10_000_000e6)
        ];
        uint256 usdtBorrowed;
        for (uint256 i; i < usdtCandidates.length; ++i) {
            if (_borrowRaw(1, usdtCandidates[i])) {
                usdtBorrowed = usdtCandidates[i];
                break;
            }
        }
        assertGt(usdtBorrowed, 0, "combined probe could not borrow USDT");

        uint256 targetCombined = uint256(uint64(provider.getAPRtarget()));

        console2.log("combined target before (1e12)", targetBefore);
        console2.log("combined live Senior APR threshold (1e12)", liveSeniorApr12);
        console2.log("combined USDC borrowed", usdcBorrowed);
        console2.log("target after USDC borrow (1e12)", targetAfterUsdc);
        console2.log("combined USDT borrowed", usdtBorrowed);
        console2.log("combined target during both borrows (1e12)", targetCombined);
        console2.log("combined target crossed live Senior APR", targetCombined > liveSeniorApr12);

        assertGt(targetCombined, targetBefore, "combined benchmark borrowing did not raise target");

        uint256 repaidUsdt = _repayAll(1);
        uint256 repaidUsdc = _repayAll(0);
        assertGt(repaidUsdt, 0, "combined cleanup repaid no USDT");
        assertGt(repaidUsdc, 0, "combined cleanup repaid no USDC");
        uint256 collateralOut = pool.withdraw(WETH, type(uint256).max, address(this));
        assertGt(collateralOut, 0, "combined cleanup withdrew no WETH collateral");

        uint256 targetAfter = uint256(uint64(provider.getAPRtarget()));
        uint256 movedUp = targetCombined - targetBefore;
        console2.log("combined target after cleanup (1e12)", targetAfter);
        _assertRestoredVeryClosely(targetBefore, targetAfter, movedUp);
    }

    function test_liveSusdeDepositCanMoveBaseAprAndChecksUnwindability() public {
        IsUSDe vault = provider.sUSDe();
        address asset = vault.asset();

        uint256 baseBefore = uint256(uint64(provider.getAPRbase()));
        uint256 totalAssetsBefore = vault.totalAssets();
        uint256 cooldownDuration = vault.cooldownDuration();
        uint256 amount = 100_000_000e18;

        console2.log("sUSDe cooldown duration", cooldownDuration);
        console2.log("sUSDe totalAssets before", totalAssetsBefore);
        console2.log("Strata base APR before (1e12)", baseBefore);

        deal(asset, address(this), amount);
        IERC20(asset).approve(address(vault), type(uint256).max);

        uint256 shares = vault.deposit(amount, address(this));
        assertGt(shares, 0, "sUSDe deposit minted no shares");

        uint256 baseDuring = uint256(uint64(provider.getAPRbase()));
        uint256 movedAbs = baseDuring > baseBefore ? baseDuring - baseBefore : baseBefore - baseDuring;

        console2.log("temporary USDe deposit", amount);
        console2.log("sUSDe shares minted", shares);
        console2.log("Strata base APR during (1e12)", baseDuring);
        console2.log("absolute base APR move (1e12)", movedAbs);
        assertGt(movedAbs, 0, "sUSDe deposit did not move Strata base APR");

        (bool redeemed, bytes memory returndata) = address(vault).call(
            abi.encodeWithSelector(ERC4626_REDEEM_SELECTOR, shares, address(this), address(this))
        );

        console2.log("same-transaction standard redeem succeeded", redeemed);
        if (!redeemed) {
            console2.log("same-transaction redeem blocked; cooldown/capital lock must be priced into exploitability");
            return;
        }

        uint256 assetsOut = abi.decode(returndata, (uint256));
        assertGt(assetsOut, 0, "sUSDe cleanup redeemed no assets");

        uint256 baseAfter = uint256(uint64(provider.getAPRbase()));
        console2.log("Strata base APR after cleanup (1e12)", baseAfter);
        _assertRestoredVeryClosely(baseBefore, baseAfter, movedAbs);
    }
}
