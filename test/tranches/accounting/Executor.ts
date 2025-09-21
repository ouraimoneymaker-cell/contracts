import { $hh } from '../utils/$hh';
import { $bigint } from 'dequanto/utils/$bigint';
import { StrataCDO } from '@0xc/hardhat/StrataCDO/StrataCDO';
import { Accounting } from '@0xc/hardhat/Accounting/Accounting';
import { $require } from 'dequanto/utils/$require';
import { $date } from 'dequanto/utils/$date';
import { l } from 'dequanto/utils/$logger';
import { Web3Client } from 'dequanto/clients/Web3Client';
import { $apr } from '@s/utils/$apr';
import { $promise } from 'dequanto/utils/$promise';

let client: Web3Client;

export class Executor {
    srtNav: bigint
    jrtNav: bigint

    constructor(private test: $hh.Test) {
        client = test.client;
    }

    async run (data: IExecutionData) {

        await $hh.test.reset();

        let { deployer } = this.test.factory;
        let { cdo, feed } = this.test.tranches;
        let accounting = await this.test.factory.ensureAccounting(cdo.address);

        await Updater.impersonate(cdo, accounting);
        await Updater.totalAssets(0);

        for (let step of data.steps) {
            if (step.aprs != null) {
                let aprTarget = $apr.toWei(step.aprs[0]);
                let aprBase = $apr.toWei(step.aprs[1]);
                await feed.$receipt().updateRoundData(deployer, aprTarget, aprBase);
                await accounting.$receipt().onAprChanged(deployer);
            }
            if (step.balanceFlow != null) {
                l`gray<BalanceFlow>: cyan<${step.balanceFlow.join(' , ')}>`;
                await Updater.balanceFlow(...step.balanceFlow);
            }
            if (step.time != null) {
                await Updater.time(step.time);
            }
            if (step.totalAssets != null) {
                l`gray<UpdateAssets>: cyan<${step.totalAssets}>`;
                await Updater.totalAssets(step.totalAssets);
                await Balance.eq(await accounting.jrtNav() + await accounting.srtNav(), step.totalAssets);
                await Balance.eq(await accounting.nav(), step.totalAssets);
            }
            if (step.eqAvg) {
                console.log('JRT:', $bigint.toEther(await accounting.jrtNav()));
                console.log('SRT:', $bigint.toEther(await accounting.srtNav()));
                step.eqAvg[0] != null && await Balance.eqAvg(accounting.jrtNav(), step.eqAvg[0]);
                step.eqAvg[1] != null && await Balance.eqAvg(accounting.srtNav(), step.eqAvg[1]);
            }
            if (step.eqNav != null) {
                await Balance.eq(accounting.nav(), step.eqNav);
            }
        }

    }
}

interface IExecutionData {
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


namespace Updater {
    let cdo: StrataCDO;
    let accounting: Accounting;
    export async function impersonate (cdo_: StrataCDO, accounting_: Accounting) {
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
