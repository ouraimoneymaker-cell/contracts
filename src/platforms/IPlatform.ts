import { IToken } from 'dequanto/models/IToken';
import { TEth } from 'dequanto/models/TEth';

export interface IPlatform {
    Tokens?: Record<string, Partial<IToken>>;

    Feed?: {
        stalePeriodAfter: string | '4hours'
    }

    Tranches?: Record<string, {
         jrt?: {
            depositsEnabled?: boolean
            withdrawalsEnabled?: boolean
            sUSDeCooldown?: string | number
        },
        srt?: {
            depositsEnabled?: boolean
            withdrawalsEnabled?: boolean
            sUSDeCooldown: string | number
        }
    }>
}

export interface IPlatformAccounts {
    deployer: TEth.IAccount
    safe: {
        admin: TEth.IAccount
        operator: TEth.IAccount
    }
    timelock: {
        admin: TEth.IAccount
        config: TEth.IAccount
    }
}
