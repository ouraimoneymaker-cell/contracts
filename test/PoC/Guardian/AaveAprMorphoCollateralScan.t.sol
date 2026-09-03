// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

interface IMorphoBlueCollateralScan {
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
}

interface IAavePoolCollateralScan {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getUserAccountData(address user) external view returns (
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 availableBorrowsBase,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    );
}

contract MorphoAaveOneTokenProbe {
    IMorphoBlueCollateralScan public immutable morpho;
    IAavePoolCollateralScan public immutable aave;
    IERC20 public immutable token;

    bool public supplySucceeded;
    uint256 public collateralBase;
    uint256 public availableBorrowsBase;
    uint256 public ltv;

    constructor(IMorphoBlueCollateralScan morpho_, IAavePoolCollateralScan aave_, IERC20 token_) {
        morpho = morpho_;
        aave = aave_;
        token = token_;
    }

    function run(uint256 amount) external {
        morpho.flashLoan(address(token), amount, bytes(""));
    }

    function onMorphoFlashLoan(uint256 assets, bytes calldata) external {
        require(msg.sender == address(morpho), "only morpho");
        token.approve(address(aave), assets);
        (bool ok,) = address(aave).call(
            abi.encodeWithSelector(IAavePoolCollateralScan.supply.selector, address(token), assets, address(this), uint16(0))
        );
        supplySucceeded = ok;
        if (ok) {
            (collateralBase,,availableBorrowsBase,,ltv,) = aave.getUserAccountData(address(this));
            aave.withdraw(address(token), type(uint256).max, address(this));
        }
        token.approve(address(morpho), assets);
    }
}

contract AaveAprMorphoCollateralScanTest is Test {
    address internal constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address internal constant AAVE_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    address internal constant WETH   = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address internal constant WEETH  = 0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee;
    address internal constant RSETH  = 0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7;
    address internal constant RETH   = 0xae78736Cd615f374D3085123A210448E74Fc6393;
    address internal constant EZETH  = 0xbf5495Efe5DB9ce00f80364C8B423567e58d2110;
    address internal constant WBTC   = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address internal constant CBBTC  = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;

    // Aave account-data base currency is USD with 8 decimals on this deployment.
    uint256 internal constant MIN_THRESHOLD_BORROW_BASE = 44_200_000 * 1e8;
    uint256 internal constant PEAK_BORROW_BASE = 120_000_000 * 1e8;

    function setUp() public {
        vm.createSelectFork(vm.envString("RPC_ETH"));
    }

    function test_scanMorphoBalancesAndAaveCollateralPower() public {
        address[8] memory tokens = [WETH, WSTETH, WEETH, RSETH, RETH, EZETH, WBTC, CBBTC];
        uint256 bestBorrowPower;
        address bestToken;

        for (uint256 i; i < tokens.length; ++i) {
            address tokenAddr = tokens[i];
            IERC20Metadata meta = IERC20Metadata(tokenAddr);
            uint256 morphoBalance = meta.balanceOf(MORPHO_BLUE);
            uint8 decimals = meta.decimals();
            uint256 oneToken = 10 ** uint256(decimals);

            console2.log("--- token ---");
            console2.log("address", tokenAddr);
            console2.log("symbol", meta.symbol());
            console2.log("Morpho balance raw", morphoBalance);
            console2.log("decimals", uint256(decimals));

            if (morphoBalance < oneToken) {
                console2.log("Morpho has less than one whole token; skip Aave probe");
                continue;
            }

            MorphoAaveOneTokenProbe probe = new MorphoAaveOneTokenProbe(
                IMorphoBlueCollateralScan(MORPHO_BLUE),
                IAavePoolCollateralScan(AAVE_POOL),
                IERC20(tokenAddr)
            );

            (bool flashOk,) = address(probe).call(abi.encodeWithSelector(MorphoAaveOneTokenProbe.run.selector, oneToken));
            console2.log("one-token Morpho flash succeeded", flashOk);
            if (!flashOk) continue;

            bool supplyOk = probe.supplySucceeded();
            uint256 collateralBaseOne = probe.collateralBase();
            uint256 borrowBaseOne = probe.availableBorrowsBase();
            uint256 ltv = probe.ltv();

            console2.log("Aave supply succeeded", supplyOk);
            console2.log("one-token collateral value base 1e8", collateralBaseOne);
            console2.log("one-token available borrow base 1e8", borrowBaseOne);
            console2.log("Aave LTV bps", ltv);
            if (!supplyOk || collateralBaseOne == 0 || borrowBaseOne == 0) continue;

            uint256 theoreticalCollateralBase = Math.mulDiv(morphoBalance, collateralBaseOne, oneToken);
            uint256 theoreticalBorrowBase = Math.mulDiv(morphoBalance, borrowBaseOne, oneToken);
            console2.log("Morpho inventory theoretical collateral base 1e8", theoreticalCollateralBase);
            console2.log("Morpho inventory theoretical borrow power base 1e8", theoreticalBorrowBase);
            console2.log("theoretically funds 44.2m threshold", theoreticalBorrowBase >= MIN_THRESHOLD_BORROW_BASE);
            console2.log("theoretically funds 120m peak", theoreticalBorrowBase >= PEAK_BORROW_BASE);

            if (theoreticalBorrowBase > bestBorrowPower) {
                bestBorrowPower = theoreticalBorrowBase;
                bestToken = tokenAddr;
            }
        }

        console2.log("best Morpho collateral token", bestToken);
        console2.log("best theoretical Aave borrow power base 1e8", bestBorrowPower);
        console2.log("any free inventory can fund threshold", bestBorrowPower >= MIN_THRESHOLD_BORROW_BASE);
        console2.log("any free inventory can fund peak", bestBorrowPower >= PEAK_BORROW_BASE);
    }
}
