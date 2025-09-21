import { Web3ClientFactory } from 'dequanto/clients/Web3ClientFactory';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeployments } from '../../src/deployments/TranchesDeployments';
import { UAction } from 'atma-utest'
import { $erc4626 } from './utils/$erc4626';
import { $usde } from './utils/$usde';
import { $erc20 } from './utils/$erc20';
import { $bigint } from 'dequanto/utils/$bigint';


UAction.create({
    async 'deposit/withdraw' () {
        let hh = new HardhatProvider();
        let client = await hh.client('localhost');
        let deployer = await hh.deployer();

        let deploy = new TranchesDeployments({
            client,
            deployer
        });

        let { USDe, sUSDe } = await deploy.ensureEthena();

        await $usde.mint(USDe, deployer, 1000.0);

        let { jrtVault, srtVault, cdo, strategy, accounting } = await deploy.ensureEthenaCDO();


        await $erc4626.deposit(jrtVault, deployer, 10.0);

        await $erc4626.eqShares(jrtVault, deployer, 10.0);
        await $erc4626.eqAssets(jrtVault, deployer, 10.0);
    }
})
