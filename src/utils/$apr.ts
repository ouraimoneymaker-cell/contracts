import { $bigint } from 'dequanto/utils/$bigint';
import { $date } from 'dequanto/utils/$date';
import { $number } from 'dequanto/utils/$number';

export namespace $apr {
    const DECIMALS = 12;

    export function toApy (apr: number | bigint) {
        if (typeof apr === 'bigint') {
            apr = $bigint.toEther(apr, 12);
        }
        if (apr > 1) apr /= 100;
        let apy = (1 + apr / 365) ** 365 - 1;
        apy *= 100;
        return $number.round(apy, 2, 'round');
    }

    export function toWei (apr: number) {
        return Number($bigint.toWei(apr, DECIMALS));
    }

    export function toEther (apr: number) {
        return $bigint.toEther(apr, DECIMALS);
    }

    export function calcAprSrt (params: {
        aprs: { target: number, base: number},
        risk: [number, number, number],
        tvls: { jrt: number, srt: number },
    }) {
        let { jrt, srt } = params.tvls;
        let { target, base } = params.aprs;
        let [x, y, k ] = params.risk;

        let tvlRatio = srt / (jrt + srt);
        let risk = x + y * tvlRatio ** k;
        let aprSrt1 = base * (1 - risk);
        let aprSrt = Math.max(target, aprSrt1);
        return aprSrt;
    }

    export function final ($: number, apr: number, dt: string = '1year') {
        return $ + Yield($, apr, dt);
    }
    export function Yield ($: number, apr: number, dt: string = '1year') {
        const seconds = $date.parseTimespan(dt, { get:'s' });
        const year = 365 * 24 * 60 * 60;
        return $ * apr * seconds / year;
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
