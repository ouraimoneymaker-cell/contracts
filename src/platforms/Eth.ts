import { IToken } from 'dequanto/models/IToken';
import { IPlatform } from './IPlatform';
import { Addresses } from '@s/constants';

const Tokens = {
    USDe: { address: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3" , decimals: 18 },
    sUSDe: { address: "0x9d39a5de30e57443bff2a8307a4256c8797a3497" , decimals: 18 },
    eUSDe: { address: "0x90d2af7d622ca3141efa4d8f1f24d86e5974cc8f" , decimals: 18 },
    sUSDS: { address: Addresses.eth.sUSDS, decimals: 18 },
    pUSDe: { address: Addresses.eth.pUSDe, decimals: 18 },

    USDC: { address: Addresses.eth.USDC, decimals: 6 },
    USDT: { address: Addresses.eth.USDT, decimals: 6 },

    NUSD: { address: Addresses.eth.NUSD, decimals: 18 },
    sNUSD: { address: Addresses.eth.sNUSD, decimals: 18 },

    DAI: { address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
    USDS: { address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F', decimals: 18 },

    mHYPER: { address: '0x9b5528528656DBC094765E2abB79F293c21191B9', decimals: 18 },

} as Record<string, Partial<IToken>>

export const Eth: IPlatform = {
    Tokens: Tokens,
    Feed: {
        stalePeriodAfter: '4hours'
    },

    mhyper: {
        oracle: '0x43881B05C3BE68B2d33eb70aDdF9F666C5005f68',
        depositVault: '0xbA9FD2850965053Ffab368Df8AA7eD2486f11024',
        redemptionVault: '0x6Be2f55816efd0d91f52720f096006d63c366e98',
    }
}
