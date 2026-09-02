// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    AaveAprPairProvider internal provider;
    IAavePoolActions internal pool;

    function setUp() public {
        vm.createSelectFork(vm.envString("RPC_ETH"));
        provider = AaveAprPairProvider(DEPLOYED_PROVIDER);
        pool = IAavePoolActions(address(provider.aave()));
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
