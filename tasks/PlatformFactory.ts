import memd from 'memd';
import { TranchesDeployments } from '@s/deployments/TranchesDeployments';
import { IPlatformAccounts } from '@s/platforms/IPlatform';
import { ChainAccountService } from 'dequanto/ChainAccountService';
import { Web3Client } from 'dequanto/clients/Web3Client';
import { Web3ClientFactory } from 'dequanto/clients/Web3ClientFactory';
import { Config } from 'dequanto/config/Config';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { EoAccount } from 'dequanto/models/TAccount';
import { TEth } from 'dequanto/models/TEth';
import { InMemoryServiceTransport } from 'dequanto/safe/transport/InMemoryServiceTransport';
import { TxWriter } from 'dequanto/txs/TxWriter';


export namespace PlatformFactory {

    export class ConfigLoader {
        @memd.deco.memoize()
        static async fetch () {
            return await Config.fetch({
                configGlobal: './config/*.yml',
            });
        }
    }

    export async function init(params?: {
        client?: Web3Client
        platform?: TEth.Platform
        deployments?: 'throw' | 'redeploy'
    }) {
        const hh = new HardhatProvider();
        const config = await ConfigLoader.fetch();

        const platform = params.platform ?? params?.client?.platform ?? config.$get('chain') ?? 'hardhat';
        const client = params?.client ?? await Web3ClientFactory.getAsync(platform);

        const accounts = await getAccounts(client);

        if (accounts.safe?.admin.type === 'safe') {
            TxWriter.defaultOptions({
                safeTransport: new InMemoryServiceTransport(client, accounts.deployer as EoAccount)
            });
        }

        const depl = new TranchesDeployments({
            client,
            deployer: accounts.deployer as EoAccount,
            owner: accounts.timelock.admin,
            deployments: params?.deployments,
            accounts
        });
        return {
            tranches: depl,
            client,
            owner: accounts.timelock.admin,
            deployer: accounts.deployer,
        }
    }

    async function getAccounts(client: Web3Client) {
        const { platform, network } = client;
        const hh = new HardhatProvider();

        let deployer = await ChainAccountService.get(`${network}/deployer`);
        let timelockAdmin = await ChainAccountService.get(`timelock/${network}/strata`);
        let timelockConfig = await ChainAccountService.get(`timelock/${network}/config`);
        let safeAdmin = await ChainAccountService.get(`safe/${network}/strata`);
        let safeOperator = await ChainAccountService.get(`safe/${network}/owner`);

        if (network === 'hardhat') {
            deployer = hh.deployer(0);
            timelockAdmin = deployer;
            timelockConfig = deployer;
            safeAdmin = deployer;
            safeOperator = deployer;
        }

        if (platform !== 'eth') {
            safeAdmin ??= deployer;
            safeOperator ??= deployer;
            timelockAdmin ??= safeAdmin;
            timelockConfig ??= safeOperator;
        }

        if (platform === 'hardhat' && client.forked?.platform) {
            // Impersonate safe and timelock accounts in forked networks
            deployer = {
                name: 'impersonated',
                type: 'impersonated',
                address: deployer.address,
            };
            safeAdmin = {
                name: 'impersonated',
                type: 'impersonated',
                address: safeAdmin.address,
            };
            safeOperator = {
                name: 'impersonated',
                type: 'impersonated',
                address: safeOperator.address,
            };
            timelockAdmin = {
                name: 'impersonated',
                type: 'impersonated',
                address: timelockAdmin.address,
            };
            timelockConfig = {
                name: 'impersonated',
                type: 'impersonated',
                address: timelockConfig.address,
            };
            await client.debug.setBalance(timelockAdmin.address,    BigInt(1e18));
            await client.debug.setBalance(timelockConfig.address,   BigInt(1e18));
            await client.debug.setBalance(safeAdmin.address,        BigInt(1e18));
            await client.debug.setBalance(safeOperator.address,     BigInt(1e18));
        }

        return {
            deployer,
            safe: {
                admin: safeAdmin,
                operator: safeOperator,
            },
            timelock: {
                admin: timelockAdmin,
                config: timelockConfig,
            },
        } as IPlatformAccounts
    }
}
