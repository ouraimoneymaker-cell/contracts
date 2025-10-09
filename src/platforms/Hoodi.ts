import { IToken } from 'dequanto/models/IToken';
import { IPlatform } from './IPlatform';
import { Addresses } from '@s/constants';

const Tokens = {
    USDe: { address: "0x7054A803361640970176Edbd91992DcC52B7D235" , decimals: 18 },
    sUSDe: { address: "0x789d3D9AA2EFDda01f0402a632803158F21cCe05" , decimals: 18 },
    pUSDe: { address: Addresses.hoodi.pUSDe, decimals: 18 },
} as Record<string, Partial<IToken>>

export const Hoodi: IPlatform = {
    Tokens: Tokens,
    Feed: {
        stalePeriodAfter: '48hours'
    },
    Tranches: {
        'ethena': {
            jrt: {
                depositsEnabled: true,
                withdrawalsEnabled: true,
                sUSDeCooldown: '1hour'
            },
            srt: {
                depositsEnabled: true,
                withdrawalsEnabled: true,
                sUSDeCooldown: 0
            }
        }
    }
}
