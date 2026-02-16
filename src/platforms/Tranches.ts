import { TEth } from 'dequanto/models/TEth';
import { $date } from 'dequanto/utils/$date';

export type TCDOKey = 'ethena' | 'neutrl'
export interface ICDO {
    // token symbol
    base: string;
    jrt: {
        symbol: string
        name: string
        depositsEnabled: boolean
        withdrawalsEnabled: boolean

        sharesCooldown?: [
            { covPct: number, feeBps: number, lock: string | number },
            { covPct: number, feeBps: number, lock: string | number },
            { covPct: number, feeBps: number, lock: string | number },
        ]

        // additional configuration
        [key: string]: any
    }
    srt: {
        symbol: string,
        name: string
        depositsEnabled: boolean,
        withdrawalsEnabled: boolean,

        sharesCooldown?: [
            { covPct: number, feeBps: number, lock: string | number },
            { covPct: number, feeBps: number, lock: string | number },
            { covPct: number, feeBps: number, lock: string | number },
        ]

        // additional configuration
        [key: string]: any
    }
    fees?: {
        retention?: {
            // 1 == 100%
            jrt: number
            srt: number
        },
        // reserveFee: 1 === 100%
        performanceFee: number
    }
    riskPremium?: {
        x: number
        y: number
        k: number
    }
    minimumJrtSrtRatioBuffer?: number
    minimumJrtSrtRatio?: number
    accounts?: {
        [platform: TEth.Platform]: {
            deployer: string
            timelockAdmin: string
            timelockConfig: string
            safeAdmin: string
            safeOperator: string
        }
    }
    Feed?: {
        name?: string
    },
    Contracts?: {
        [platform: TEth.Platform | '*']: {
            AccessControlManager?: string
            SharesCooldown?: string
            ERC20Cooldown?: string
            UnstakeCooldown?: string
        }
    }
}


export const Tranches: Record<TCDOKey, ICDO> = {
    'ethena': {
        base: 'USDe',
        jrt: {
            symbol: 'jrUSDe',
            name: 'Strata Junior USDe',
            depositsEnabled: true,
            withdrawalsEnabled: true,
            sUSDeCooldown: '7days'
        },
        srt: {
            symbol: 'srUSDe',
            name: 'Strata Senior USDe',
            depositsEnabled: true,
            withdrawalsEnabled: true,
            sUSDeCooldown: 0
        },
        Feed: {
            name: 'Ethena CDO APR Pair'
        }
    },
    'neutrl': {
        base: 'NUSD',
        fees: {
            retention: {
                jrt: .5, // 1 == 100%
                srt: .5,
            },
            performanceFee: .072 // 1 === 100%
        },
        minimumJrtSrtRatioBuffer: 0.01,
        minimumJrtSrtRatio: 0.009,
        riskPremium: {
            x: 0.15,
            y: 0.15,
            k: 0.3
        },
        jrt: {
            symbol: 'jrNUSD',
            name: 'Strata Junior NUSD',
            depositsEnabled: true,
            withdrawalsEnabled: true,

            sharesCooldown: [
                { covPct: 10, feeBps: 0,   lock: '35days' },
                { covPct: 20, feeBps: 10,  lock: '10days' },
                { covPct: 0,  feeBps: 20,  lock: 0 },
            ]
        },
        srt: {
            symbol: 'srNUSD',
            name: 'Strata Senior NUSD',
            depositsEnabled: true,
            withdrawalsEnabled: true,

            sharesCooldown: [
                { covPct: 10, feeBps: 0,   lock: 0 },
                { covPct: 20, feeBps: 2.5, lock: 0 },
                { covPct: 0,  feeBps: 5,   lock: 0 },
            ]
        },
        accounts: {

        },
        Feed: {
            name: 'Neutrl CDO APR Pair'
        },
        Contracts: {
            '*': {
                AccessControlManager: 'NeutrlAccessControlManager',
                ERC20Cooldown: 'NeutrlERC20Cooldown',
                UnstakeCooldown: 'NeutrlUnstakeCooldown',
                SharesCooldown: 'NeutrlSharesCooldown'
            }
        }
    }
}

export const ContractsIDMapping = {
    'jrUSDe': 'USDeJrt',
    'srUSDe': 'USDeSrt',
    'USDe': 'USDeCDO',
}

export const ContractsPrefixMapping = {
    'ethena': 'USDe',
    'neutrl': 'Neutrl',
} as Record<TCDOKey, string>
