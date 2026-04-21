import memd from 'memd';
import { Directory } from 'atma-io';
import { EthenaDeployments } from '@s/deployments/EthenaDeployments';
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
import { ICDO, TCDOKey, Tranches } from '@s/platforms/Tranches';
import { V0NeutrlDeployments } from '@s/deployments/V0NeutrlDeployments';
import { NeutrlDeployments } from '@s/deployments/NeutrlDeployments';
import { DeploymentsTypes } from '@s/deployments/DeploymentsTypes';
import alot from 'alot';
import { $require } from 'dequanto/utils/$require';




export namespace PlatformFactory {

    export class ConfigLoader {
        @memd.deco.memoize()
        static async fetch () {
            return await Config.fetch({
                configGlobal: './config/*.yml',
            });
        }
    }

    export async function init<TKey extends TCDOKey>(params: {
        client?: Web3Client
        platform?: TEth.Platform
        deployments?: 'throw' | 'redeploy',
        cdo: TKey
        accounts?: TKey | 'operator' | 'deployer'
        cdoInfo?: Partial<ICDO>
        initialDeposit?: boolean
        isTest?: boolean
    }) {
        const hh = new HardhatProvider();
        const config = await ConfigLoader.fetch();

        const platform = params.platform ?? params?.client?.platform ?? config.$get('chain') ?? 'hardhat';
        const client = params?.client ?? await Web3ClientFactory.getAsync(platform);

        const accounts = await getAccounts(client, params.accounts ?? params.cdo);

        if (accounts.safe?.admin.type === 'safe') {
            TxWriter.defaultOptions({
                safeTransport: new InMemoryServiceTransport(client, accounts.deployer as EoAccount)
            });
        }

        const CtorDeployments =  DeploymentsTypes.Tranches[params.cdo];

        const depl = new CtorDeployments({
            client,
            deployer: accounts.deployer as EoAccount,
            owner: accounts.timelock.admin,
            deployments: params?.deployments,
            accounts,
            initialDeposit: params?.initialDeposit,
            cdoInfo: params?.cdoInfo,
            isTest: params?.isTest,
        });
        return {
            tranches: depl as any as DeploymentsTypes.CDOs[TKey],
            client,
            owner:  params.accounts === 'operator' ? accounts.safe.operator : accounts.timelock.admin,
            deployer: accounts.deployer,
        }
    }

    async function getAccounts(client: Web3Client, group: TCDOKey | 'operator' | 'deployer') {
        const { platform, network } = client;
        const hh = new HardhatProvider();

        const accounts = Tranches[group]?.accounts?.[network] ?? {
            deployer: `${network}/deployer`,
            timelockAdmin: `timelock/${network}/strata`,
            timelockConfig: `timelock/${network}/config`,
            safeAdmin: `safe/${network}/strata`,
            safeOperator: `safe/${network}/owner`,
        };

        let deployer = await ChainAccountService.get(accounts.deployer);
        let timelockAdmin = await ChainAccountService.get(accounts.timelockAdmin);
        let timelockConfig = await ChainAccountService.get(accounts.timelockConfig);
        let safeAdmin = await ChainAccountService.get(accounts.safeAdmin);
        let safeOperator = await ChainAccountService.get(accounts.safeOperator);

        if (network === 'hardhat' || (platform === 'hardhat' && group === 'deployer')) {
            deployer = hh.deployer(0);
            timelockAdmin = deployer;
            timelockConfig = deployer;
            safeAdmin = deployer;
            safeOperator = deployer;
        } else if (platform === 'hardhat' && client.forked?.platform) {
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
            await client.debug.setBalance(deployer.address,         BigInt(1e18));
            await client.debug.setBalance(timelockAdmin.address,    BigInt(1e18));
            await client.debug.setBalance(timelockConfig.address,   BigInt(1e18));
            await client.debug.setBalance(safeAdmin.address,        BigInt(1e18));
            await client.debug.setBalance(safeOperator.address,     BigInt(1e18));

        } else if (platform !== 'eth' || group === 'operator') {

            safeAdmin = safeOperator;
            safeOperator = safeOperator;
            timelockAdmin = safeOperator;
            timelockConfig = safeOperator;
        }

        if (group === 'operator') {
            safeAdmin = safeOperator;
            safeOperator = safeOperator;
            timelockAdmin = safeOperator;
            timelockConfig = safeOperator;
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
