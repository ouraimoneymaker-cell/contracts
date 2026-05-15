// SPDX-License-Identifier: Apache-2.0
//Source code: https://github.com/provenance-io/hastra-eth-vault/blob/main/contracts/YieldVault.sol
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title YieldVault
 * @author Hastra
 * @notice Upgradeable ERC-4626 yield-bearing vault
 */
contract MockYieldVault is 
    Initializable, 
    ERC4626Upgradeable, 
    ERC20PermitUpgradeable, 
    AccessControlUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable 
{
    
    // ============ Roles ============
    
    bytes32 public constant FREEZE_ADMIN_ROLE = keccak256("FREEZE_ADMIN");
    bytes32 public constant REWARDS_ADMIN_ROLE = keccak256("REWARDS_ADMIN");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant WHITELIST_ADMIN_ROLE = keccak256("WHITELIST_ADMIN");
    bytes32 public constant WITHDRAWAL_ADMIN_ROLE = keccak256("WITHDRAWAL_ADMIN");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    
    // ============ State Variables ============
    
    address public redeemVault;
    mapping(address => PendingRedemption) public pendingRedemptions;
    mapping(uint256 => RewardsEpoch) public rewardsEpochs;
    mapping(bytes32 => bool) public claimedRewards;
    uint256 public currentEpochIndex;
    
    /// @dev Storage gap for future upgrades (allows adding up to 42 new state variables)
    /// @dev 50 slots total - 8 used = 42 available
    uint256[42] private __gap;
    
    // ============ Structs ============
    
    struct PendingRedemption {
        uint256 shares;
        uint256 assets;
        uint256 timestamp;
    }
    
    struct RewardsEpoch {
        bytes32 merkleRoot;
        uint256 totalRewards;
        uint256 timestamp;
    }
    
    // ============ Events ============
    
    event RedemptionRequested(address indexed user, uint256 shares, uint256 assets, uint256 timestamp);
    event RedemptionCompleted(address indexed user, uint256 shares, uint256 assets, uint256 timestamp);
    event RedemptionCancelled(address indexed user, uint256 shares);
    event RewardsEpochCreated(uint256 indexed epochIndex, bytes32 merkleRoot, uint256 totalRewards, uint256 timestamp);
    event RewardsClaimed(address indexed user, uint256 indexed epochIndex, uint256 amount);
    event RedeemVaultUpdated(address indexed oldVault, address indexed newVault);
    event USDCWithdrawn(address indexed to, uint256 amount, address indexed by);
    
    // ============ Errors ============

    error NoRedemptionPending();
    error RedemptionAlreadyPending();
    error InvalidProof();
    error RewardsAlreadyClaimed();
    error InvalidEpoch();
    error InvalidAmount();
    error InvalidAddress();
    error InsufficientVaultBalance();
    
    // ============ Constructor ============
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    /**
     * @notice Initializes the YieldVault
     * @dev Grants only essential roles (DEFAULT_ADMIN, PAUSER, UPGRADER) to admin_.
     *      Additional roles (REWARDS_ADMIN, FREEZE_ADMIN, WHITELIST_ADMIN, WITHDRAWAL_ADMIN)
     *      should be granted to appropriate addresses post-deployment for role separation.
     */
    function initialize(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address admin_,
        address redeemVault_
    ) public initializer {
        if (admin_ == address(0) || redeemVault_ == address(0)) {
            revert InvalidAddress();
        }

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
        
        // Note: Additional roles (REWARDS_ADMIN, FREEZE_ADMIN, WHITELIST_ADMIN, WITHDRAWAL_ADMIN)
        // are intentionally NOT granted here to support role separation in production.
        // The deployment script (deploy.ts) grants these roles to separate addresses for
        // security best practices (principle of least privilege). This allows different
        // entities to control different aspects of the vault:
        //   - FREEZE_ADMIN can freeze/thaw accounts
        //   - REWARDS_ADMIN can distribute rewards and complete redemptions
        //   - WHITELIST_ADMIN can manage withdrawal whitelist
        //   - WITHDRAWAL_ADMIN can withdraw USDC to whitelisted addresses
        
        redeemVault = redeemVault_;

    }
    
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
    
    function withdraw(uint256, address, address) 
        public 
        pure 
        override 
        returns (uint256) 
    {
        revert("Use requestRedeem/completeRedeem");
    }
    
    function redeem(uint256, address, address) 
        public 
        pure 
        override 
        returns (uint256) 
    {
        revert("Use requestRedeem/completeRedeem");
    }
    
    // ============ Two-Step Redemption ============
    
    function requestRedeem(uint256 shares) external whenNotPaused nonReentrant {
        if (shares == 0) revert InvalidAmount();
        if (pendingRedemptions[msg.sender].shares != 0) {
            revert RedemptionAlreadyPending();
        }
        
        uint256 assets = convertToAssets(shares);
        _transfer(msg.sender, address(this), shares);
        
        pendingRedemptions[msg.sender] = PendingRedemption({
            shares: shares,
            assets: assets,
            timestamp: block.timestamp
        });
        
        emit RedemptionRequested(msg.sender, shares, assets, block.timestamp);
    }
    
    function completeRedeem(address user) 
        external 
        onlyRole(REWARDS_ADMIN_ROLE)
        nonReentrant 
    {
        PendingRedemption memory redemption = pendingRedemptions[user];
        if (redemption.shares == 0) revert NoRedemptionPending();
        
        uint256 vaultBalance = IERC20(asset()).balanceOf(redeemVault);
        if (vaultBalance < redemption.assets) {
            revert InsufficientVaultBalance();
        }
        
        delete pendingRedemptions[user];
        _burn(address(this), redemption.shares);
        
        SafeERC20.safeTransferFrom(
            IERC20(asset()),
            redeemVault,
            user,
            redemption.assets
        );
        
        emit RedemptionCompleted(user, redemption.shares, redemption.assets, block.timestamp);
    }
    
    function cancelRedeem() external nonReentrant {
        PendingRedemption memory redemption = pendingRedemptions[msg.sender];
        if (redemption.shares == 0) revert NoRedemptionPending();
        
        delete pendingRedemptions[msg.sender];
        _transfer(address(this), msg.sender, redemption.shares);
        
        emit RedemptionCancelled(msg.sender, redemption.shares);
    }
    
    // ============ Merkle Rewards ============
    
    function createRewardsEpoch(
        uint256 epochIndex,
        bytes32 merkleRoot,
        uint256 totalRewards
    ) external onlyRole(REWARDS_ADMIN_ROLE) {
        if (epochIndex != currentEpochIndex) revert InvalidEpoch();
        if (merkleRoot == bytes32(0)) revert InvalidAmount();
        
        rewardsEpochs[epochIndex] = RewardsEpoch({
            merkleRoot: merkleRoot,
            totalRewards: totalRewards,
            timestamp: block.timestamp
        });
        
        currentEpochIndex++;
        emit RewardsEpochCreated(epochIndex, merkleRoot, totalRewards, block.timestamp);
    }
    
    function claimRewards(
        uint256 epochIndex,
        uint256 amount,
        bytes32[] calldata proof
    ) external whenNotPaused nonReentrant {
        if (epochIndex >= currentEpochIndex) revert InvalidEpoch();
        
        bytes32 claimKey = keccak256(abi.encodePacked(msg.sender, epochIndex));
        if (claimedRewards[claimKey]) revert RewardsAlreadyClaimed();
        
        RewardsEpoch memory epoch = rewardsEpochs[epochIndex];
        
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(msg.sender, amount, epochIndex)))
        );
        
        if (!MerkleProof.verify(proof, epoch.merkleRoot, leaf)) {
            revert InvalidProof();
        }
        
        claimedRewards[claimKey] = true;
        _mint(msg.sender, amount);
        emit RewardsClaimed(msg.sender, epochIndex, amount);
    }
    
    function mintRewards(address to, uint256 amount)
        external
        onlyRole(REWARDS_ADMIN_ROLE)
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();
        if (to == address(0)) revert InvalidAddress();
        _mint(to, amount);
    }
    
    // ============ Admin Functions ============
    
    function setRedeemVault(address newRedeemVault) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (newRedeemVault == address(0)) revert InvalidAddress();
        address oldVault = redeemVault;
        redeemVault = newRedeemVault;
        emit RedeemVaultUpdated(oldVault, newRedeemVault);
    }
    
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
    
    // ============ View Functions ============

    function convertToShares(uint256 assets) public pure override returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) public pure override returns (uint256) {
        return shares;
    }

    function _convertToShares(uint256 assets, Math.Rounding /*rounding*/) internal pure override returns (uint256) {
        return assets;
    }

    function _convertToAssets(uint256 shares, Math.Rounding /*rounding*/) internal pure override returns (uint256) {
        return shares;
    }

    function decimals() public view override(ERC4626Upgradeable, ERC20Upgradeable) returns (uint8) {
        return super.decimals();
    }

    function getPendingRedemption(address user) 
        external 
        view 
        returns (bool hasPending, uint256 shares, uint256 assets) 
    {
        PendingRedemption memory redemption = pendingRedemptions[user];
        return (
            redemption.shares != 0,
            redemption.shares,
            redemption.assets
        );
    }
    
    function hasClaimedRewards(address user, uint256 epochIndex) 
        external 
        view 
        returns (bool claimed) 
    {
        bytes32 claimKey = keccak256(abi.encodePacked(user, epochIndex));
        return claimedRewards[claimKey];
    }
}