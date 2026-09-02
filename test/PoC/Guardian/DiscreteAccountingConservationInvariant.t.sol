// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { AccessControlManager } from "../../../contracts/governance/AccessControlManager.sol";
import { StrataCDO } from "../../../contracts/tranches/StrataCDO.sol";
import { Tranche } from "../../../contracts/tranches/Tranche.sol";
import { Accounting } from "../../../contracts/tranches/Accounting.sol";
import { DiscreteAccounting } from "../../../contracts/tranches/DiscreteAccounting.sol";
import { MockERC20 } from "../../../contracts/test/MockERC20.sol";
import { IAccounting } from "../../../contracts/tranches/interfaces/IAccounting.sol";
import { IAprPairFeed } from "../../../contracts/tranches/interfaces/IAprPairFeed.sol";
import { IStrategy } from "../../../contracts/tranches/interfaces/IStrategy.sol";
import { IStrataCDO } from "../../../contracts/tranches/interfaces/IStrataCDO.sol";
import { ITranche } from "../../../contracts/tranches/interfaces/ITranche.sol";

contract ConservationAprFeed is IAprPairFeed {
    TRound internal round;

    constructor(int64 aprTarget, int64 aprBase) {
        round = TRound({
            aprTarget: aprTarget,
            aprBase: aprBase,
            updatedAt: uint64(block.timestamp),
            answeredInRound: 1
        });
    }

    function set(int64 aprTarget, int64 aprBase) external {
        round.aprTarget = aprTarget;
        round.aprBase = aprBase;
        round.updatedAt = uint64(block.timestamp);
        round.answeredInRound += 1;
    }

    function updateRoundData(int64 aprTarget, int64 aprBase, uint64 timestamp) external {
        round.aprTarget = aprTarget;
        round.aprBase = aprBase;
        round.updatedAt = timestamp;
        round.answeredInRound += 1;
    }

    function decimals() external pure returns (uint8) {
        return 12;
    }

    function description() external pure returns (string memory) {
        return "Conservation APR feed";
    }

    function getRoundData(uint64) external view returns (TRound memory) {
        return round;
    }

    function latestRoundData() external view returns (TRound memory) {
        return round;
    }
}

/// @dev Deliberately simple 1:1 strategy whose reported NAV changes only when this
///      harness explicitly changes it. There is no implicit yield.
contract ConservationStrategy is IStrategy {
    IERC20 public immutable baseAsset;
    address public immutable cdoAddress;
    uint256 public reportedAssets;

    modifier onlyCDO() {
        require(msg.sender == cdoAddress, "CDO only");
        _;
    }

    constructor(IERC20 baseAsset_, address cdo_) {
        baseAsset = baseAsset_;
        cdoAddress = cdo_;
    }

    function getCDOAddress() external view returns (address) {
        return cdoAddress;
    }

    function deposit(
        address,
        address token,
        uint256 tokenAmount,
        uint256 baseAssets,
        address owner
    ) external onlyCDO returns (uint256) {
        require(token == address(baseAsset), "unsupported token");
        require(baseAsset.transferFrom(owner, address(this), tokenAmount), "transferFrom");
        reportedAssets += baseAssets;
        return baseAssets;
    }

    function withdraw(
        address tranche,
        address token,
        uint256 tokenAmount,
        uint256 baseAssets,
        address sender,
        address receiver
    ) external onlyCDO returns (uint256) {
        return _withdraw(tranche, token, tokenAmount, baseAssets, sender, receiver);
    }

    function withdraw(
        address tranche,
        address token,
        uint256 tokenAmount,
        uint256 baseAssets,
        address sender,
        address receiver,
        bool
    ) external onlyCDO returns (uint256) {
        return _withdraw(tranche, token, tokenAmount, baseAssets, sender, receiver);
    }

    function _withdraw(
        address,
        address token,
        uint256 tokenAmount,
        uint256 baseAssets,
        address,
        address receiver
    ) internal returns (uint256) {
        require(token == address(baseAsset), "unsupported token");
        reportedAssets -= baseAssets;
        require(baseAsset.transfer(receiver, tokenAmount), "transfer");
        return baseAssets;
    }

    function totalAssets() external view returns (uint256) {
        return reportedAssets;
    }

    function totalAssets(uint256, uint256) external view returns (uint256) {
        return reportedAssets;
    }

    function reduceReserve(address token, uint256 tokenAmount, address receiver) external onlyCDO {
        require(token == address(baseAsset), "unsupported token");
        reportedAssets -= tokenAmount;
        require(baseAsset.transfer(receiver, tokenAmount), "transfer");
    }

    function convertToAssets(address token, uint256 tokenAmount, Math.Rounding)
        external
        view
        returns (uint256)
    {
        require(token == address(baseAsset), "unsupported token");
        return tokenAmount;
    }

    function convertToTokens(address token, uint256 baseAssets, Math.Rounding)
        external
        view
        returns (uint256)
    {
        require(token == address(baseAsset), "unsupported token");
        return baseAssets;
    }

    function getSupportedTokens() external view returns (IERC20[] memory tokens) {
        tokens = new IERC20[](1);
        tokens[0] = baseAsset;
    }

    function ensureRedeemable(address, address token, uint256) external view {
        require(token == address(baseAsset), "unsupported token");
    }

    function depositFeeBps(address tokenIn) external view returns (uint256) {
        require(tokenIn == address(baseAsset), "unsupported token");
        return 0;
    }

    /// @dev Models a genuine strategy loss in accounting terms. The physical mock
    ///      token balance is intentionally left untouched; CDO accounting limits
    ///      redemptions to reported NAV.
    function reportLoss(uint256 amount) external {
        if (amount > reportedAssets) amount = reportedAssets;
        reportedAssets -= amount;
    }

    /// @dev Legitimate yield is explicit and separately observable by the harness.
    function reportYield(uint256 amount) external {
        MockERC20(address(baseAsset)).mint(address(this), amount);
        reportedAssets += amount;
    }
}

