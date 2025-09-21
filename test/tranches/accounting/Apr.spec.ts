import { UTest } from 'atma-utest'
import { $hh } from '../utils/$hh';
import { Executor } from './Executor';
import { $apr } from '@s/utils/$apr';

await $hh.test.deploy();
await $hh.test.snapshot();

UTest.create({
    async $teardown () {
        await $hh.test.reset();
    },
    async 'changes APR in the middle' () {
        let exec = new Executor($hh.test);
        let srt$ = $apr.value(1000);
        let jrt$ = $apr.value(1000);
        let nav$ = $apr.value(2000);

        await exec.run({
            steps: [
                { balanceFlow: [jrt$.$, 0, srt$.$, 0] },
                // APRssr == APRbase
                { aprs: [ 0.1, 0.1 ] },
                { time: '11months' },
                { totalAssets: nav$.next(.1, 11) }, // apr 10%

                { eqAvg: [ null, srt$.next(.1, 11) ]}, // ssr 10%

                { aprs: [ 0.8, 0.8 ] },
                { time: '1month' },
                { totalAssets: nav$.next(.8, 1)},
                { eqAvg: [
                    null,
                    srt$.next(.8, 1)
                ]}
            ]
        });
    },
    async 'changes APRssr only' () {
        let exec = new Executor($hh.test);
        let srt$ = $apr.value(1000);
        let jrt$ = $apr.value(1000);
        let nav$ = $apr.value(2000);

        await exec.run({
            steps: [
                { balanceFlow: [jrt$.$, 0, srt$.$, 0] },
                { aprs: [ 0.1, 0 ] },
                { time: '11months' },
                { totalAssets: nav$.$ },

                { eqAvg: [ null, srt$.next(.1, 11) ]},

                { aprs: [ 0.8, 0 ] },
                { time: '1month' },
                { totalAssets: nav$.$ },
                { eqAvg: [
                    null,
                    srt$.next(.8, 1)
                ]}
            ]
        });
    },
});
