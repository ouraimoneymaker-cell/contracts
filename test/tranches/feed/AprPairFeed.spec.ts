import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeployments } from '../../../src/deployments/TranchesDeployments';
import { UAction } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';


import { $hh } from '../utils/$hh';
import { AprPairFeed } from '@0xc/hardhat/AprPairFeed/AprPairFeed';
import { $date } from 'dequanto/utils/$date';
import { $apr } from '@s/utils/$apr';
import { $promise } from 'dequanto/utils/$promise';


await $hh.test.deploy();
await $hh.test.snapshot();


UAction.create({

    async $after () {
        await $hh.test.reset();
    },

    async 'update feed' () {
        let { factory, deployer, client } = await $hh.test;

        let acm = await factory.ensureACM();
        await factory.addRoles();

        let hh = new HardhatProvider();
        let { contract: provider } = await hh.deployCode(`
            contract Provider {
                int64 public aprTarget = 500;
                int64 public aprBase = 800;
                function getAprPair () external view returns (int64, int64, uint64) {
                    return (aprTarget, aprBase, uint64(block.timestamp));
                }
            }
        `, { client });

        let { contract: feed } = await factory.ds.ensureWithProxy(AprPairFeed, {
            id: 'TestFeed',
            initialize: [
                deployer.address,
                acm.address,
                provider.address,
                BigInt($date.parseTimespan('1hour', { get: 's' })),
                'Test feed'
            ]
        });

        await feed.$receipt().updateRoundData(deployer, $apr.toWei(1), $apr.toWei(0.1));

        let data = await feed.latestRoundData();
        $require.eq(data.aprTarget, 10**12);
        $require.eq(data.aprBase, 10**11);

        await $hh.test.mine('40mins');
        data = await feed.latestRoundData();
        $require.eq(data.aprTarget, 10**12);
        $require.eq(data.aprBase, 10**11);

        await $hh.test.mine('40mins');
        // stale
        // fetch from test provider
        data = await feed.latestRoundData();
        $require.eq(data.aprTarget, 500);
        $require.eq(data.aprBase, 800);


        let unauth = hh.deployer(1);
        let result = await $promise.caught(() => feed.$receipt().updateRoundData(unauth, $apr.toWei(.5), $apr.toWei(.8)));

        has_(result.error.message, 'AccessControlUnauthorizedAccount');
    },
})

