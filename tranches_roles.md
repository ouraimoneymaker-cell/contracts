## AccessControlManager

[0x1d19E18ECaC4ef332a0d5d6Aa3a0f0f772605f60](https://etherscan.io/address/0x1d19E18ECaC4ef332a0d5d6Aa3a0f0f772605f60)

----

Contract to manage roles for the permission based methods.

ADMIN: [48h-timelock](https://etherscan.io/address/0xB2A3CF69C97AFD4dE7882E5fEE120e4efC77B706)

### Roles:

#### `PAUSER_ROLE`

**Callable by**: Admin Multisig
**Description**: Allows granular pausing or resuming of deposits and redemptions in the Senior or Junior Tranches.


- `StrataCDO::setActionStates` - Sets action states for the tranche
- `StrataCDO::setJrtShortfallPausePrice` - Sets the JRT shortfall price to automatically pause the deposits, when the price falls below this price

#### `UPDATER_FEED_ROLE`

**Callable by**: Operator Multisig
**Description**: Can trigger the APR refetch and recalculation process.

- `Accounting::onAprChanged` - Trigger fetching new APRs to update srtTargetIndex
- `AprPairFeed::updateRoundData` - Pulls APR values from the strategy provider and pushes new values when a deviation is detected.


#### `UPDATER_STRAT_CONFIG_ROLE`

**Callable by**: 24h timelock
**Description**: Modifies Premium Risk parameters and redemption cooldown periods for the underlying assets.

- `Accounting::setRiskParameters`
- `sUSDeStrategy::setCooldowns`

#### `RESERVE_MANAGER_ROLE`

**Callable by**: 24h timelock
**Description**: Redistributes reserve back to the Tranches’ TVL or withdraws reserve accumulated by the protocol to the treasury wallet.

- `StrataCDO::reduceReserve` - Reduces the reserve and transfers tokens to the treasury
- `StrataCDO::distributeReserve` - Reduces the reserve by distributing assets to the tranches
- `StrataCDO::setReserveTreasury` - Sets the address of the reserve treasury

#### `OWNER_ROLE`

**Callable by**: 48h timelock
**Description**: High-level protocol methods that modify the configuration.

- `Accounting::setAprPairFeed` - Sets the APRs Feed contract for fetching APR target and APR base
- `Accounting::setReserveBps` - Sets the percentage of gains allocated to the reserve
- `Accounting::setFeeRetentionBps` - Sets the portion of fees from each tranche that is returned to its TVL. The remainder goes to the reserve.
- `Accounting::setMinimumJrtSrtRatio` - Sets the hard minimum Jrt/Srt ratio below which Jrt withdrawals are blocked.
- `Accounting::setMinimumJrtSrtRatioBuffer` - Sets the protective buffer ratio at which Srt deposits are halted.
- `UnstakCooldown::setImplementations` - Sets the Unstake implementation for supported tokens, e.g. sUSDe.
- `AprPairFeed::setProvider` - Sets a new APR provider to calculate current APRs on-chain
- `AprPairFeed::setRoundStaleAfter`- Sets the duration after which a round is considered stale
