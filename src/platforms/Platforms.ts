import { Eth } from './eth';

export const Platforms = {
    eth: Eth,
    hardhat: {
        Feed: {
            stalePeriodAfter: '5years'
        }
    }
} as Record<string, typeof Eth>;
