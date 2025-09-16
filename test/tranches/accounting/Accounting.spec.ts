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
    async $after () {
        await client.debug.revert(snapshotId);
    },

    async 'deposit and accrue' () {

        let accounting = await deploy.ensureAccounting(cdo.address);


        await feed.$receipt().updateRoundData(deployer, $apr.toWei(10), $apr.toWei(20));


        await Updater.impersonate(cdo, accounting);

        await Updater.totalAssets(0);
        await Updater.balanceFlow(1000, 0, 1000, 0);

        await Balance.eq(accounting.nav(), 2000);

        await Updater.time('1year');
        await Updater.totalAssets(2100);
        await Balance.eq(await accounting.jrtNav() + await accounting.srtNav(), 2100);

        console.log(`jrtNav`, await accounting.jrtNav())
        console.log(`srtNav`, await accounting.srtNav())
    },
})

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
        await client.debug.mine(t);
    }
}

namespace Balance {
    export async function eq (balance: bigint | Promise<bigint>, requireBalance: number, msg?: string) {
        $require.eq(await balance, $bigint.toWei(requireBalance), msg);
    }
}

