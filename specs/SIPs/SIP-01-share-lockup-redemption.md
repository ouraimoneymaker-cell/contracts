---
SIP: 01
Title: Share Lock-Up Redemption Mechanism for Tranche Vaults
Author: Strata Protocol Contributors
Status: Draft
Type: Protocol
Created: 2025-12-15
---

# Tranche Vault — Share Lock-Up Redemption Specification

## 1. Overview

This specification defines a **share lock-up redemption mechanism** for Tranche Vaults (Junior and Senior tranches) that introduces a cooldown period on shares rather than on assets.

Under this mechanism:

* Users initiate a redemption request by transferring shares into a Silo Contract.
* Shares remain locked for a predefined lock-up period.
* After the lock-up period elapses, the user may finalize the redemption.
* The final exchange rate is determined at the time of finalization.
* Asset transfer occurs directly from the Tranche Vault at finalization.

This design preserves ERC-4626 compatibility while enabling delayed liquidity and controlled redemption flows.

---

## 2. Actors

* **User**: An externally owned account (EOA) or contract initiating a redemption.
* **Receiver**: An account that receives the assets upon redemption. Per the ERC-4626 specification, the receiver MAY be different from the User.
* **Tranche Vault**: An ERC-4626-compatible vault managing Junior or Senior tranche shares.
* **Silo Contract**: A custody contract responsible for holding locked shares and executing final redemption on behalf of users.
* **Strategy**: The underlying asset manager (may require unstaking prior to asset withdrawal, e.g., USDe).

---

## 3. Current Redemption Flow (Reference)

The current (non lock-up) redemption flow is as follows:

1. User calls `redeem` or `withdraw`
2. Vault calculates redeemable assets (excluding fees)
3. Vault burns the corresponding shares
4. Vault transfers assets:

   * Directly to the receiver, or
   * To an unstaking / cooldown contract used by the Strategy

---

## 4. Lock-Up Redemption Flow (When Enabled)

### 4.1 Redemption Request Phase

1. User initiates a redemption request via `redeem` or `withdraw`
2. Instead of burning shares:

   * The Tranche Vault transfers the specified shares to the Silo Contract
3. The Silo Contract records:

   * User address
   * Receiver address
   * Share amount
   * Lock-up end timestamp

At this stage:

* No assets are transferred
* No shares are burned
* The user cannot finalize the redemption before the lock-up period expires
* The user may cancel the lock-up; in this case, the request is dismissed and the shares are transferred back to the user.
* [PROPOSAL] Early-Exit: The user may pay additional finalization fee to unlock and withdraw the shares before lock-up period ends.

---

### 4.2 Finalization Phase

After the lock-up period has elapsed:

1. The user triggers finalization via the Silo Contract
2. The Silo Contract calls `redeem` on the Tranche Vault **on behalf of the user**
3. The Tranche Vault:

   * Detects that the caller is the Silo Contract
   * Skips any lock-up or cooldown logic
   * Skips fee accrual (if fees are active at the time of finalization)
   * Processes the redemption as a direct ERC4626 redemption request
4. The Tranche Vault:

   * Burns the locked shares
   * Calculates the redeemable assets using the **current exchange rate**
5. Asset handling:

   * If the asset is directly withdrawable, assets are transferred to the user
   * If unstaking is required (e.g. USDe), the unstaking process is executed before transfer
6. During finalization, the user MAY specify the desired output asset (e.g. USDe or sUSDe)

---

## 5. Exchange Rate Determination

* The exchange rate used for redemption is determined **at the time of finalization**
* No price or asset amount is snapshotted at request time
* Users remain fully exposed to vault performance (positive or negative) during the lock-up period

---

## 6. Fees

* No additional withdrawal or redemption fees are charged specifically due to the lock-up mechanism


---

## 7. Redemption Pause Handling (`PAUSER_ROLE`)

* If redemptions are fully paused at the Tranche Vault:

  * Finalization requests from the Silo Contract MUST revert
  * Locked shares remain held in the Silo Contract until redemptions are unpaused

---

## 8. Junior Tranche Redemption Limits

The protocol enforces a maximum redeemable amount to preserve the MINIMUM Junior / Senior ratio.

With the new lock-up mechanism, shares that are already locked in the Silo contract are not included in the ratio formula, meaning the Net Asset Value for a Tranche is changed to:

$$
\text{JuniorNAV} = \text{JuniorTVL} - \text{JuniorTVLInSilo}
$$

$$
\text{SeniorNAV} = \text{SeniorTVL} - \text{SeniorTVLInSilo}
$$

---

## 9. Multiple Withdrawal Requests

### 9.1 Request Granularity

* Each redemption request is treated as a distinct lock-up entry
* Each entry has its own:

  * Share amount
  * Lock-up end timestamp

---

### 9.2 Aggregated Finalization

* The Silo Contract MAY aggregate multiple completed lock-up entries
* Finalization may redeem the sum of all eligible completed requests in a single transaction

---

### 9.3 Request Spam Prevention

To prevent request spamming:

* A maximum of **N** simultaneous lock-up requests per user is enforced (currently **50**)
* Once the limit is reached:

  * Any new request:

    * Increases the share amount of the last request
    * Extends the lock-up end timestamp of that request

---

### 9.4 Request Finalizer Account

* A redemption request represents a **public intent** to exit the vault
* The receiver address is **recorded at request time** and **cannot be modified**
* The request has **no impact on the share exchange rate**

Based on these properties:

* The **finalization of a redemption request is permissionless**; any account MAY finalize an eligible redemption request.

---

🏁
