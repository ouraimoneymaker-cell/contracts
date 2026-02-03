import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { EthenaDeployments } from '../../../src/deployments/EthenaDeployments';
import { UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';


import { $hh } from '../utils/$hh';
import { AprPairFeed } from '@0xc/hardhat/AprPairFeed/AprPairFeed';
import { $date } from 'dequanto/utils/$date';
import { $apr } from '@s/utils/$apr';
import { $promise } from 'dequanto/utils/$promise';
import { $block } from 'dequanto/utils/$block';


await $hh.test.deploy();


UTest.create({

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

        //await feed.$receipt().updateRoundData(deployer, $apr.toWei(1), $apr.toWei(0.1), $date.toUnixTimestamp());
        let { error } = await updateFeed(feed, deployer, 1, 0.1);
        $require.Null(error, 'Not updated');

        let data = await feed.latestRoundData();
        $require.eq(data.aprTarget, 10**12);
        $require.eq(data.aprBase, 10**11);

        let dataById = await feed.getRoundData(data.answeredInRound);
        $require.eq(dataById.aprTarget, data.aprTarget);
        $require.eq(dataById.aprBase, data.aprBase);

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

        // fetch from test provider
        await feed.$receipt().updateRoundData(deployer);
        await client.debug.mine('5s');



        let unauth = hh.deployer(1);
        let result = await updateFeed(feed, unauth, .5, .8);

        $require.match(/AccessControlUnauthorizedAccount/, result.error.message);

        result = await updateFeed(feed, deployer, .5, .8);
        $require.Null(result.error, 'Not updated');

        result = await updateFeed(feed, deployer, .5, .8, -30);
        $require.match(/OutOfOrderUpdate/, result.error?.message);

        result = await updateFeed(feed, deployer, .5, .8, 70);
        $require.match(/OutOfOrderUpdate/, result.error?.message);

        result = await updateFeed(feed, deployer, .5, .8, -2 * 60 * 60);
        $require.match(/StaleUpdate/, result.error?.message);

        result = await updateFeed(feed, deployer, .1, .1);
        $require.Null(result.error, `Errored`);


        // Reset the provider
        let tx = await feed.$receipt().setProvider(deployer, provider.address);
        let [ event ] = await feed.extractLogsProviderSet(tx.receipt);
        $require.notNull(event, `Event not found`);
        $require.eq(event.params.newProvider.toLowerCase(), provider.address.toLowerCase());
    },
})

async function updateFeed (feed: AprPairFeed, account, aprTarget: number, aprBase: number, deltaT?: number) {
    let timestamp = (await feed.client.getBlock('latest')).timestamp;
    timestamp += deltaT ?? 0;
    return await $promise.caught(() => {
        return feed.$receipt().updateRoundData(account, $apr.toWei(aprTarget), $apr.toWei(aprBase), timestamp);
    });
}
