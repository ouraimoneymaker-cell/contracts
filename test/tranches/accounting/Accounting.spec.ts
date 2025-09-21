import { UTest } from 'atma-utest'
import { $hh } from '../utils/$hh';
import { Executor } from './Executor';

await $hh.test.deploy();

UTest.create({
    'sUSDe APY ⬆️🟢 SSR': {
        '➡️ deposit 50/50': {
            async 'accrue after 1 year' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [1000, 0, 1000, 0] },
                        { aprs: [ 0.1, 0.2 ] },
                        { eqNav: 2000 },
                        { time: '1year' },
                        { totalAssets: 2400 },
                        { eqAvg: [
                            1000 * 1.272, // ~27.2%
                            1000 * 1.127, // ~12.7%
                        ]}
                    ]
                });
            },
            async 'update in 0.5 year without yield' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [1000, 0, 1000, 0] },
                        { aprs: [ 0.1, 0.2 ] },
                        { eqNav: 2000 },
                        { time: '0.5year' },
                        // TVL will be rebalanced
                        { balanceFlow: [0, 0, 1, 0] },
                        { balanceFlow: [0, 0, 0, 1] },

                        { time: '0.5year' },
                        { totalAssets: 2400 },
                        { eqAvg: [
                            1000 * 1.272, // ~27.2%
                            1000 * 1.127, // ~12.7%
                        ]}
                    ]
                });
            },
        },

        '↗️ deposit 80srt/20jrt': {
            async 'accrue after 1 year' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [1600, 0, 400, 0] },
                        { aprs: [ 0.1, 0.2 ] },
                        { eqNav: 2000 },
                        { time: '1year' },
                        { totalAssets: 2400 },
                        { eqAvg: [
                            1600 * 1.216, // ~21.6% // 1945872540087149714534n
                            400 * 1.135, // ~13.5%  // 454127459912850285466n
                        ]}
                    ]
                });
            },
            async 'update in 0.5 year without yield' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [1600, 0, 400, 0] },
                        { aprs: [ 0.1, 0.2 ] },
                        { eqNav: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2400 },
                        { eqAvg: [
                            1600 * 1.216, // ~21.6% // 1944041424556765048577n
                            400 * 1.135, // ~13.5%  // 455958575443234951423n
                        ]}
                    ]
                });
            },
        },
        '↘️ deposit 20srt/80jrt': {
            async 'accrue after 1 year' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [400, 0, 1600, 0] },
                        { aprs: [ 0.1, 0.2 ] },
                        { eqNav: 2000 },
                        { time: '1year' },
                        { totalAssets: 2400 },
                        { eqAvg: [
                            400 * 1.509, // ~50.9% // 603855894440959176083n
                            1600 * 1.123, // ~12.3%  // 1796144105559040823917n
                        ]}
                    ]
                });
            },
            async 'update in 0.5 year without yield' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [400, 0, 1600, 0] },
                        { aprs: [ 0.1, 0.2 ] },
                        { eqNav: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2400 },
                        { eqAvg: [
                            400 * 1.504, //  ~50.4% // 597844558129791419106n
                            1600 * 1.124, // ~12.3% // 1802155441870208580894n
                        ]}
                    ]
                });
            },
        }
    },
    'sUSDe APY ⬇️🔴 SSR': {
        '➡️ deposit 50/50': {
            async 'accrue after 1 year' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [1000, 0, 1000, 0] },
                        { aprs: [ 0.15, 0.1 ] },
                        { eqNav: 2000 },
                        { time: '1year' },
                        { totalAssets: 2200 },
                        { eqAvg: [
                            1000 * 1.05, // ~5%
                            1000 * 1.15, // ~15%
                        ]}
                    ]
                });
            },
            async 'update in 0.5 year without yield' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [1000, 0, 1000, 0] },
                        { aprs: [ 0.15, 0.1 ] },
                        { eqNav: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2200 },
                        { eqAvg: [
                            1000 * 1.045, // ~4.5%
                            1000 * 1.155, // ~15.5%
                        ]}
                    ]
                });
            },
        },
        '↗️ deposit 80srt/20jrt': {
            async 'accrue after 1 year' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [1600, 0, 400, 0] },
                        { aprs: [ 0.15, 0.1 ] },
                        { eqNav: 2000 },
                        { time: '1year' },
                        { totalAssets: 2200 },
                        { eqAvg: [
                            1600 * 1.087, // ~8.7%
                            400 * 1.15, // ~15%
                        ]}
                    ]
                });
            },
            async 'update in 0.5 year without yield' () {

                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [1600, 0, 400, 0] },
                        { aprs: [ 0.15, 0.1 ] },
                        { eqNav: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2200 },
                        { eqAvg: [
                            1600 * 1.087, // ~8.7%
                            400 * 1.15, // ~15%
                        ]}
                    ]
                });

            },
        },
        '↘️ deposit 20srt/80jrt': {
            async 'accrue after 1 year' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [400, 0, 1600, 0] },
                        { aprs: [ 0.15, 0.1  ] },
                        { eqNav: 2000 },
                        { time: '1year' },
                        { totalAssets: 2200 },
                        { eqAvg: [
                            400 * 0.9,   // ~-10%
                            1600 * 1.15, // ~15%
                        ]}
                    ]
                });
            },
            async 'update in 0.5 year without yield' () {
                let exec = new Executor($hh.test);
                await exec.run({
                    steps: [
                        { balanceFlow: [400, 0, 1600, 0] },
                        { aprs: [ 0.15, 0.1  ] },
                        { eqNav: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2000 },
                        { time: '0.5year' },
                        { totalAssets: 2200 },
                        { eqAvg: [
                            400 * 0.88,   // ~-10%
                            1600 * 1.153, // ~15.3%
                        ]}
                    ]
                });
            },
        }
    }
});