struct ConservationStack {
    MockERC20 asset;
    AccessControlManager acm;
    StrataCDO cdo;
    Tranche jrt;
    Tranche srt;
    IAccounting accounting;
    ConservationStrategy strategy;
    ConservationAprFeed feed;
}

abstract contract EconomicConservationBase is Test {
    uint256 internal constant WAD = 1e18;
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    address internal owner;
    address internal alice;
    address internal bob;

    function _newStack(bool discrete) internal returns (ConservationStack memory s) {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        s.asset = new MockERC20("BASE", 18);
        s.acm = new AccessControlManager(owner);
        s.feed = new ConservationAprFeed(0, 100_000_000_000); // 10% base APR, 12 decimals

        vm.startPrank(owner);

        StrataCDO cdoImpl = new StrataCDO(IERC20Metadata(address(s.asset)));
        s.cdo = StrataCDO(
            address(
                new ERC1967Proxy(
                    address(cdoImpl),
                    abi.encodeWithSelector(StrataCDO.initialize.selector, owner, address(s.acm))
                )
            )
        );

        Tranche trancheImpl = new Tranche();
        s.jrt = Tranche(
            address(
                new ERC1967Proxy(
                    address(trancheImpl),
                    abi.encodeWithSelector(
                        Tranche.initialize.selector,
                        owner,
                        address(s.acm),
                        "Junior Tranche",
                        "JRT",
                        IERC20(address(s.asset)),
                        IStrataCDO(address(s.cdo))
                    )
                )
            )
        );
        s.srt = Tranche(
            address(
                new ERC1967Proxy(
                    address(trancheImpl),
                    abi.encodeWithSelector(
                        Tranche.initialize.selector,
                        owner,
                        address(s.acm),
                        "Senior Tranche",
                        "SRT",
                        IERC20(address(s.asset)),
                        IStrataCDO(address(s.cdo))
                    )
                )
            )
        );

        if (discrete) {
            DiscreteAccounting impl = new DiscreteAccounting(18);
            s.accounting = IAccounting(
                address(
                    new ERC1967Proxy(
                        address(impl),
                        abi.encodeWithSelector(
                            DiscreteAccounting.initialize.selector,
                            owner,
                            address(s.acm),
                            IStrataCDO(address(s.cdo)),
                            IAprPairFeed(address(s.feed))
                        )
                    )
                )
            );
        } else {
            Accounting impl = new Accounting(18);
            s.accounting = IAccounting(
                address(
                    new ERC1967Proxy(
                        address(impl),
                        abi.encodeWithSelector(
                            Accounting.initialize.selector,
                            owner,
                            address(s.acm),
                            IStrataCDO(address(s.cdo)),
                            IAprPairFeed(address(s.feed))
                        )
                    )
                )
            );
        }

        s.strategy = new ConservationStrategy(IERC20(address(s.asset)), address(s.cdo));

        s.cdo.configure(
            s.accounting,
            IStrategy(address(s.strategy)),
            ITranche(address(s.jrt)),
            ITranche(address(s.srt))
        );

        s.acm.grantRole(PAUSER_ROLE, owner);
        s.cdo.setActionStates(address(0), true, true);

        vm.stopPrank();
    }

    function _deposit(ConservationStack memory s, address actor, Tranche vault, uint256 amount)
        internal
        returns (uint256 shares)
    {
        s.asset.mint(actor, amount);
        vm.startPrank(actor);
        s.asset.approve(address(vault), type(uint256).max);
        shares = vault.deposit(amount, actor);
        vm.stopPrank();
    }
}

