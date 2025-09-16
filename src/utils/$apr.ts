import { $bigint } from 'dequanto/utils/$bigint';

export namespace $apr {
    const DECIMALS = 12;

    export function toWei (apr: number) {
        return Number($bigint.toWei(apr, DECIMALS));
    }

    export function toEther (apr: number) {
        return $bigint.toEther(apr, DECIMALS);
    }
}
