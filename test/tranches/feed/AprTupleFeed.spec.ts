import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeployments } from '../../../src/deployments/TranchesDeployments';
import { UAction } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { AprTupleFeed } from '@0xc/hardhat/AprTupleFeed/AprTupleFeed';
import { $apr } from '../../../src/utils/$apr';


let hh = new HardhatProvider();
let client = await hh.client('localhost');
let deployer = await hh.deployer(0);


let deploy = new TranchesDeployments({
    client,
    deployer
});


let snapshotId;



UAction.create({
    async $before () {
        snapshotId = await client.debug.snapshot();
    },
    async $after () {
        await client.debug.revert(snapshotId);
    },

    async 'transfer via cooldown' () {
        let acm = await deploy.ensureACM();
        await deploy.addRoles();

        let { contract: feed } = await deploy.ds.ensureWithProxy(AprTupleFeed, {
            initialize: [
                deployer.address,
                acm.address,
                'Test feed'
            ]
        });

        await feed.$receipt().updateRoundData(deployer, $apr.toWei(1), $apr.toWei(0.1));

        let data = await feed.latestRoundData();
        $require.eq(data.aprTarget, 10**12);
        $require.eq(data.aprBase, 10**11);

        let { contract: listener } = await hh.deployCode(`
            contract Listener {
                int64 public aprTarget;
                int64 public aprBase;
                function onAprChanged(int64 aprTarget_, int64 aprBase_) external {
                    aprTarget = aprTarget_;
                    aprBase   = aprBase_;
                }
            }
        `, { client });

        await feed.$receipt().addListener(deployer, listener.address);
        await feed.$receipt().updateRoundData(deployer, $apr.toWei(.4), $apr.toWei(0.5));

        $require.eq(await listener.aprTarget(), 4 * 10**11);
        $require.eq(await listener.aprBase(), 5 * 10**11);

        await feed.$receipt().removeListener(deployer, listener.address);

        await feed.$receipt().updateRoundData(deployer, $apr.toWei(.2), $apr.toWei(0.3));
        $require.eq(await listener.aprTarget(), 4 * 10**11);
        $require.eq(await listener.aprBase(), 5 * 10**11);

        data = await feed.latestRoundData();
        $require.eq(data.aprTarget, 2 * 10**11);
        $require.eq(data.aprBase, 3 * 10**11);

    },
})