/// @notice Deterministic differential PoC for the conservation boundary.
contract DiscreteProjectedWithdrawalPoC is EconomicConservationBase {
    function test_AccountingDoesNotCashOutUnrealizedYield() public {
        ConservationStack memory s = _newStack(false);

        _deposit(s, alice, s.srt, 10e18);
        _deposit(s, bob, s.srt, 10e18);
        _deposit(s, alice, s.jrt, 900e18);
        uint256 bobShares = _deposit(s, bob, s.jrt, 100e18);

        vm.warp(block.timestamp + 365 days);

        uint256 bobBefore = s.asset.balanceOf(bob);
        vm.prank(bob);
        uint256 payout = s.jrt.redeem(bobShares, bob, bob);
        uint256 bobAfter = s.asset.balanceOf(bob);

        assertEq(bobAfter - bobBefore, payout);
        assertLe(payout, 100e18 + 2, "continuous accounting created cashable no-yield profit");
    }

    function test_DiscreteProjectedYieldIsCashableBeforeStrategyRealizesYield() public {
        ConservationStack memory s = _newStack(true);
        DiscreteAccounting discrete = DiscreteAccounting(address(s.accounting));

        uint256 aliceDeposit = 900e18;
        uint256 bobDeposit = 100e18;
        uint256 seniorSeed = 20e18;
        uint256 initialPhysicalNav = aliceDeposit + bobDeposit + seniorSeed;

        _deposit(s, alice, s.srt, 10e18);
        _deposit(s, bob, s.srt, 10e18);
        _deposit(s, alice, s.jrt, aliceDeposit);
        uint256 bobShares = _deposit(s, bob, s.jrt, bobDeposit);

        // No call to reportYield() occurs anywhere in this test. Both the strategy's
        // reported NAV and its physical token balance stay exactly flat for one year.
        assertEq(s.strategy.reportedAssets(), initialPhysicalNav, "unexpected initial strategy NAV");
        assertEq(s.asset.balanceOf(address(s.strategy)), initialPhysicalNav, "unexpected initial token balance");

        vm.warp(block.timestamp + 365 days);

        assertEq(s.strategy.reportedAssets(), initialPhysicalNav, "strategy realized yield unexpectedly");
        assertEq(
            s.asset.balanceOf(address(s.strategy)),
            initialPhysicalNav,
            "strategy physically received yield unexpectedly"
        );

        // ---- Load-bearing mismatch -------------------------------------------------
        // Stored/T0 JRT is real accounted Junior NAV. The view-time totalAssets()
        // path may project JRT forward even though strategy NAV is unchanged.
        (uint256 realJrt,,) = discrete.totalAssetsT0();
        (uint256 projectedJrt,,) = discrete.totalAssets();

        uint256 bobPreview = s.jrt.previewRedeem(bobShares);
        uint256 globalRealJrtCap = discrete.maxWithdraw(true);
        uint256 bobMaxWithdraw = s.jrt.maxWithdraw(bob);

        console2.log("strategy physical NAV      ", initialPhysicalNav);
        console2.log("stored/real JRT            ", realJrt);
        console2.log("view-time projected JRT    ", projectedJrt);
        console2.log("Bob principal              ", bobDeposit);
        console2.log("Bob previewRedeem          ", bobPreview);
        console2.log("global REAL-JRT cap        ", globalRealJrtCap);
        console2.log("Bob maxWithdraw            ", bobMaxWithdraw);

        assertGt(projectedJrt, realJrt, "DiscreteAccounting did not project JRT above real JRT");
        assertGt(bobPreview, bobDeposit, "projected ERC4626 quote did not exceed Bob principal");

        // Bob's personal projected quote fits under a *pool-wide* withdrawal cap
        // derived from real JRT. Therefore the cap does not prevent him from cashing
        // the unrealized projected component.
        assertGt(globalRealJrtCap, bobPreview, "scenario sizing no longer fits beneath real-JRT cap");
        assertEq(bobMaxWithdraw, bobPreview, "Bob's projected quote should be the binding maxWithdraw");
        assertGt(bobMaxWithdraw, bobDeposit, "expected projected cashable value > principal");

        // NORMAL USER REDEMPTION: Bob has no owner/admin/pauser role.
        uint256 bobBefore = s.asset.balanceOf(bob);
        uint256 strategyBefore = s.strategy.reportedAssets();
        uint256 strategyTokenBefore = s.asset.balanceOf(address(s.strategy));

        vm.prank(bob);
        uint256 payout = s.jrt.redeem(bobShares, bob, bob);

        uint256 bobAfter = s.asset.balanceOf(bob);
        uint256 strategyAfter = s.strategy.reportedAssets();
        uint256 strategyTokenAfter = s.asset.balanceOf(address(s.strategy));
        uint256 unrealizedProfit = payout - bobDeposit;

        console2.log("Bob actual payout          ", payout);
        console2.log("Bob no-yield profit        ", unrealizedProfit);
        console2.log("strategy NAV after redeem  ", strategyAfter);

        assertEq(bobAfter - bobBefore, payout, "Bob did not receive the redeem payout");
        assertEq(payout, bobPreview, "actual redemption diverged from projected ERC4626 quote");
        assertGt(unrealizedProfit, 0, "Bob failed to cash out unrealized projection");

        // Conservation proof: there was zero external yield. Every asset Bob received,
        // including payout - principal, was removed from the pre-existing pooled
        // strategy principal belonging collectively to all tranche holders.
        assertEq(strategyBefore - strategyAfter, payout, "reported strategy NAV did not fund full payout");
        assertEq(
            strategyTokenBefore - strategyTokenAfter,
            payout,
            "physical strategy tokens did not fund full payout"
        );
        assertEq(
            strategyAfter,
            initialPhysicalNav - payout,
            "remaining pool principal does not reconcile after extraction"
        );
    }

    /// @notice Same exploit expressed as a two-user conservation statement:
    ///         Bob exits with > his deposit despite zero yield, so the remaining
    ///         pool necessarily bears an equal principal deficit.
    function test_DiscreteEarlyRedeemerExternalizesProjectionToRemainingHolders() public {
        ConservationStack memory s = _newStack(true);

        uint256 aliceDeposit = 900e18;
        uint256 bobDeposit = 100e18;
        uint256 seniorSeed = 20e18;
        uint256 initialPhysicalNav = aliceDeposit + bobDeposit + seniorSeed;

        _deposit(s, alice, s.srt, 10e18);
        _deposit(s, bob, s.srt, 10e18);
        _deposit(s, alice, s.jrt, aliceDeposit);
        uint256 bobShares = _deposit(s, bob, s.jrt, bobDeposit);

        vm.warp(block.timestamp + 365 days);

        assertEq(s.strategy.reportedAssets(), initialPhysicalNav, "strategy must remain yieldless");

        uint256 quote = s.jrt.previewRedeem(bobShares);
        assertGt(quote, bobDeposit, "scenario must create projected profit");

        vm.prank(bob);
        uint256 payout = s.jrt.redeem(bobShares, bob, bob);

        uint256 bobProfit = payout - bobDeposit;
        uint256 remainingPhysicalPrincipal = s.strategy.reportedAssets();

        assertGt(bobProfit, 0, "Bob must exit with no-yield profit");
        assertEq(
            remainingPhysicalPrincipal + payout,
            initialPhysicalNav,
            "physical conservation must hold"
        );
        assertEq(
            initialPhysicalNav - remainingPhysicalPrincipal - bobDeposit,
            bobProfit,
            "Bob's profit must be an equal depletion of pre-existing pooled principal"
        );
    }
}

