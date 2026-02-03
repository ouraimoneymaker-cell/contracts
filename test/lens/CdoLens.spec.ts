import { UTest } from 'atma-utest'
import { $hh } from '../tranches/utils/$hh';
import { EthenaDeployments } from '@s/deployments/EthenaDeployments';
import { CDOLens } from '@0xc/hardhat/CDOLens/CDOLens';
import { l } from 'dequanto/utils/$logger';
import { $bigint } from 'dequanto/utils/$bigint';
import alot from 'alot';
import { $apr } from '@s/utils/$apr';
import { $require } from 'dequanto/utils/$require';

await $hh.test.init();

let forked: EthenaDeployments;

UTest.create({

    async $before () {
        forked = await $hh.forked({ block: 23707880 });
    },

    async $after () {
        await $hh.reset(forked.client)
    },

    async 'deposit via Swap' () {
        let { deployer, client } = forked;
        let lens = await forked.ds.ensureContract(CDOLens);

        let aprsWei = await lens.getAPRs('0x908B3921aaE4fC17191D382BB61020f2Ee6C0e20');
        let aprs = alot.fromObject(aprsWei).toDictionary(x => x.key, x => $bigint.toEther(x.value, 10, 100n));
        let apys = alot.fromObject(aprs).toDictionary(x => x.key, x => $apr.toApy(x.value));

        console.log(`APRs`, aprs);
        $require.eq(aprs.base, 5.08);
        $require.eq(aprs.target, 3.53);
        $require.eq(aprs.jrt, 18.90);
        $require.eq(aprs.srt, 3.53);
        console.log(`APYs`, apys);
    },
})
