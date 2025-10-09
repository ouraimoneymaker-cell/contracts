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