/// @notice Stateful handler: no action can create legitimate yield. The only new
///      value entering the protocol comes from tracked user deposits.
contract NoYieldConservationHandler is Test {
    ConservationStack internal s;
    address[2] internal actors;

    mapping(address => uint256) public deposits;
    mapping(address => uint256) public withdrawals;

    constructor(ConservationStack memory stack, address actor0, address actor1) {
        s = stack;
        actors[0] = actor0;
        actors[1] = actor1;
    }

    function seed(uint256 actorIndex, uint256 amount) public {
        address actor = actors[actorIndex % actors.length];
        amount = bound(amount, 1e18, 1_000e18);
        s.asset.mint(actor, amount);
        vm.startPrank(actor);
        s.asset.approve(address(s.jrt), type(uint256).max);
        try s.jrt.deposit(amount, actor) returns (uint256) {
            deposits[actor] += amount;
        } catch { }
        vm.stopPrank();
    }

    function redeemSome(uint256 actorIndex, uint256 shareSeed) external {
        address actor = actors[actorIndex % actors.length];
        uint256 maxShares = s.jrt.maxRedeem(actor);
        if (maxShares == 0) return;

        uint256 shares = 1 + (shareSeed % maxShares);
        uint256 beforeBal = s.asset.balanceOf(actor);
        vm.prank(actor);
        try s.jrt.redeem(shares, actor, actor) returns (uint256) {
            withdrawals[actor] += s.asset.balanceOf(actor) - beforeBal;
        } catch { }
    }

    function warpTime(uint256 secondsSeed) external {
        uint256 dt = bound(secondsSeed, 1 days, 90 days);
        vm.warp(block.timestamp + dt);
    }

    function reportLoss(uint256 amountSeed) external {
        uint256 nav = s.strategy.reportedAssets();
        if (nav == 0) return;
        uint256 amount = amountSeed % (nav + 1);
        s.strategy.reportLoss(amount);
    }

    function actor(uint256 i) external view returns (address) {
        return actors[i];
    }

    function cashableWealth(address actor_) external view returns (uint256) {
        return withdrawals[actor_] + s.jrt.maxWithdraw(actor_);
    }
}

