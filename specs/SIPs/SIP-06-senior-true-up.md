# SIP 06: Senior True-Up

## Overview

This SIP defines the mechanism for reconciling Senior (SRT) NAV at epoch boundaries under Discrete Accounting.

During the epoch:

- Senior NAV (`srtNav`) is continuously increased using projected returns
- This increase is funded by a continuous transfer of value from Junior (JRT)

At reconciliation:

- Realized PnL from the underlying strategy replaces the projected Senior PnL

This ensures:

- Smooth NAV evolution during the epoch
- Correct economic allocation at true-up

## Terminology

- **PnL**: Absolute profit/loss over the epoch (can be negative)
- **Gain**: Deprecated, replaced by PnL
- **srtNav**: Senior NAV during the epoch. Includes projected PnL and represents effective Senior assets
- **jrtNav**: Junior real NAV after continuous transfers to Senior
- **jrtNavProjected**: Junior NAV used for projection
- **srtPnLProjected**: Accumulated projected Senior PnL during the epoch
- **srtNavTime / jrtNavTime**: Time-weighted NAV (asset-time) - includes the Projected Assets, Projected PnL
- **srtProjectedPnLTime**: Time-weighted Senior PnL Projection to calculate later the `srtNavTimeNet`
- **navTime**: Total system asset-time (incl. projection)
- **navTimeNet**: Total system asset-time (excl. projection)

## Senior NAV During the Epoch

Senior NAV is continuously increased using projected returns:

```solidity
srtNav += calculatedPnL;
srtPnLProjected += calculatedPnL;
```

Important:

- `srtNav` is both:
  - projected NAV
  - effective Senior asset balance during the epoch
- this works because projected PnL is continuously transferred from Junior to Senior
- therefore, Junior NAV decreases accordingly during the epoch

## Asset-Time Tracking (DYS)

To correctly compute the true-up, the system MUST track time-weighted NAV.

### Accrual Rule

On every deposit, redemption, and before reconciliation:

```solidity
function _accrueAssetTime() internal {
    uint256 dt = block.timestamp - lastAccrual;
    if (dt == 0) return;

    uint256 srAssets = srtNav;
    uint256 jrAssets = jrtNavProjected;
    uint256 systemAssets = srAssets + jrAssets + reserveNav;

    srtNavTime += srAssets * dt;
    jrtNavTime += jrAssets * dt;
    navTime    += systemAssets * dt;

    lastAccrual = block.timestamp;
}
```

Critical:

- MUST be called **before any state change**
- MUST use the same NAV definition as accounting (`srtNav`)

## True-Up (Reconciliation)

At epoch end:

1. Accrue asset-time up to the current timestamp
2. Use realized PnL from the underlying strategy

### Senior Allocation

```
srtFactor = (1 - RiskPremium)
srtPnL = PnL * srtFactor * srtNavTime / navTime
```

### Senior Floor

```
avgSrAssets = srtNavTime / T
srtFloorPnL = (-10 bps) * avgSrAssets
srtPnL = max(srtPnL, srtFloorPnL)
```

### Junior Allocation

```
jrtPnL = PnL - srtPnL
```

## True-Up Based on Exchange Rates

The contract may track the underlying exchange rate at the projection start (`rateT0`) and at the reconciliation (`rateT1`) to calculate the expected realized PnL for Seniors.
This allows tracking specific sub-strategy performance in multi-strategy setups.

### NAV Updates

```solidity
// Junior
jrtNav = jrtNav + jrtPnL;
jrtNavProjected = jrtNav;

// Senior
srtNav = srtNav - srtPnLProjected + srtPnL;
srtPnLProjected = 0;
```

Explanation:

- during the epoch, `srtNav` includes projected PnL
- at true-up:
  - remove projected PnL
  - add realized PnL
- Junior absorbs the difference

### Reset After True-Up

```solidity
srtNavTime = 0;
jrtNavTime = 0;
navTime = 0;
srtPnLProjected = 0;

lastAccrual = block.timestamp;
```

### Summary

Senior PnL is computed as:

```
srtPnL = PnL * (1 - RiskPremium) * (srtNavTime / navTime)
```

This formulation:

- avoids explicit APR conversion
- is consistent with DYS-based accounting
- correctly reflects time-weighted exposure

# Daily Loss Floor (Senior Tranche)

The Accounting contract must enforce a configurable **daily loss floor** for the Senior tranche (e.g. `-0.1%` per day).

To ensure deterministic and path-independent behavior, the floor is implemented using a **rolling 24h window with a fixed NAV anchor**.

### Definitions

At the beginning of each window, store:

- `windowStartSrtNav` — Senior NAV at window start (anchor)
- `windowNetFlows` — cumulative net Senior deposits and withdrawals during the window
- `windowEnd` — end timestamp of the current window

### Core formulas

Daily allowed loss:

```
allowedLoss = windowStartSrtNav * floorRate
```

Where:

- `floorRate = 0.001` (for -0.1%)

Senior NAV floor:

```
srtNavFloor = windowStartSrtNav + windowNetFlows - allowedLoss
```

Net flows are tracked as:

```
windowNetFlows = windowNetFlows + srtAssetsIn - srtAssetsOut
```

This ensures deposits and withdrawals are excluded from PnL.

### Accounting during the window

At each accounting step:

```
srtNavRealized = srtNav + realizedPnL

srtNav = max(srtNavRealized, srtNavFloor)
```

Properties:

- `allowedLoss` is **constant within the window**
- `srtNavFloor` changes only due to `windowNetFlows`
- any loss below the floor is absorbed by Junior NAV
- gains are unrestricted

### Window rollover

When:

```
block.timestamp >= windowEnd
```

#### Step 1 — extend allowed loss for inactivity

If no interaction occurred exactly at `windowEnd`, additional loss allowance must be granted for the elapsed time:

```
dT = block.timestamp - windowEnd
```

Then recompute the total allowed loss from the original **window-start Senior NAV anchor**:

```
allowedLoss = windowStartSrtNav * floorRate

extraLossFromOverflow = windowStartSrtNav * floorRate * dT / 24 hours
allowedLoss += extraLossFromOverflow
```

Equivalent one-line form:

```
allowedLoss = windowStartSrtNav * floorRate * (24 hours + dT) / 24 hours
```

#### Step 2 — apply accounting with updated allowedLoss

```
srtNavFloor = windowStartSrtNav + windowNetFlows - allowedLoss
srtNav = max(srtNavRealized, srtNavFloor)
```

#### Step 3 — start a new window

```
windowStartSrtNav = srtNav
windowNetFlows = 0
windowEnd = block.timestamp + 24 hours
```

#### Key properties

- Floor is enforced relative to a **fixed NAV anchor**
- Floor is **sticky within each window**
- Loss allowance **accumulates over time** during inactivity
- No dependency on calendar timestamps (e.g. midnight)
