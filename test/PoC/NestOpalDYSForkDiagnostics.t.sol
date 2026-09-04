// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {StrataCDO} from "../../contracts/tranches/StrataCDO.sol";
import {NestOpalStrategy} from "../../contracts/tranches/strategies/nest/NestOpalStrategy.sol";
import {IStrataCDO} from "../../contracts/tranches/interfaces/IStrataCDO.sol";

interface IBoringVaultHookView {
    function hook() external view returns (address);
}

contract NestOpalDYSForkDiagnostics is Test {
    address constant NOPAL = 0x119Dd7dAFf816f29D7eE47596ae5E4bdC4299165;
    address constant CDO = 0xaE212D8515BA65C719f23dBad6bF73B74d4e4edE;
    address constant STRATEGY = 0x5aeCBb5719a9468CdCfa6673d1DDC1Cf72a5a4aA;
    address constant JRT = 0x1b2b8cFEF0b7B1Fad216b55fefeEb0c3349Da141;
    address constant SRT = 0x8a646Edc4633ADBA5Ec87DedaF3Af958e268FE96;
    address constant REAL_JRT_HOLDER = 0x4be3749a0F6557b8fd98F3967e859DbD7C694eF4;

    function setUp() public {
        vm.createSelectFork(vm.envString("ETH_RPC_URL"));
    }

    function test_Fork_DiagnoseSettlementState() public view {
        StrataCDO cdo = StrataCDO(CDO);
        NestOpalStrategy strategy = NestOpalStrategy(STRATEGY);

        address cooldown = address(strategy.erc20Cooldown());
        address hook = IBoringVaultHookView(NOPAL).hook();
        uint256 strategyBal = IERC20(NOPAL).balanceOf(STRATEGY);
        uint256 allowance = IERC20(NOPAL).allowance(STRATEGY, cooldown);
        uint256 holderBal = IERC20(JRT).balanceOf(REAL_JRT_HOLDER);
        uint32 coveragePpm = cdo.coverage();
        (IStrataCDO.TExitMode mode, uint256 fee, uint32 sharesLock) = cdo.calculateExitMode(JRT, REAL_JRT_HOLDER);

        console2.log("fork block", block.number);
        console2.log("fork timestamp", block.timestamp);
        console2.log("coverage ppm", uint256(coveragePpm));
        console2.log("live JRT NAV", cdo.totalAssets(JRT));
        console2.log("live SRT NAV", cdo.totalAssets(SRT));
        console2.log("real holder JRT shares", holderBal);
        console2.log("JRT exit mode enum", uint256(mode));
        console2.log("JRT exit fee 1e18", fee);
        console2.log("JRT shares lock seconds", uint256(sharesLock));
        console2.log("strategy nOPAL balance", strategyBal);
        console2.log("ERC20 cooldown", cooldown);
        console2.log("strategy->cooldown allowance", allowance);
        console2.log("nOPAL before-transfer hook", hook);

        assertGt(CDO.code.length, 0, "CDO missing");
        assertGt(STRATEGY.code.length, 0, "strategy missing");
        assertGt(JRT.code.length, 0, "JRT missing");
        assertGt(NOPAL.code.length, 0, "nOPAL missing");
        assertGt(cooldown.code.length, 0, "cooldown missing");
        assertGt(strategyBal, 0, "strategy has no nOPAL");
        assertGt(allowance, 0, "strategy has no nOPAL allowance to cooldown");
        assertGt(holderBal, 0, "historical holder has no JRT");
    }
}
