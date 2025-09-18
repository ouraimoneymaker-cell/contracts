import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeploy } from '../../../src/deployments/TranchesDeploy';
import { UAction } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { AprTupleFeed } from '@0xc/hardhat/AprTupleFeed/AprTupleFeed';
import { $apr } from '../../../src/utils/$apr';
import { $bigint } from 'dequanto/utils/$bigint';
import { YieldAccounting } from '@0xc/hardhat/YieldAccounting/YieldAccounting';
import { StrataCDO } from '@0xc/hardhat/StrataCDO/StrataCDO';
import { $date } from 'dequanto/utils/$date';
import { $block } from 'dequanto/utils/$block';
import { l } from 'dequanto/utils/$logger';
import { $accounting } from '../utils/$accounting';


let hh = new HardhatProvider();
let client = await hh.client('localhost');
let deployer = await hh.deployer(0);


let deploy = new TranchesDeploy({
    client,
    deployer
});

let snapshotId;

let { USDe, sUSDe } = await deploy.ensureEthena();
let { jrtVault, srtVault, cdo, strategy, accounting, feed } = await deploy.ensureEthenaCDO();

UAction.create({
    async $before () {
        snapshotId = await client.debug.snapshot();
    },
    async $teardown () {
        await client.debug.revert(snapshotId);
    },

    'sUSDe APY ⬆️🟢 SSR': {
        async $teardown () {
            await client.debug.revert(snapshotId);
        },
        '➡️ deposit 50/50': {
            async $teardown () {
                await client.debug.revert(snapshotId);
            },
            async 'accrue after 1 year' () {
                let exec = new Executor(deploy);
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
                let exec = new Executor(deploy);
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
            async $teardown () {
                await client.debug.revert(snapshotId);
            },
            async 'accrue after 1 year' () {
                let exec = new Executor(deploy);
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
                let exec = new Executor(deploy);
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
            async $teardown () {
                await client.debug.revert(snapshotId);
            },
            async 'accrue after 1 year' () {
                let exec = new Executor(deploy);
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
                let exec = new Executor(deploy);
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
        async $teardown () {
            await client.debug.revert(snapshotId);
        },
        '➡️ deposit 50/50': {
            async $teardown () {
                await client.debug.revert(snapshotId);
            },
            async 'accrue after 1 year' () {
                let exec = new Executor(deploy);
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
                let exec = new Executor(deploy);
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
            async $teardown () {
                await client.debug.revert(snapshotId);
            },
            async 'accrue after 1 year' () {
                let exec = new Executor(deploy);
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

                let exec = new Executor(deploy);
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
        '!↘️ deposit 20srt/80jrt': {
            async $teardown () {
                await client.debug.revert(snapshotId);
            },
            async 'accrue after 1 year' () {
                let exec = new Executor(deploy);
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
                let exec = new Executor(deploy);
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

namespace Updater {
    let cdo: StrataCDO;
    let accounting: YieldAccounting;
    export async function impersonate (cdo_: StrataCDO, accounting_: YieldAccounting) {
        cdo = cdo_;
        accounting = accounting_;
        await client.debug.setBalance(cdo.address, 10n**18n);
        await client.debug.impersonateAccount(cdo.address);
    }
    export async function balanceFlow(jrtIn: number, jrtOut: number, srtIn: number, srtOut: number) {
        await accounting.$receipt().updateBalanceFlow(
            cdo,
            $bigint.toWei(jrtIn),
            $bigint.toWei(jrtOut),
            $bigint.toWei(srtIn),
            $bigint.toWei(srtOut)
        );
    }
    export async function totalAssets(currentNAV: number) {
        await accounting.$receipt().updateAccounting(
            cdo,
            $bigint.toWei(currentNAV),
        );
    }
    export async function time(t: string) {
        //let s = $date.parseTimespan(t, { get: 's' });
        let dateBefore = await Block.getDate();
        await client.debug.mine(t);
        let dateAfter = await Block.getDate();
        let seconds = Math.floor((dateAfter.valueOf() - dateBefore.valueOf()) / 1000)
        l`Moved time from gray<${ $date.format(dateBefore, 'yyyy-MM-dd HH:mm') }> to cyan<${ $date.format(dateAfter, 'yyyy-MM-dd HH:mm') }> (s: gray<${ seconds} >)`
    }
}

namespace Balance {
    export async function eq (balance: bigint | Promise<bigint>, requireBalance: number, msg?: string) {
        $require.eq(await balance, $bigint.toWei(requireBalance), msg);
    }
    export async function eqAvg (balance: bigint | Promise<bigint>, requireBalance: number, msg?: string) {
        let b = await balance;
        let bEther = $bigint.toEther(b, 18);
        let diff = Math.abs(bEther - requireBalance);
        if (diff > 5) {
            throw new Error(`Balance not around to ${requireBalance}, actual: ${bEther}`);
        }

    }
}

namespace Block {
    export async function getDate () {
        let nr = await client.getBlockNumber();
        let block = await client.getBlock(nr);
        return $date.fromUnixTimestamp(block.timestamp);
    }
}



class Executor {
    srtNav: bigint
    jrtNav: bigint

    constructor(private deploy: TranchesDeploy) {

    }

    async run (data: IExecutionData) {
        let accounting = await deploy.ensureAccounting(cdo.address);

        await Updater.impersonate(cdo, accounting);
        await Updater.totalAssets(0);

        for (let step of data.steps) {
            if (step.aprs != null) {
                await feed.$receipt().updateRoundData(deployer, $apr.toWei(step.aprs[0]), $apr.toWei(step.aprs[1]));
            }
            if (step.balanceFlow != null) {
                await Updater.balanceFlow(...step.balanceFlow);
            }
            if (step.time != null) {
                await Updater.time(step.time);
            }
            if (step.totalAssets != null) {
                await Updater.totalAssets(step.totalAssets);
                await Balance.eq(await accounting.jrtNav() + await accounting.srtNav(), step.totalAssets);
                await Balance.eq(await accounting.nav(), step.totalAssets);
            }
            if (step.eqAvg) {
                console.log('JRT:', $bigint.toEther(await accounting.jrtNav()));
                console.log('SRT:', $bigint.toEther(await accounting.srtNav()));
                await Balance.eqAvg(accounting.jrtNav(), step.eqAvg[0]);
                await Balance.eqAvg(accounting.srtNav(), step.eqAvg[1]);
            }
            if (step.eqNav != null) {
                await Balance.eq(accounting.nav(), step.eqNav);
            }
        }

    }
}

interface IExecutionData {
    //aprs: [targetApr: number, baseApr: number]
    steps: IExecutionStep[]
}
interface IExecutionStep {
    aprs?: [targetApr: number, baseApr: number]
    balanceFlow?: [jrtIn: number, jrtOut: number, srtIn: number, srtOut: number]
    time?: string
    totalAssets?: number
    eqAvg?: [jrtNav: number, srtNav: number]
    eqNav?: number
}