abstract contract NoYieldConservationInvariantBase is EconomicConservationBase, StdInvariant {
    ConservationStack internal stack;
    NoYieldConservationHandler internal handler;

    function _setUpInvariant(bool discrete) internal {
        stack = _newStack(discrete);
        handler = new NoYieldConservationHandler(stack, alice, bob);

        // Both tranches are seeded above the Immunefi 10-asset minimum. SRT remains
        // economically present while this invariant focuses on JRT conservation.
        _deposit(stack, alice, stack.srt, 10e18);
        _deposit(stack, bob, stack.srt, 10e18);

        handler.seed(0, 900e18);
        handler.seed(1, 100e18);

        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.seed.selector;
        selectors[1] = handler.redeemSome.selector;
        selectors[2] = handler.warpTime.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function _assertNoYieldConservation() internal view {
        for (uint256 i; i < 2; ++i) {
            address actor_ = handler.actor(i);
            uint256 contributed = handler.deposits(actor_);
            uint256 cashable = handler.withdrawals(actor_) + stack.jrt.maxWithdraw(actor_);

            // Tiny tolerance only for ERC4626 virtual-share / rounding effects. The handler has
            // no reportYield selector, so any larger excess is necessarily cashable projection.
            assertLe(cashable, contributed + 5, "actor has cashable profit without legitimate yield");
        }
    }
}

/// @dev Control invariant. This should stay green when the strategy reports no yield.
contract AccountingEconomicConservationInvariantTest is NoYieldConservationInvariantBase {
    function setUp() public {
        _setUpInvariant(false);
    }

    function invariant_noCashableProfitWithoutYield() public view {
        _assertNoYieldConservation();
    }
}

/// @dev Discovery invariant. On the reviewed commit, time projection is expected to
///      produce a counterexample in which one JRT holder cashes out more than their
///      tracked deposits despite zero reported strategy yield.
contract DiscreteAccountingEconomicConservationInvariantTest is NoYieldConservationInvariantBase {
    function setUp() public {
        _setUpInvariant(true);
    }

    function invariant_noCashableProfitWithoutYield() public view {
        _assertNoYieldConservation();
    }
}
