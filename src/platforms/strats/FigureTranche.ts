import { FigureTestHelper } from '@s/strategies/figure/FigureTestHelper';
import type { ICDO } from '../Tranches';

export const FigureTranche = <ICDO> {
    base: 'USDC',
    fees: {
        retention: {
            jrt: 0.5, // 1 == 100%
            srt: 0.5,
        },
        performanceFee: 0.05, // 1 === 100%
    },
    minimumJrtSrtRatioBuffer: 0.055,
    minimumJrtSrtRatio: 0.05,
    riskPremium: {
        x: 0.05,
        y: 0.075,
        k: 0.3,
    },
    jrt: {
        symbol: 'jrPRIME',
        name: 'Strata Junior PRIME',
        depositsEnabled: true,
        withdrawalsEnabled: true,
        sharesCooldown: [
            { covPct: 10, feeBps: 0, lock: '14days' },
            { covPct: 15, feeBps: 7.5, lock: '7days' },
            { covPct: 0, feeBps: 15, lock: 0 },
        ],
    },
    srt: {
        symbol: 'srPRIME',
        name: 'Strata Senior PRIME',
        depositsEnabled: true,
        withdrawalsEnabled: true,
        sharesCooldown: [
            { covPct: 10, feeBps: 0, lock: 0 },
            { covPct: 15, feeBps: 2.5, lock: 0 },
            { covPct: 0, feeBps: 5, lock: 0 },
        ],
    },
    Feed: {
        name: 'Figure CDO APR Pair',
    },
    ContractVersions: {
        accounting: 'discrete',
    },
    TestHelper: FigureTestHelper,
};
