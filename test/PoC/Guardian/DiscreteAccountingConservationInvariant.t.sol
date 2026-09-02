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

contract HuntAprFeed is IAprPairFeed {
    TRound internal round;

    constructor(int64 aprTarget, int64 aprBase) {
        round = TRound(aprTarget, aprBase, uint64(block.timestamp), 1);
    }

    function updateRoundData(int64 aprTarget, int64 aprBase, uint64 timestamp) external {
        round = TRound(aprTarget, aprBase, timestamp, round.answeredInRound + 1);
    }

    function decimals() external pure returns (uint8) { return 12; }
    function description() external pure returns (string memory) { return "Discrete hunt APR feed"; }
    function getRoundData(uint64) external view returns (TRound memory) { return round; }
    function latestRoundData() external view returns (TRound memory) { return round; }
}

/// @dev Controlled 1:1 strategy. There is no implicit yield. Physical base-token
/// balance and reported NAV move together for every handler-controlled gain/loss.
contract HuntStrategy is IStrategy {
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

    function getCDOAddress() external view returns (address) { return cdoAddress; }

    function deposit(address, address token, uint256 tokenAmount, uint256 baseAssets, address owner)
        external
        onlyCDO
        returns (uint256)
    {
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

    function totalAssets() external view returns (uint256) { return reportedAssets; }
    function totalAssets(uint256, uint256) external view returns (uint256) { return reportedAssets; }

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
        amount = Math.min(amount, reportedAssets);
        reportedAssets -= amount;
        require(baseAsset.transfer(address(0xdead), amount), "loss transfer");
    }
}

struct HuntStack {
    MockERC20 asset;
    AccessControlManager acm;
    StrataCDO cdo;
    Tranche jrt;
    Tranche srt;
    DiscreteAccounting accounting;
    HuntStrategy strategy;
    HuntAprFeed feed;
}

