import alot from 'alot';
import { UTest } from 'atma-utest'
import { $hh } from '../tranches/utils/$hh';
import { CDOLens } from '@0xc/hardhat/CDOLens/CDOLens';
import { $bigint } from 'dequanto/utils/$bigint';
import { $apr } from '@s/utils/$apr';
import { $require } from 'dequanto/utils/$require';
import { DeploymentsBase } from '@s/deployments/DeploymentsBase';

await $hh.test.init();

let forked: DeploymentsBase;

UTest.create({

    async $before () {
        forked = await $hh.forked({ block: 24433000, cdo: 'ethena' });
    },

    async $after () {
        await $hh.reset(forked.client);
    },

    async 'backtest Ethena APRs' () {
        let lens = await forked.ds.ensureContract(CDOLens);
        let aprsWei = await lens.getAPRs('0x908B3921aaE4fC17191D382BB61020f2Ee6C0e20');
        let aprs = alot.fromObject(aprsWei).toDictionary(x => x.key, x => $bigint.toEther(x.value, 10, 100n));
        let apys = alot.fromObject(aprs).toDictionary(x => x.key, x => $apr.toApy(x.value));

        console.log(`APRs`, aprs);
        $require.eq(aprs.base, 3.48);
        $require.eq(aprs.target, 2.04);
        $require.eq(aprs.jrt, 7.24);
        $require.eq(aprs.srt, 2.15);
        console.log(`APYs`, apys);
    },
    async 'backtest Neutrl APRs' () {
        let lens = await forked.ds.ensureContract(CDOLens);
        let aprsWei = await lens.getAPRs('0x7b6c960cf185fb27ECb91c174FAe065978beDd10');
        let aprs = alot.fromObject(aprsWei).toDictionary(x => x.key, x => $bigint.toEther(x.value, 10, 100n));
        let apys = alot.fromObject(aprs).toDictionary(x => x.key, x => $apr.toApy(x.value));

        console.log(`APRs`, aprs);
        $require.eq(aprs.base, 10.13);
        $require.eq(aprs.target, 3.48);
        $require.eq(aprs.jrt, 11.89);
        $require.eq(aprs.srt, 7.38);
        console.log(`APYs`, apys);
    },
})
