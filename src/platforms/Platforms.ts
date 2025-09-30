import { Eth } from './Eth';
import { Hoodi } from './Hoodi';

export const Platforms = {
    eth: Eth,
    hoodi: Hoodi,
    hardhat: {
        Feed: {
            stalePeriodAfter: '5years'
        }
    }
} as Record<string, typeof Eth>;