abstract contract HuntDeployment is Test {
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    address internal owner;
    address internal alice;
    address internal bob;
    address internal carol;

    function _deploy() internal returns (HuntStack memory s) {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        s.asset = new MockERC20("BASE", 18);
        s.acm = new AccessControlManager(owner);
        s.feed = new HuntAprFeed(0, 100_000_000_000); // 10% base APR

        vm.startPrank(owner);

        StrataCDO cdoImpl = new StrataCDO(IERC20Metadata(address(s.asset)));
        s.cdo = StrataCDO(address(new ERC1967Proxy(
            address(cdoImpl),
            abi.encodeWithSelector(StrataCDO.initialize.selector, owner, address(s.acm))
        )));

        Tranche trancheImpl = new Tranche();
        s.jrt = Tranche(address(new ERC1967Proxy(
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
        )));
        s.srt = Tranche(address(new ERC1967Proxy(
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
        )));

        DiscreteAccounting accountingImpl = new DiscreteAccounting(18);
        s.accounting = DiscreteAccounting(address(new ERC1967Proxy(
            address(accountingImpl),
            abi.encodeWithSelector(
                DiscreteAccounting.initialize.selector,
                owner,
                address(s.acm),
                IStrataCDO(address(s.cdo)),
                IAprPairFeed(address(s.feed))
            )
        )));

        s.strategy = new HuntStrategy(IERC20(address(s.asset)), address(s.cdo));
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

    function _deposit(HuntStack memory s, address actor, Tranche vault, uint256 amount)
        internal
        returns (uint256 shares)
    {
        s.asset.mint(actor, amount);
        vm.startPrank(actor);
        s.asset.approve(address(vault), type(uint256).max);
        shares = vault.deposit(amount, actor);
        vm.stopPrank();
    }

    function _sync(HuntStack memory s) internal {
        vm.prank(address(s.jrt));
        s.cdo.updateAccounting();
    }
}

/// @notice These tests encode intended SIP-03 semantics so the invariant does not
/// misclassify projection itself as a vulnerability.
contract DiscreteAccountingSemanticTest is HuntDeployment {
    function test_projectionIsAllowedButPublicJrtExitRemainsRealCapped() public {
        HuntStack memory s = _deploy();

        // Junior must exist before Senior because SRT deposits are collateral-capped.
        uint256 bobShares = _deposit(s, bob, s.jrt, 1_000e18);
        _deposit(s, alice, s.srt, 100e18);

        vm.warp(block.timestamp + 30 days);
        (uint256 realJrt,,) = s.accounting.totalAssetsT0();
        (uint256 projectedJrt,,) = s.accounting.totalAssets();
        assertGt(projectedJrt, realJrt, "projection not exercised");

        uint256 protocolCap = s.accounting.maxWithdraw(true);
        assertLe(protocolCap, realJrt, "JRT protocol cap > real JRT");
        assertLe(s.jrt.maxWithdraw(bob), protocolCap, "public exit bypassed real cap");
        assertLe(s.jrt.maxRedeem(bob), bobShares, "maxRedeem exceeded holder shares");

        (uint256 realAfter,,) = s.accounting.totalAssetsT0();
        assertEq(realAfter, realJrt, "projection view mutated real JRT");
    }

    function test_realizedLossIsJuniorFirst() public {
        HuntStack memory s = _deploy();
        _deposit(s, alice, s.jrt, 100e18);
        _deposit(s, bob, s.srt, 100e18);

        (uint256 jrtBefore, uint256 srtBefore, uint256 reserveBefore) = s.accounting.totalAssetsT0();
        s.strategy.reportLoss(25e18);
        _sync(s);
        (uint256 jrtAfter, uint256 srtAfter, uint256 reserveAfter) = s.accounting.totalAssetsT0();

        assertEq(jrtAfter, jrtBefore - 25e18, "Junior did not absorb first loss");
        assertEq(srtAfter, srtBefore, "Senior charged before Junior exhausted");
        assertEq(reserveAfter, reserveBefore, "reserve charged before Junior exhausted");
        assertEq(s.accounting.nav(), s.strategy.reportedAssets(), "loss sync mismatch");
    }

    function test_realizedYieldTrueUpReconcilesRealSplit() public {
        HuntStack memory s = _deploy();
        _deposit(s, bob, s.jrt, 1_000e18);
        _deposit(s, alice, s.srt, 100e18);

        vm.warp(block.timestamp + 30 days);
        (uint256 realBefore,,) = s.accounting.totalAssetsT0();
        (uint256 projectedBefore,,) = s.accounting.totalAssets();
        assertGt(projectedBefore, realBefore, "projection not exercised");

        s.strategy.reportYield(10e18);
        _sync(s);

        assertEq(s.accounting.jrtNavProjected(), s.accounting.jrtNav(), "true-up left JRT divergent");
        (uint256 jrt, uint256 srt, uint256 reserve) = s.accounting.totalAssetsT0();
        assertEq(jrt + srt + reserve, s.accounting.nav(), "real split != accounted NAV");
        assertEq(s.accounting.nav(), s.strategy.reportedAssets(), "yield sync mismatch");
    }
}

contract DiscreteAccountingInvariantHandler is Test {
    uint256 internal constant MAX_TOTAL_WARP = 90 days;
    uint256 internal constant SAFE_JRT_SRT_RATIO = 0.50e18;

    HuntStack internal s;
    address[3] internal actors;
    uint256 public totalWarp;
    bool public syncFailed;

    constructor(HuntStack memory stack, address a0, address a1, address a2) {
        s = stack;
        actors[0] = a0;
        actors[1] = a1;
        actors[2] = a2;
    }

    function actor(uint256 i) external view returns (address) { return actors[i]; }

    function depositJrt(uint256 actorSeed, uint256 amountSeed) external {
        _deposit(actors[actorSeed % 3], s.jrt, amountSeed);
    }
    function depositSrt(uint256 actorSeed, uint256 amountSeed) external {
        _deposit(actors[actorSeed % 3], s.srt, amountSeed);
    }
    function mintJrt(uint256 actorSeed, uint256 shareSeed) external {
        _mint(actors[actorSeed % 3], s.jrt, shareSeed);
    }
    function mintSrt(uint256 actorSeed, uint256 shareSeed) external {
        _mint(actors[actorSeed % 3], s.srt, shareSeed);
    }
    function redeemJrt(uint256 actorSeed, uint256 shareSeed) external {
        _redeem(actors[actorSeed % 3], s.jrt, shareSeed);
    }
    function redeemSrt(uint256 actorSeed, uint256 shareSeed) external {
        _redeem(actors[actorSeed % 3], s.srt, shareSeed);
    }
    function withdrawJrt(uint256 actorSeed, uint256 assetSeed) external {
        _withdraw(actors[actorSeed % 3], s.jrt, assetSeed);
    }
    function withdrawSrt(uint256 actorSeed, uint256 assetSeed) external {
        _withdraw(actors[actorSeed % 3], s.srt, assetSeed);
    }

    function reportYieldAndSync(uint256 seed) external {
        uint256 nav = s.strategy.reportedAssets();
        uint256 maxAmount = nav / 100; // <= 1% per event
        if (maxAmount == 0) return;
        s.strategy.reportYield(1 + (seed % maxAmount));
        _sync();
    }

    function reportLossAndSync(uint256 seed) external {
        uint256 nav = s.strategy.reportedAssets();
        (uint256 jrtReal,,) = s.accounting.totalAssetsT0();
        uint256 maxAmount = Math.min(nav / 100, jrtReal / 20); // <= 1% NAV and <= 5% real JRT
        if (maxAmount == 0) return;
        s.strategy.reportLoss(1 + (seed % maxAmount));
        _sync();
    }

    function forceAccountingUpdate() external { _sync(); }

    function warpTime(uint256 seed) external {
        if (totalWarp >= MAX_TOTAL_WARP) return;
        (uint256 jrtReal, uint256 srtReal,) = s.accounting.totalAssetsT0();
        if (srtReal > 0 && jrtReal * 1e18 / srtReal < SAFE_JRT_SRT_RATIO) return;

        uint256 remaining = MAX_TOTAL_WARP - totalWarp;
        uint256 maxStep = Math.min(14 days, remaining);
        if (maxStep == 0) return;
        uint256 dt = 1 hours + (seed % maxStep);
        if (dt > remaining) dt = remaining;
        totalWarp += dt;
        vm.warp(block.timestamp + dt);
    }

    function _deposit(address actor_, Tranche vault, uint256 seed) internal {
        uint256 amount = bound(seed, 0.1e18, 100e18);
        s.asset.mint(actor_, amount);
        vm.startPrank(actor_);
        s.asset.approve(address(vault), type(uint256).max);
        try vault.deposit(amount, actor_) returns (uint256) {} catch {}
        vm.stopPrank();
    }

    function _mint(address actor_, Tranche vault, uint256 seed) internal {
        uint256 shares = bound(seed, 0.1e18, 50e18);
        s.asset.mint(actor_, 500e18);
        vm.startPrank(actor_);
        s.asset.approve(address(vault), type(uint256).max);
        try vault.mint(shares, actor_) returns (uint256) {} catch {}
        vm.stopPrank();
    }

    function _redeem(address actor_, Tranche vault, uint256 seed) internal {
        uint256 maxShares;
        try vault.maxRedeem(actor_) returns (uint256 value) { maxShares = value; } catch { return; }
        if (maxShares == 0) return;
        uint256 shares = 1 + (seed % maxShares);
        vm.prank(actor_);
        try vault.redeem(shares, actor_, actor_) returns (uint256) {} catch {}
    }

    function _withdraw(address actor_, Tranche vault, uint256 seed) internal {
        uint256 maxAssets;
        try vault.maxWithdraw(actor_) returns (uint256 value) { maxAssets = value; } catch { return; }
        if (maxAssets == 0) return;
        uint256 assets = 1 + (seed % maxAssets);
        vm.prank(actor_);
        try vault.withdraw(assets, actor_, actor_) returns (uint256) {} catch {}
    }

    function _sync() internal {
        vm.prank(address(s.jrt));
        try s.cdo.updateAccounting() {} catch { syncFailed = true; }
    }
}

/// @notice Fresh-root detector. Projection is treated as intended behavior. The fuzz
/// target is explicitly restricted to this handler, and the domain stays away from
/// the already-published long rewardless real-JRT depletion / InvalidNavSplit path.
contract DiscreteAccountingConservationInvariantTest is HuntDeployment {
    HuntStack internal stack;
    DiscreteAccountingInvariantHandler internal handler;

    function setUp() public {
        stack = _deploy();
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

        // Both are required: selector targeting alone does not stop Forge from
        // discovering and fuzzing other deployed contracts.
        targetContract(address(handler));
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function invariant_onlyHandlerIsTargeted() public view {
        address[] memory targets = targetContracts();
        assertEq(targets.length, 1, "unexpected invariant target count");
        assertEq(targets[0], address(handler), "non-handler invariant target");
    }

    function invariant_accountingUpdateRemainsOperable() public view {
        assertFalse(handler.syncFailed(), "accounting update reverted in constrained fresh-search domain");
    }

    function invariant_realSplitConservesAccountedNav() public view {
        (uint256 jrt, uint256 srt, uint256 reserve) = stack.accounting.totalAssetsT0();
        assertEq(jrt + srt + reserve, stack.accounting.nav(), "real split != accounted NAV");
    }

    function invariant_accountedNavTracksStrategyNav() public view {
        assertEq(stack.accounting.nav(), stack.strategy.reportedAssets(), "accounting != strategy NAV");
    }

    function invariant_strategyNavHasPhysicalBacking() public view {
        assertEq(
            stack.asset.balanceOf(address(stack.strategy)),
            stack.strategy.reportedAssets(),
            "reported strategy NAV lacks physical backing"
        );
    }

    function invariant_publicExitCapsStayInsideRealProtocolCaps() public view {
        uint256 jrtCap = stack.accounting.maxWithdraw(true);
        uint256 srtCap = stack.accounting.maxWithdraw(false);
        (uint256 jrtReal, uint256 srtReal,) = stack.accounting.totalAssetsT0();

        assertLe(jrtCap, jrtReal, "JRT cap > real JRT");
        assertEq(stack.accounting.maxWithdraw(true, true), jrtReal, "cooldown JRT cap != real JRT");
        assertEq(srtCap, srtReal, "SRT cap != real SRT");

        for (uint256 i; i < 3; ++i) {
            address a = handler.actor(i);
            assertLe(stack.jrt.maxWithdraw(a), jrtCap, "user JRT exit bypassed protocol cap");
            assertLe(stack.srt.maxWithdraw(a), srtCap, "user SRT exit bypassed protocol cap");
        }
    }
}
