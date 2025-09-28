import { $require } from 'dequanto/utils/$require';

export namespace $test {
    export async function eqDiff (a: number, b: number, diffExpected: number, msg: string = '') {
        let diff = Math.abs(a - b);
        let text = `Difference between ${a} and ${b} is too large: ${diff}; ${msg}`;
        $require.lt(diff, diffExpected, text);
    }
}
