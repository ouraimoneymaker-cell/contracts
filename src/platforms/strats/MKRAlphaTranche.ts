
import { MKRAlphaTestHelper } from '@s/strategies/midas/MKRAlphaTestHelper';
import type { ICDO } from '../Tranches';

export const MKRAlphaTranche = <ICDO> {
    base: 'USDC',
    fees: {
        retention: {
            jrt: 0.5, // 1 == 100%
            srt: 0.5,
        },
        performanceFee: 0.075, // 1 === 100%
    },
    riskPremium: {
        x: 0.125,
        y: 0.15,
        k: 0.3,
    },
    jrt: {
        symbol: 'jrmKRALPHA',
        name: 'Strata Junior mKRALPHA',
        depositsEnabled: true,
        withdrawalsEnabled: true,
        sharesCooldown: [
            { covPct: 10, feeBps: 0, lock: '21days' },
            { covPct: 20, feeBps: 10, lock: '7days' },
            { covPct: 0, feeBps: 20, lock: 0 },
        ],
    },
    srt: {
        symbol: 'srmKRALPHA',
        name: 'Strata Senior mKRALPHA',
        depositsEnabled: true,
        withdrawalsEnabled: true,
        sharesCooldown: [
            { covPct: 10, feeBps: 0, lock: 0 },
            { covPct: 20, feeBps: 2.5, lock: 0 },
            { covPct: 0, feeBps: 5, lock: 0 },
        ],
    },
    Feed: {
        name: 'mKRAlpha CDO APR Pair',
    },
    ContractVersions: {
        accounting: 'dys',
    },
    TestHelper: MKRAlphaTestHelper,
};
