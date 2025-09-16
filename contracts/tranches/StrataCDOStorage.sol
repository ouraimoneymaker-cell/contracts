// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;


import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IYieldAccounting} from "./interfaces/IYieldAccounting.sol";
import {IStrategy} from "./interfaces/IStrategy.sol";


contract StrataCDOStorage {

  IYieldAccounting public accounting;
  IStrategy public strategy;

  // address of AA Tranche token contract
  // address of BB Tranche token contract
  IERC4626 public srtVault;
  IERC4626 public jrtVault;


  // constant to represent 100%
  uint256 public constant FULL_ALLOC = 100000;
  // max fee, relative to FULL_ALLOC
  uint256 public constant MAX_FEE = 20000;
  // one token
  uint256 public constant ONE_TRANCHE_TOKEN = 10**18;
  // variable used to save the last tx.origin and block.number
  bytes32 internal _lastCallerBlock;
  // variable used to save the block of the latest harvest
  uint256 internal latestHarvestBlock;
  // WETH address
  address public weth;
  // [DEPRECATED] tokens used to incentivize the idle tranche ideal ratio
  address[] public incentiveTokens;



  // Flag for allowing AA withdraws
  bool public allowAAWithdraw;
  // Flag for allowing BB withdraws
  bool public allowBBWithdraw;
  // Flag for allowing to enable reverting in case the strategy gives back less
  // amount than the requested one
  bool public revertIfTooLow;
  // Flag to enable the `Default Check` (related to the emergency shutdown)
  bool public skipDefaultCheck;

  // address of the strategy token which represent the position in the lending provider
  address public strategyToken;

  // address for stkIDLE gating for AA tranche. addr(0) -> inactive, addr(1) -> active
  address public AAStaking;
  // address for stkIDLE gating for BB tranche. addr(0) -> inactive, addr(1) -> active
  address public BBStaking;

  // Apr split ratio for AA tranches
  // (relative to FULL_ALLOC so 50% => 50000 => 50% of the interest to tranche AA)
  uint256 public trancheAPRSplitRatio; //
  // [DEPRECATED] Ideal tranche split ratio in `token` value
  // (relative to FULL_ALLOC so 50% => 50000 means 50% of tranches (in value) should be AA)
  uint256 public trancheIdealWeightRatio;
  // Price for minting AA tranche, in underlyings
  uint256 public priceAA;
  // Price for minting BB tranche, in underlyings
  uint256 public priceBB;
  // last saved net asset value (in `token`) for AA tranches
  uint256 public lastNAVAA;
  // last saved net asset value (in `token`) for BB tranches
  uint256 public lastNAVBB;
  // last saved lending provider price
  uint256 public lastStrategyPrice;
  // Keeps track of unclaimed fees for feeReceiver
  uint256 public unclaimedFees;
  // Keeps an unlent balance both for cheap redeem and as 'insurance of last resort'
  uint256 public unlentPerc;

  // Fee amount (relative to FULL_ALLOC)
  uint256 public fee;
  // address of the fee receiver
  address public feeReceiver;

  // [DEPRECATED] trancheIdealWeightRatio ± idealRanges, used in updateIncentives
  uint256 public idealRange;
  // period, in blocks, for progressively releasing harvested rewards to users
  uint256 public releaseBlocksPeriod;
  // amount of rewards sold in the last harvest (in `token`)
  uint256 internal harvestedRewards;
  // stkAave address
  address internal constant stkAave = address(0x4da27a545c0c5B758a6BA100e3a049001de870f5);
  // aave address
  address internal constant AAVE = address(0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9);
  // if deposits will be put directly in the strategy
  bool public directDeposit;
  // referral address of the strategy developer
  address public referral;
  // amount of fee for feeReceiver. Max is FULL_ALLOC
  uint256 public feeSplit;

  // if Adaptive Yield Split is active
  bool public isAYSActive;
  // constant to represent 99% (for ADS AA ratio upper limit)
  uint256 internal constant AA_RATIO_LIM_UP = 99000;
  // constant to represent 50% (for ADS AA ratio lower limit)
  uint256 internal constant AA_RATIO_LIM_DOWN = 50000;
  // stkIDLE address
  address internal constant STK_IDLE = address(0xaAC13a116eA7016689993193FcE4BadC8038136f);
  // liquidity burned at first tranche deposit
  uint256 internal constant MIN_LIQUIDITY = 10**3;

  // Referral event
  event Referral(uint256 _amount, address _ref);
  // tolerance in underlyings when redeeming
  uint256 public liquidationTolerance;

  // Add new variables here. For each storage slot
  // used, reduce the __gap length by 1.
  // #######################
  // Min apr ratio for AA tranches when using AYS
  uint256 public minAprSplitAYS;
  // Max strategy price decrease before triggering a default
  uint256 public maxDecreaseDefault;
  // The tolerance for the loss socialized so equally distributed between junior and senior tranches.
  uint256 public lossToleranceBps;
  // Amount of stkIDLE required to mint 1 underlying
  uint256 public stkIDLEPerUnderlying;
  // uint256 public test;

  uint256[50] private __gap;
}
