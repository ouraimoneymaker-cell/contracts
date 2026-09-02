// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { AccessControlManager } from "../../../contracts/governance/AccessControlManager.sol";
import { StrataCDO } from "../../../contracts/tranches/StrataCDO.sol";
import { Tranche } from "../../../contracts/tranches/Tranche.sol";
import { DiscreteAccounting } from "../../../contracts/tranches/DiscreteAccounting.sol";
import { MockERC20 } from "../../../contracts/test/MockERC20.sol";
import { IAccounting } from "../../../contracts/tranches/interfaces/IAccounting.sol";
import { IAprPairFeed } from "../../../contracts/tranches/interfaces/IAprPairFeed.sol";
import { IStrategy } from "../../../contracts/tranches/interfaces/IStrategy.sol";
import { IStrataCDO } from "../../../contracts/tranches/interfaces/IStrataCDO.sol";
import { ITranche } from "../../../contracts/tranches/interfaces/ITranche.sol";

/// @dev Stable APR feed for the invariant lab. Projection is intentional in
///      DiscreteAccounting, so the harness never treats projected JRT as realized yield.
contract DiscreteInvariantAprFeed is IAprPairFeed {
    TRound internal round;

    constructor(int64 aprTarget, int64 aprBase) {
        round = TRound({
            aprTarget: aprTarget,
            aprBase: aprBase,
            updatedAt: uint64(block.timestamp),
            answeredInRound: 1
        });
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
        return "Discrete invariant APR feed";
    }

    function getRoundData(uint64) external view returns (TRound memory) {
        return round;
    }

    function latestRoundData() external view returns (TRound memory) {
        return round;
    }
}

/// @dev 1:1 strategy used only to make strategy NAV and physical backing observable.
///      reportYield/reportLoss are explicit economic events; there is no hidden yield.
contract DiscreteInvariantStrategy is IStrategy {
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

    function reportYield(uint256 amount) external {
        if (amount == 0) return;
        MockERC20(address(baseAsset)).mint(address(this), amount);
        reportedAssets += amount;
    }

    function reportLoss(uint256 amount) external {
        if (amount == 0) return;
        if (amount > reportedAssets) amount = reportedAssets;
        reportedAssets -= amount;
        require(baseAsset.transfer(address(0xdead), amount), "loss transfer");
    }
}

struct DiscreteInvariantStack {
    MockERC20 asset;
    AccessControlManager acm;
    StrataCDO cdo;
    Tranche jrt;
    Tranche srt;
    DiscreteAccounting accounting;
    DiscreteInvariantStrategy strategy;
    DiscreteInvariantAprFeed feed;
}

