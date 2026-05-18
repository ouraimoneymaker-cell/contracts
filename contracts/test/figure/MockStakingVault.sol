// SPDX-License-Identifier: Apache-2.0
//Source code: https://github.com/provenance-io/hastra-eth-vault/blob/main/contracts/StakingVault.sol
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @notice Interface for YieldVault to mint reward tokens
 */
interface IYieldVault {
    function mintRewards(address to, uint256 amount) external;
}

/**
 * @notice Minimal interface for Chainlink FeedVerifier NAV oracle
 */
interface IFeedVerifier {
    function priceOf(bytes32 feedId) external view returns (int192);
}

/**
 * @title StakingVault
 * @author Hastra
 * @notice Upgradeable ERC-4626 staking vault
 */
contract MockStakingVault is 
    Initializable, 
    ERC4626Upgradeable, 
    ERC20PermitUpgradeable, 
    AccessControlUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable 
{
    using Math for uint256;
    
    // ============ Roles ============
    
    bytes32 public constant FREEZE_ADMIN_ROLE = keccak256("FREEZE_ADMIN");
    bytes32 public constant REWARDS_ADMIN_ROLE = keccak256("REWARDS_ADMIN");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant NAV_ORACLE_UPDATER_ROLE = keccak256("NAV_ORACLE_UPDATER");
    
    // ============ State Variables ============

    /// @notice Reference to the YieldVault for minting wYLDS rewards
    address public yieldVault;
    
    /// @notice Internal accounting of wYLDS deposited (prevents donation inflation attack)
    /// @dev Tracks only legitimate deposits, ignoring direct transfers to contract
    uint256 private _totalManagedAssets;

    /// @notice Maximum reward increase as a fraction of this vault's current totalAssets, in 1e18 units.
    /// @dev Relative per-chain TVL guard. YLDS is multi-chain: a rewards admin may compute reward
    ///      amounts against total protocol TVL (Ethereum + Solana + …), but this contract only holds
    ///      the Ethereum-chain slice. Without this check, an amount that looks like "1% of $100M total"
    ///      could be "10% of $10M local" — over-inflating Ethereum stakers' share.
    ///      75 bps = 0.75% = 0.0075e18. Settable via setMaxRewardPercent (DEFAULT_ADMIN_ROLE).
    uint256 public maxRewardPercent;

    /// @notice Chainlink FeedVerifier NAV oracle address (optional — zero means no oracle)
    address public navOracle;

    /// @dev Deprecated — staleness is now enforced by FeedVerifier.priceOf(). Kept for storage layout.
    uint32 public navStalenessLimit;

    /// @notice Chainlink feedId this vault reads NAV from (set alongside navOracle)
    bytes32 public navFeedId;

    /// @notice Absolute per-call ceiling on distributeRewards, in asset token units.
    /// @dev Secondary cross-chain TVL guard (absolute, not relative). Caps the raw token amount
    ///      regardless of vault size. Limits single-call blast radius if REWARDS_ADMIN_ROLE is
    ///      compromised or a cross-chain accounting error produces a grossly inflated figure.
    ///      Default: 1_000_000e6 (1M wYLDS). Settable via setMaxPeriodRewards (DEFAULT_ADMIN_ROLE).
    uint256 public maxPeriodRewards;

    /// @notice Minimum seconds that must elapse between successive distributeRewards calls.
    /// @dev Cooldown that prevents a compromised REWARDS_ADMIN_ROLE key from looping the per-call
    ///      cap — e.g. calling distributeRewards(1M) every block would otherwise drain the lifetime
    ///      budget in seconds. Default: 3540 (59 min — 1 min buffer before the hourly boundary to
    ///      avoid block-timestamp drift causing spurious reverts). Settable via setRewardPeriodSeconds (DEFAULT_ADMIN_ROLE).
    uint256 public rewardPeriodSeconds;

    /// @notice Block timestamp of the last successful distributeRewards call.
    /// @dev Used with rewardPeriodSeconds to enforce the cooldown. Zero on fresh deployment (first
    ///      call is always allowed).
    uint256 public lastRewardDistributedAt;

    /// @notice Hard lifetime ceiling on cumulative rewards ever distributed through this vault.
    /// @dev Final backstop — survives key compromise and repeated calls within the cooldown window.
    ///      Raising this requires a multisig (DEFAULT_ADMIN_ROLE) transaction, giving governance
    ///      visibility into any attempt to increase the reward budget.
    ///      Default: 10_000_000e6 (10M wYLDS, 10× the per-call max). Settable via setMaxTotalRewards.
    uint256 public maxTotalRewards;

    /// @notice Cumulative total rewards minted through this vault since deployment.
    /// @dev Monotonically increasing. Checked against maxTotalRewards on every distributeRewards call.
    uint256 public totalRewardsDistributed;

    /// @dev Storage gap — reduced by 5 for the vars above (46 → 41).
    uint256[41] private __gap;
    // ============ Events ============

    event RewardsDistributed(uint256 amount, uint256 timestamp);
    event YieldVaultUpdated(address oldVault, address newVault);
    event MaxRewardPercentUpdated(uint256 oldValue, uint256 newValue);
    event NavOracleUpdated(address oldOracle, address newOracle, bytes32 feedId);
    event MaxPeriodRewardsUpdated(uint256 oldValue, uint256 newValue);
    event RewardPeriodSecondsUpdated(uint256 oldValue, uint256 newValue);
    event MaxTotalRewardsUpdated(uint256 oldValue, uint256 newValue);

    // ============ Errors ============

    error InvalidAmount();
    error InvalidAddress();
    error ZeroAmount();
    error RewardExceedsMaxDelta(uint256 amount, uint256 maxAllowed);
    error NavInvalid();
    error RewardCooldownNotElapsed(uint256 nextAllowedAt);
    error ExceedsPeriodRewardCap(uint256 amount, uint256 cap);
    error ExceedsLifetimeRewardCap(uint256 amount, uint256 remaining);
    
    // ============ Constructor ============
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the StakingVault
     * @param asset_ The underlying asset (e.g., wYLDS from YieldVault)
     * @param name_ Name of the stake token (e.g., "Prime Staked YLDS")
     * @param symbol_ Symbol of the stake token (e.g., "PRIME")
     * @param admin_ Address of the default admin
     * @param yieldVault_ Address of the YieldVault contract for minting rewards
     * @dev Grants only essential roles (DEFAULT_ADMIN, PAUSER, UPGRADER) to admin_.
     *      Additional roles (REWARDS_ADMIN, FREEZE_ADMIN) should be granted to
     *      appropriate addresses post-deployment for role separation.
     */
    function initialize(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address admin_,
        address yieldVault_
    ) public initializer {
        if (admin_ == address(0)) revert InvalidAddress();
        if (yieldVault_ == address(0)) revert InvalidAddress();

        __ERC20_init(name_, symbol_);
        __ERC4626_init(asset_);
        __ERC20Permit_init(name_);
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(PAUSER_ROLE, admin_);
        _grantRole(UPGRADER_ROLE, admin_);
        
        // Note: Additional roles (REWARDS_ADMIN, FREEZE_ADMIN) are intentionally NOT granted
        // here to support role separation in production. The deployment script (deploy.ts)
        // grants these roles to separate addresses for security best practices:
        //   - FREEZE_ADMIN can freeze/thaw staker accounts
        //   - REWARDS_ADMIN can distribute wYLDS rewards to stakers
        //   - NAV_ORACLE_UPDATER can call setNavOracle to point to a Chainlink FeedVerifier
        
        yieldVault = yieldVault_;
        maxRewardPercent = 0.0075e18;        // 75 BPS per call
        maxPeriodRewards = 1_000_000e6;      // 1M wYLDS absolute cap per call
        rewardPeriodSeconds = 3540;          // 59 min — 1 min buffer before hourly boundary to avoid block-timestamp drift
        maxTotalRewards = 10_000_000e6;      // 10M wYLDS lifetime cap (10× the per-call max); update via admin multisig
    }
    
    // ============ UUPS Required Override ============
    
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    // ============ Deposit & Withdraw Overrides ============
    
    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        return super.deposit(assets, receiver);
    }
    
    function depositWithPermit(
        uint256 assets,
        address receiver,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused nonReentrant returns (uint256 shares) {
        // Guard against permit front-running: a front-runner consuming the nonce also
        // sets the allowance, so deposit() via transferFrom() will still succeed.
        try IERC20Permit(asset()).permit(msg.sender, address(this), assets, deadline, v, r, s) {} catch {}
        return super.deposit(assets, receiver);
    }
    
    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        return super.mint(shares, receiver);
    }
    
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        return super.redeem(shares, receiver, owner);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        return super.withdraw(assets, receiver, owner);
    }
    
    // ============ Rewards Distribution ============
    
    // ============ Inflation Attack Protection ============
    
    /**
     * @dev Override totalAssets to use internal accounting instead of balanceOf
     * @notice Prevents inflation attacks via direct token transfers to the vault
     * @return Total wYLDS assets managed by the vault (deposits + rewards only)
     */
    function totalAssets() public view virtual override returns (uint256) {
        return _totalManagedAssets;
    }

    /**
     * @dev Convert wYLDS assets to PRIME shares using NAV when oracle is set.
     *
     * NAV = wYLDS per PRIME (1e18 scaled).
     * shares = assets * 1e18 / NAV
     *
     * Reverts if NAV oracle is not set — no fallback to ERC-4626 ratio.
     */
    function _convertToShares(uint256 assets, Math.Rounding rounding)
        internal
        view
        virtual
        override
        returns (uint256)
    {
        uint256 nav = getVerifiedNav(); // reverts if oracle not set or price stale
        return assets.mulDiv(1e18, nav, rounding);
    }

    /**
     * @dev Convert PRIME shares to wYLDS assets using NAV.
     * Reverts if NAV oracle is not set — no fallback to ERC-4626 ratio.
     *
     * assets = shares * NAV / 1e18
     */
    function _convertToAssets(uint256 shares, Math.Rounding rounding)
        internal
        view
        virtual
        override
        returns (uint256)
    {
        uint256 nav = getVerifiedNav(); // reverts if oracle not set or price stale
        return shares.mulDiv(nav, 1e18, rounding);
    }

    /**
     * @dev Override deposit to track assets internally
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) 
        internal 
        virtual 
        override 
    {
        if (assets == 0) revert ZeroAmount();
        _totalManagedAssets += assets;
        super._deposit(caller, receiver, assets, shares);
    }

    /**
     * @dev Override withdraw to track assets internally
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (assets == 0) revert ZeroAmount();
        _totalManagedAssets -= assets;
        super._withdraw(caller, receiver, owner, assets, shares);
    }
    
    /**
     * @dev Track rewards when distributed
     * @notice Follows checks-effects-interactions pattern
     * @dev Reverts if amount would increase totalAssets by more than maxRewardPercent
     */
    function distributeRewards(uint256 amount)
        external
        onlyRole(REWARDS_ADMIN_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();

        // Cooldown: enforce minimum time between distributions
        uint256 nextAllowed = lastRewardDistributedAt + rewardPeriodSeconds;
        if (block.timestamp < nextAllowed) revert RewardCooldownNotElapsed(nextAllowed);

        // Absolute per-call cap: prevent cross-chain TVL confusion and key-compromise amplification
        if (amount > maxPeriodRewards) revert ExceedsPeriodRewardCap(amount, maxPeriodRewards);

        // Lifetime cap: hard ceiling on total rewards ever minted through this vault
        uint256 remaining = maxTotalRewards - totalRewardsDistributed;
        if (amount > remaining) revert ExceedsLifetimeRewardCap(amount, remaining);

        // BPS cap: chain-local TVL proportionality check (skip when vault is empty)
        uint256 currentAssets = _totalManagedAssets;
        if (currentAssets > 0 && totalSupply() > 0) {
            uint256 maxAllowed = currentAssets.mulDiv(maxRewardPercent, 1e18);
            if (amount > maxAllowed) revert RewardExceedsMaxDelta(amount, maxAllowed);
        }

        // Effects: update state before external call
        lastRewardDistributedAt = block.timestamp;
        totalRewardsDistributed += amount;
        _totalManagedAssets += amount;

        // Interactions: mint wYLDS rewards to this vault
        IYieldVault(yieldVault).mintRewards(address(this), amount);

        emit RewardsDistributed(amount, block.timestamp);
    }

    /**
     * @notice Update the maximum reward percent allowed in a single distributeRewards call
     * @param newPercent New maximum in 1e18 units (e.g. 0.0075e18 = 75 bps). Must be > 0 and <= 1e18.
     */
    function setMaxRewardPercent(uint256 newPercent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newPercent == 0 || newPercent > 1e18) revert InvalidAmount();
        uint256 oldPercent = maxRewardPercent;
        maxRewardPercent = newPercent;
        emit MaxRewardPercentUpdated(oldPercent, newPercent);
    }

    /**
     * @notice Update the absolute per-call rewards cap.
     * @param newCap New cap in asset token units (e.g. 1_000_000e6 = 1M wYLDS). Must be > 0.
     */
    function setMaxPeriodRewards(uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newCap == 0) revert InvalidAmount();
        uint256 old = maxPeriodRewards;
        maxPeriodRewards = newCap;
        emit MaxPeriodRewardsUpdated(old, newCap);
    }

    /**
     * @notice Update the cooldown between reward distributions.
     * @param newSeconds Minimum seconds between calls. Must be > 0.
     */
    function setRewardPeriodSeconds(uint256 newSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSeconds == 0) revert InvalidAmount();
        uint256 old = rewardPeriodSeconds;
        rewardPeriodSeconds = newSeconds;
        emit RewardPeriodSecondsUpdated(old, newSeconds);
    }

    /**
     * @notice Update the lifetime rewards ceiling.
     * @param newMax New maximum total rewards in asset token units. Must be >= totalRewardsDistributed.
     */
    function setMaxTotalRewards(uint256 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMax < totalRewardsDistributed) revert InvalidAmount();
        uint256 old = maxTotalRewards;
        maxTotalRewards = newMax;
        emit MaxTotalRewardsUpdated(old, newMax);
    }

    /**
     * @notice Set the Chainlink FeedVerifier NAV oracle address and feed ID.
     * @param oracle Address of the deployed FeedVerifier contract. Use address(0) to clear/disable the oracle.
     * @param feedId Chainlink feedId this vault should read NAV from.
     */
    function setNavOracle(address oracle, bytes32 feedId) external onlyRole(NAV_ORACLE_UPDATER_ROLE) {
        address old = navOracle;
        navOracle = oracle;
        navFeedId = feedId;
        emit NavOracleUpdated(old, oracle, feedId);
    }

    /**
     * @notice Returns the latest verified NAV from the Chainlink oracle (1e18 scaled).
     * @dev Reverts if the oracle is not set or the price is <= 0.
     *      Staleness is enforced by FeedVerifier.priceOf() itself (via maxStaleness).
     * @return nav Exchange rate in 1e18 units (e.g. 1e18 = 1.0 wYLDS per share).
     */
    function getVerifiedNav() public view returns (uint256 nav) {
        if (navOracle == address(0)) revert InvalidAddress();
        int192 price = IFeedVerifier(navOracle).priceOf(navFeedId);
        if (price <= 0) revert NavInvalid();
        nav = uint256(uint192(price));
    }

    /**
     * @notice Returns the total vault assets denominated in the NAV-adjusted underlying value.
     * @dev totalAssets() is in wYLDS (6 decimals). NAV is 1e18 scaled.
     *      Result is in 1e18 * 1e6 = 1e24 units — divide by 1e18 to get USDC (6 decimals).
     * @return Total value = totalAssets * navRate / 1e18.
     */
    function getTotalValueAtNav() public view returns (uint256) {
        return Math.mulDiv(totalAssets(), getVerifiedNav(), 1e18);
    }
    
    // ============ Admin Functions ============
    
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function setYieldVault(address newVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newVault == address(0)) revert InvalidAddress();
        address oldVault = yieldVault;
        yieldVault = newVault;
        emit YieldVaultUpdated(oldVault, newVault);
    }
    
    // ============ View Functions ============

    function decimals() public view override(ERC4626Upgradeable, ERC20Upgradeable) returns (uint8) {
        return super.decimals();
    }
}