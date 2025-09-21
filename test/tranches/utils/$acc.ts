import { TEth } from 'dequanto/models/TEth';

export namespace $acc {
    export type Address = TEth.Address | TEth.IAccount | { address: TEth.Address, name?: any };

    export function toAddress(account: Address) {
        let address = typeof account === 'string'
            ? account
            : account.address;

        return address;
    }
}
