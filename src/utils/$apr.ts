import { $bigint } from 'dequanto/utils/$bigint';

export namespace $apr {
    const DECIMALS = 12;

    export function toWei (apr: number) {
        return Number($bigint.toWei(apr, DECIMALS));
    }

    export function toEther (apr: number) {
        return $bigint.toEther(apr, DECIMALS);
    }

    export function final ($: number, apr: number, months: number = 12) {
        return $ + $ * apr * months /12;
    }

    export function value ($: number) {
        return new AprChain($);
    }

    class AprChain {
        constructor (public $: number) {

        }
        next (apr: number, months: number = 12) {
            this.$ = this.$ + this.$ * apr * months /12;
            return this.$;
        }
    }
}
