import { TranchesDeployments } from '@s/deployments/TranchesDeployments';
import { UAction } from 'atma-utest';
import { Web3ClientFactory } from 'dequanto/clients/Web3ClientFactory';
import { Config } from 'dequanto/config/Config';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';

UAction.create({
    async 'deploy and configure' () {
        const hh = new HardhatProvider();
        const config = await Config.fetch({});
        const platform = config.$get('chain') ?? 'hardhat';
        const client = await Web3ClientFactory.getAsync(platform);
        const deployer = config.$get('accounts.deployer') ?? hh.deployer(0);

        const depl = new TranchesDeployments({
            client,
            deployer
        });

        await depl.ensureEthenaCDO();
    }
})
