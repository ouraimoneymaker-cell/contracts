import { IToken } from 'dequanto/models/IToken';
import { IPlatform } from './IPlatform';

const Tokens = {
    USDe: { address: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3" , decimals: 18 },
    sUSDe: { address: "0x9d39a5de30e57443bff2a8307a4256c8797a3497" , decimals: 18 },
    eUSDe: { address: "0x90d2af7d622ca3141efa4d8f1f24d86e5974cc8f" , decimals: 18 }
} as Record<string, Partial<IToken>>

export const Eth: IPlatform = {
    Tokens: Tokens,
    Feed: {
        stalePeriodAfter: '4hours'
    }
}
