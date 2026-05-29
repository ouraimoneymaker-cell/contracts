import { SaturnTestHelper } from '@s/strategies/saturn/SaturnTestHelper';
import type { ICDO } from '../Tranches';

export const SaturnTranche = <ICDO> {
    base: 'USDat',
    fees: {
        retention: {
            jrt: 0.5, // 1 == 100%
            srt: 0.5,
        },
        performanceFee: 0.05, // 1 === 100%
    },
    minimumJrtSrtRatioBuffer: 0.08,
    minimumJrtSrtRatio: 0.075,
    riskPremium: {
        x: 1.0, // 100% — cancels aprBase from Senior APR
        y: 0,
        k: 0.3,
    },
    jrt: {
        symbol: 'jrUSDat',
        name: 'Strata Junior USDat',
        depositsEnabled: true,
        withdrawalsEnabled: true,
        sharesCooldown: [
            { covPct: 15, feeBps: 0, lock: '28days' },
            { covPct: 30, feeBps: 10, lock: '14days' },
            { covPct: 0, feeBps: 20, lock: 0 },
        ],
        sUSDatCooldown: 0,
    },
    srt: {
        symbol: 'srUSDat',
        name: 'Strata Senior USDat',
        depositsEnabled: true,
        withdrawalsEnabled: true,
        sharesCooldown: [
            { covPct: 15, feeBps: 0, lock: 0 },
            { covPct: 30, feeBps: 2.5, lock: 0 },
            { covPct: 0, feeBps: 5, lock: 0 },
        ],
        sUSDatCooldown: 0,
    },
    Feed: {
        name: 'Saturn CDO APR Pair',
    },
    Contracts: {
        '*': {
            AccessControlManager: 'SaturnAccessControlManager',
            ERC20Cooldown: 'SaturnERC20Cooldown',
            UnstakeCooldown: 'SaturnUnstakeCooldown',
            SharesCooldown: 'SaturnSharesCooldown',
        },
    },
    ContractVersions: {
        accounting: 'continuous',
    },
    TestHelper: SaturnTestHelper,
};
