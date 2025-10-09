import { TranchesDeployments } from '@s/deployments/TranchesDeployments';
import { UAction } from 'atma-utest';
import { Web3ClientFactory } from 'dequanto/clients/Web3ClientFactory';
import { Config } from 'dequanto/config/Config';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { EoAccount } from 'dequanto/models/TAccount';
import { InMemoryServiceTransport } from 'dequanto/safe/transport/InMemoryServiceTransport';
import { TxWriter } from 'dequanto/txs/TxWriter';
import { $require } from 'dequanto/utils/$require';

UAction.create({
    async 'deploy and configure' () {
        const hh = new HardhatProvider();
        const config = await Config.fetch({
            configGlobal: './config/dequanto.yml',
        });
        const platform = config.$get('chain') ?? 'hardhat';
        const client = await Web3ClientFactory.getAsync(platform);

        const deployer = client.network === 'hardhat'
            ? hh.deployer(0)
            : config.accounts?.find(x => x.name === `${client.network}/deployer`);

        const owner = config.accounts?.find(x => x.name === `safe/${client.network}/owner`) ?? deployer;
        if (client.network === 'eth') {
            $require.match(/safe/, owner.name, 'Owner must be a Safe account');
        }

         if (/safe/.test(owner.name)) {
            TxWriter.defaultOptions({
                safeTransport: new InMemoryServiceTransport(client, deployer as EoAccount)
            });
        }

        const depl = new TranchesDeployments({
            client,
            deployer,
            owner,
        });

        //await depl.ensureEthenaCDO();
        await depl.ensureDepositor();
    }
})