abstract contract DiscreteInvariantDeployment is Test {
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    address internal owner;
    address internal alice;
    address internal bob;
    address internal carol;

    function _deployDiscreteStack() internal returns (DiscreteInvariantStack memory s) {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        s.asset = new MockERC20("BASE", 18);
        s.acm = new AccessControlManager(owner);
        s.feed = new DiscreteInvariantAprFeed(0, 100_000_000_000); // 10% base APR

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

        DiscreteAccounting accountingImpl = new DiscreteAccounting(18);
        s.accounting = DiscreteAccounting(
            address(
                new ERC1967Proxy(
                    address(accountingImpl),
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

        s.strategy = new DiscreteInvariantStrategy(IERC20(address(s.asset)), address(s.cdo));

        s.cdo.configure(
            IAccounting(address(s.accounting)),
            IStrategy(address(s.strategy)),
            ITranche(address(s.jrt)),
            ITranche(address(s.srt))
        );

        s.acm.grantRole(PAUSER_ROLE, owner);
        s.cdo.setActionStates(address(0), true, true);

        vm.stopPrank();
    }

    function _fundAndApprove(DiscreteInvariantStack memory s, address actor, Tranche vault, uint256 amount)
        internal
    {
        s.asset.mint(actor, amount);
        vm.startPrank(actor);
        s.asset.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _deposit(
        DiscreteInvariantStack memory s,
        address actor,
        Tranche vault,
        uint256 amount
    ) internal returns (uint256 shares) {
        _fundAndApprove(s, actor, vault, amount);
        vm.prank(actor);
        shares = vault.deposit(amount, actor);
    }

    function _sync(DiscreteInvariantStack memory s) internal {
        vm.prank(address(s.jrt));
        s.cdo.updateAccounting();
    }
}

/// @notice Deterministic semantic checks. These encode SIP-03's intended rules:
///         projection is allowed; real NAV remains the solvency/withdrawal boundary.
contract DiscreteAccountingSemanticTest is DiscreteInvariantDeployment {
    function test_projectionIsAllowedButJrtPublicExitRemainsRealCapped() public {
        DiscreteInvariantStack memory s = _deployDiscreteStack();

        _deposit(s, alice, s.srt, 100e18);
        uint256 bobShares = _deposit(s, bob, s.jrt, 1_000e18);

        vm.warp(block.timestamp + 30 days);

        (uint256 realJrt,,) = s.accounting.totalAssetsT0();
        (uint256 projectedJrt,,) = s.accounting.totalAssets();

        assertGt(projectedJrt, realJrt, "scenario should exercise JRT projection");

        uint256 protocolRealCap = s.accounting.maxWithdraw(true);
        uint256 bobPublicCap = s.jrt.maxWithdraw(bob);

        assertLe(protocolRealCap, realJrt, "protocol JRT cap exceeded real JRT");
        assertLe(bobPublicCap, protocolRealCap, "public JRT exit bypassed real protocol cap");
        assertLe(s.jrt.maxRedeem(bob), bobShares, "maxRedeem exceeded Bob shares");

        // Calling projection views must not mutate saved real accounting state.
        (uint256 realJrtAfter,,) = s.accounting.totalAssetsT0();
        assertEq(realJrtAfter, realJrt, "projection view mutated real JRT");
    }

    function test_realizedLossUsesJuniorFirst() public {
        DiscreteInvariantStack memory s = _deployDiscreteStack();

        _deposit(s, alice, s.jrt, 100e18);
        _deposit(s, bob, s.srt, 100e18);

        (uint256 jrtBefore, uint256 srtBefore, uint256 reserveBefore) = s.accounting.totalAssetsT0();
        uint256 navBefore = s.accounting.nav();

        s.strategy.reportLoss(25e18);
        _sync(s);

        (uint256 jrtAfter, uint256 srtAfter, uint256 reserveAfter) = s.accounting.totalAssetsT0();

        assertEq(jrtAfter, jrtBefore - 25e18, "Junior did not absorb first loss");
        assertEq(srtAfter, srtBefore, "Senior was charged before Junior exhausted");
        assertEq(reserveAfter, reserveBefore, "reserve changed before Junior exhausted");
        assertEq(s.accounting.nav(), navBefore - 25e18, "accounted NAV missed realized loss");
        assertEq(s.accounting.nav(), s.strategy.reportedAssets(), "strategy/accounting NAV mismatch");
    }

    function test_realizedYieldTrueUpResetsProjectedJrtToRealJrt() public {
        DiscreteInvariantStack memory s = _deployDiscreteStack();

        _deposit(s, alice, s.srt, 100e18);
        _deposit(s, bob, s.jrt, 1_000e18);

        vm.warp(block.timestamp + 30 days);
        (uint256 realBefore,,) = s.accounting.totalAssetsT0();
        (uint256 projectedBefore,,) = s.accounting.totalAssets();
        assertGt(projectedBefore, realBefore, "scenario should create projection");

        s.strategy.reportYield(10e18);
        _sync(s);

        assertEq(
            s.accounting.jrtNavProjected(),
            s.accounting.jrtNav(),
            "realized-yield true-up left projected and real JRT divergent"
        );

        (uint256 jrt, uint256 srt, uint256 reserve) = s.accounting.totalAssetsT0();
        assertEq(jrt + srt + reserve, s.accounting.nav(), "real split does not reconcile after true-up");
        assertEq(s.accounting.nav(), s.strategy.reportedAssets(), "true-up missed strategy NAV");
    }
}

/// @notice Stateful economic/accounting detector for fresh-root hunting.
///
/// It intentionally excludes the already-public Immunefi known issue where a long
/// rewardless projected Senior accrual can exhaust real Junior and create InvalidNavSplit.
/// Time only advances while real JRT/SRT coverage is comfortably above that boundary,
/// and cumulative warp is capped. Counterexamples should therefore point somewhere else.
contract DiscreteAccountingInvariantHandler is Test {
    uint256 internal constant SAFE_PROJECTION_RATIO = 0.20e18;
    uint256 internal constant MAX_TOTAL_WARP = 180 days;

    DiscreteInvariantStack internal s;
    address[3] internal actors;
    uint256 public totalWarp;
    bool public syncFailed;

    constructor(
        DiscreteInvariantStack memory stack,
        address actor0,
        address actor1,
        address actor2
    ) {
        s = stack;
        actors[0] = actor0;
        actors[1] = actor1;
        actors[2] = actor2;
    }

    function depositJrt(uint256 actorSeed, uint256 amountSeed) external {
        _deposit(actors[actorSeed % actors.length], s.jrt, amountSeed);
    }

    function depositSrt(uint256 actorSeed, uint256 amountSeed) external {
        _deposit(actors[actorSeed % actors.length], s.srt, amountSeed);
    }

    function mintJrt(uint256 actorSeed, uint256 shareSeed) external {
        _mint(actors[actorSeed % actors.length], s.jrt, shareSeed);
    }

    function mintSrt(uint256 actorSeed, uint256 shareSeed) external {
        _mint(actors[actorSeed % actors.length], s.srt, shareSeed);
    }

    function redeemJrt(uint256 actorSeed, uint256 shareSeed) external {
        _redeem(actors[actorSeed % actors.length], s.jrt, shareSeed);
    }

    function redeemSrt(uint256 actorSeed, uint256 shareSeed) external {
        _redeem(actors[actorSeed % actors.length], s.srt, shareSeed);
    }

    function withdrawJrt(uint256 actorSeed, uint256 assetSeed) external {
        _withdraw(actors[actorSeed % actors.length], s.jrt, assetSeed);
    }

    function withdrawSrt(uint256 actorSeed, uint256 assetSeed) external {
        _withdraw(actors[actorSeed % actors.length], s.srt, assetSeed);
    }

    function reportYieldAndSync(uint256 amountSeed) external {
        uint256 nav = s.strategy.reportedAssets();
        uint256 maxAmount = nav / 10;
        if (maxAmount == 0) return;

        uint256 amount = 1 + (amountSeed % maxAmount);
        s.strategy.reportYield(amount);
        _sync();
    }

    function reportLossAndSync(uint256 amountSeed) external {
        uint256 nav = s.strategy.reportedAssets();
        uint256 maxAmount = nav / 10;
        if (maxAmount == 0) return;

        uint256 amount = 1 + (amountSeed % maxAmount);
        s.strategy.reportLoss(amount);
        _sync();
    }

    function forceAccountingUpdate() external {
        _sync();
    }

    function warpTime(uint256 secondsSeed) external {
        if (totalWarp >= MAX_TOTAL_WARP) return;

        (uint256 jrtReal, uint256 srtReal,) = s.accounting.totalAssetsT0();
        if (srtReal > 0 && jrtReal * 1e18 / srtReal < SAFE_PROJECTION_RATIO) {
            return;
        }

        uint256 remaining = MAX_TOTAL_WARP - totalWarp;
        uint256 maxStep = Math.min(30 days, remaining);
        if (maxStep == 0) return;

        uint256 dt = 1 hours + (secondsSeed % maxStep);
        if (dt > remaining) dt = remaining;

        totalWarp += dt;
        vm.warp(block.timestamp + dt);
    }

    function actor(uint256 i) external view returns (address) {
        return actors[i];
    }

    function _deposit(address actor_, Tranche vault, uint256 amountSeed) internal {
        uint256 amount = bound(amountSeed, 0.1e18, 250e18);
        s.asset.mint(actor_, amount);

        vm.startPrank(actor_);
        s.asset.approve(address(vault), type(uint256).max);
        try vault.deposit(amount, actor_) returns (uint256) { } catch { }
        vm.stopPrank();
    }

    function _mint(address actor_, Tranche vault, uint256 shareSeed) internal {
        uint256 shares = bound(shareSeed, 0.1e18, 100e18);
        s.asset.mint(actor_, 1_000e18);

        vm.startPrank(actor_);
        s.asset.approve(address(vault), type(uint256).max);
        try vault.mint(shares, actor_) returns (uint256) { } catch { }
        vm.stopPrank();
    }

    function _redeem(address actor_, Tranche vault, uint256 shareSeed) internal {
        uint256 maxShares;
        try vault.maxRedeem(actor_) returns (uint256 value) {
            maxShares = value;
        } catch {
            return;
        }
        if (maxShares == 0) return;

        uint256 shares = 1 + (shareSeed % maxShares);
        vm.prank(actor_);
        try vault.redeem(shares, actor_, actor_) returns (uint256) { } catch { }
    }

    function _withdraw(address actor_, Tranche vault, uint256 assetSeed) internal {
        uint256 maxAssets;
        try vault.maxWithdraw(actor_) returns (uint256 value) {
            maxAssets = value;
        } catch {
            return;
        }
        if (maxAssets == 0) return;

        uint256 assets = 1 + (assetSeed % maxAssets);
        vm.prank(actor_);
        try vault.withdraw(assets, actor_, actor_) returns (uint256) { } catch { }
    }

    function _sync() internal {
        vm.prank(address(s.jrt));
        try s.cdo.updateAccounting() { } catch {
            syncFailed = true;
        }
    }
}

contract DiscreteAccountingConservationInvariantTest is DiscreteInvariantDeployment {
    DiscreteInvariantStack internal stack;
    DiscreteAccountingInvariantHandler internal handler;

    function setUp() public {
        stack = _deployDiscreteStack();

        // Large Junior cushion keeps the fuzz domain away from the published
        // long-rewardless real-JRT depletion issue while still exercising both tranches.
        _deposit(stack, alice, stack.jrt, 1_000e18);
        _deposit(stack, bob, stack.jrt, 500e18);
        _deposit(stack, carol, stack.srt, 250e18);

        handler = new DiscreteAccountingInvariantHandler(stack, alice, bob, carol);

        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = handler.depositJrt.selector;
        selectors[1] = handler.depositSrt.selector;
        selectors[2] = handler.mintJrt.selector;
        selectors[3] = handler.mintSrt.selector;
        selectors[4] = handler.redeemJrt.selector;
        selectors[5] = handler.redeemSrt.selector;
        selectors[6] = handler.withdrawJrt.selector;
        selectors[7] = handler.withdrawSrt.selector;
        selectors[8] = handler.reportYieldAndSync.selector;
        selectors[9] = handler.reportLossAndSync.selector;
        selectors[10] = handler.forceAccountingUpdate.selector;
        selectors[11] = handler.warpTime.selector;

        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function invariant_accountingUpdateRemainsOperableInFreshSearchDomain() public view {
        assertFalse(handler.syncFailed(), "accounting update reverted inside constrained fresh-search domain");
    }

    /// @dev Real saved claims, not projected JRT, must reconcile exactly with accounted NAV.
    function invariant_realSavedSplitConservesAccountedNav() public view {
        (uint256 jrtReal, uint256 srtReal, uint256 reserveReal) = stack.accounting.totalAssetsT0();
        assertEq(
            jrtReal + srtReal + reserveReal,
            stack.accounting.nav(),
            "real JRT + SRT + reserve != accounted NAV"
        );
    }

    /// @dev Every handler action either leaves strategy NAV unchanged or synchronizes it.
    function invariant_accountedNavTracksStrategyNav() public view {
        assertEq(
            stack.accounting.nav(),
            stack.strategy.reportedAssets(),
            "accounting NAV diverged from strategy NAV"
        );
    }

    /// @dev The mock's observable physical balance is the ground truth for strategy NAV.
    function invariant_strategyReportedNavHasPhysicalBacking() public view {
        assertEq(
            stack.asset.balanceOf(address(stack.strategy)),
            stack.strategy.reportedAssets(),
            "strategy reported NAV lacks physical backing"
        );
    }

    /// @dev SIP-03 uses real Junior NAV for withdrawal safety. Projected pricing may be
    ///      higher, but public user exits must remain bounded by the real protocol cap.
    function invariant_publicExitCapsStayInsideRealProtocolCaps() public view {
        uint256 jrtProtocolCap = stack.accounting.maxWithdraw(true);
        uint256 srtProtocolCap = stack.accounting.maxWithdraw(false);

        (uint256 jrtReal, uint256 srtReal,) = stack.accounting.totalAssetsT0();

        assertLe(jrtProtocolCap, jrtReal, "JRT protocol cap exceeded real JRT");
        assertEq(stack.accounting.maxWithdraw(true, true), jrtReal, "cooldown JRT cap != real JRT");
        assertEq(srtProtocolCap, srtReal, "SRT protocol cap != real SRT");

        for (uint256 i; i < 3; ++i) {
            address actor_ = handler.actor(i);
            assertLe(stack.jrt.maxWithdraw(actor_), jrtProtocolCap, "user JRT exit bypassed real cap");
            assertLe(stack.srt.maxWithdraw(actor_), srtProtocolCap, "user SRT exit bypassed real cap");
        }
    }
}
