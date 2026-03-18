import { IToken } from 'dequanto/models/IToken';
import { TEth } from 'dequanto/models/TEth';

export interface IPlatform {
    Tokens?: Record<string, Partial<IToken>>;

    Feed?: {
        name?: string;
        stalePeriodAfter: string | '4hours';
    };

    Tranches?: Record<
        string,
        {
            jrt?: {
                depositsEnabled?: boolean;
                withdrawalsEnabled?: boolean;
                sUSDeCooldown?: string | number;
            };
            srt?: {
                depositsEnabled?: boolean;
                withdrawalsEnabled?: boolean;
                sUSDeCooldown: string | number;
            };
        }
    >;

    mhyper?: {
        oracle: TEth.Address;
        depositVault: TEth.Address;
        redemptionVault: TEth.Address;
    };

    mm1usd?: {
        oracle: TEth.Address;
        depositVault: TEth.Address;
        redemptionVault: TEth.Address;
    };
}

export interface IPlatformAccounts {
    deployer: TEth.IAccount;
    safe: {
        admin: TEth.IAccount;
        operator: TEth.IAccount;
    };
    timelock: {
        admin: TEth.IAccount;
        config: TEth.IAccount;
    };
}
