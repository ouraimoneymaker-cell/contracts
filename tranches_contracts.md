## **Contracts Overview**

### **srUSDe**

**Address:** [`0x3d7d6fdf07EE548B939A80edbc9B2256d0cdc003`](https://etherscan.io/address/0x3d7d6fdf07EE548B939A80edbc9B2256d0cdc003)
**Description:**
Senior Tranche - an ERC-4626 Meta Vault that supports deposits and redemptions in multiple tokens.

---

### **jrUSDe**

**Address:** [`0xC58D044404d8B14e953C115E67823784dEA53d8F`](https://etherscan.io/address/0xC58D044404d8B14e953C115E67823784dEA53d8F)
**Description:**
Junior Tranche - uses the same codebase as the Senior Tranche. The differentiation in rewards and behavior is handled by the **StrataCDO**.

---

### **StrataCDO**

**Address:** [`0x908B3921aaE4fC17191D382BB61020f2Ee6C0e20`](https://etherscan.io/address/0x908B3921aaE4fC17191D382BB61020f2Ee6C0e20)
**Description:**
Strata CDO Orchestrator - connects all the core protocol components:

* Tranches
* Accounting
* Strategy

---

### **Accounting**

**Address:** [`0xa436c5Dd1Ba62c55D112C10cd10E988bb3355102`](https://etherscan.io/address/0xa436c5Dd1Ba62c55D112C10cd10E988bb3355102)
**Description:**
Performs raw TVL calculations for the Junior, Senior, and Reserve TVLs. Tracks balances, asset inflows and outflows, accrues fees, and distributes rewards.

---

### **AprPairFeed**

**Address:** [`0x2bb416614D740E5313aA64A0E3e419B39e800EC2`](https://etherscan.io/address/0x2bb416614D740E5313aA64A0E3e419B39e800EC2)
**Description:**
Provides the Collateral and Benchmark APY values used by the Accounting contract for TVL and reward calculations.

---

### **AaveAprPairProvider**

**Address:** [`0x1c137776e04803F807616c382AbBA12d9BF0AF73`](https://etherscan.io/address/0x1c137776e04803F807616c382AbBA12d9BF0AF73)
**Description:**
Fetches and computes the raw APR values from Aave - including both the current Benchmark APR and the Collateral APR from the sUSDe Vault.

---

### **sUSDeStrategy**

**Address:** [`0xdbf4FB6C310C1C85D0b41B5DbCA06096F2E7099F`](https://etherscan.io/address/0xdbf4FB6C310C1C85D0b41B5DbCA06096F2E7099F)
**Description:**
Handles deposits of USDe into the sUSDe Vault. Accepts also sUSDe as-is.
During redemptions, transfers USDe or sUSDe back to users.

* For **instant withdrawals**, tokens are transferred immediately.
* For **cooldown-based withdrawals**, tokens are routed through the appropriate cooldown contract (either `ERC20Cooldown` or `UnstakeCooldown`).

---

### **ERC20Cooldown**

**Address:** [`0xd6dAD17d025cDdDEd27305aEbAB8b277996A6fAF`](https://etherscan.io/address/0xd6dAD17d025cDdDEd27305aEbAB8b277996A6fAF)
**Description:**
Locks ERC-20 tokens for a specified cooldown period, after which the user can finalize the withdrawal.

---

### **UnstakeCooldown**

**Address:** [`0x735edDF50Ca2371aa48466469C742e684c610F74`](https://etherscan.io/address/0x735edDF50Ca2371aa48466469C742e684c610F74)
**Description:**
Handles the unstaking process when an asset requires unstaking before withdrawal.
Once the unstake period is completed, the user can finalize the withdrawal.

---

### **SUSDeCooldownRequestImpl**

**Address:** [`0x00A96056c30A22b684fF7a09F4A0AfEaE426dde2`](https://etherscan.io/address/0x00A96056c30A22b684fF7a09F4A0AfEaE426dde2)
**Description:**
Implements the cooldown and unstaking logic specifically for **sUSDe** withdrawals.

---

### **TrancheDepositor**

**Address:** [`0x50E850641F43F65BF8fB3a7d0CF082a1D252F47e`](https://etherscan.io/address/0x50E850641F43F65BF8fB3a7d0CF082a1D252F47e)
**Description:**
Utility contract that handles deposits through various sources - for example, using `pUSDe` redemptions or swap routes involving `USDe` and `sUSDe` - before depositing into a Tranche.


## Strata Contracts Summary

All mainnet deployments can be found in the [**deployments/deployments-eth.json**](./deployments/deployments-eth.json) file.
