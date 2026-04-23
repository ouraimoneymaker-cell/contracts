import { $bigint } from 'dequanto/utils/$bigint';
import { $require } from 'dequanto/utils/$require';

export namespace $test {

    export function eqDiff (a: bigint, b: bigint, diffExpected: bigint, msg?: string)
    export function eqDiff (a: number, b: number, diffExpected: number, msg?: string)
    export function eqDiff (a: number | bigint, b: number | bigint, diffExpected: number | bigint, msg: string = '') {
        let diff = typeof a === 'bigint'
            ? $bigint.abs((a as bigint) - (b as bigint))
            : Math.abs((a as number) - (b as number))
            ;
        let text = `Difference between ${a} and ${b} is too large: ${diff}; ${msg}`;
        $require.lte(diff, diffExpected, text);
    }
}
