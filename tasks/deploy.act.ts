import { UAction } from 'atma-utest';
import { PlatformFactory } from './PlatformFactory';
import { BatchAgent } from 'dequanto/txs/agents/BatchAgent';
import { TxWriter } from 'dequanto/txs/TxWriter';
import { TimelockService } from 'dequanto/services/TimelockService/TimelockService';
import { TimelockHandler } from '@s/deployments/TimelockHandler';
import { StrataMasterChef } from '@0xc/hardhat/StrataMasterChef/StrataMasterChef';
import { l } from 'dequanto/utils/$logger';
import { $contract } from 'dequanto/utils/$contract';
import alot from 'alot';

UAction.create({
    async '!ensure all contracts are deployed or redeploy on bytecode change'() {
        const { tranches, deployer, client } = await PlatformFactory.init({
            deployments: 'redeploy',
            cdo: 'ethena'
        });

        const batch = TxWriter.DEFAULTS.agent = new BatchAgent();

        l`Execute deployment + configuration`;
        await tranches.ensureDeployment();

        TxWriter.DEFAULTS.agent = null;

        l`Submit as batch transaction`;
        await alot(batch.transactions).forEachAsync(async (tx, i) => {
            let builder = tx.outerWriter.builder;
            let data = builder.data;
            let contractInfo = await tranches.ds.store.getDeploymentInfo(data.to);
            let info = await builder.getInputDataInfo();

            l`Transaction: #${i + 1}`;
            l`To: cyan<${data.to}> ${contractInfo?.id} (${info.method})`;
            l`Data: ${data.data}`;

            if (info?.method === 'grantRole') {
                let role = info.params.role;
                let roleName = Roles.find(r => {
                    let hash = r.startsWith('0x') ? r : $contract.keccak256(r, 'hex');
                    return hash === role;
                });
                l` Role: cyan<${roleName}>`;
            }
            if (info?.method ==='upgradeAndCall') {
                let id = contractInfo.id.replace('ProxyAdmin', '');
                let proxyInfo = await tranches.ds.store.getDeploymentInfo(id);
                let history = proxyInfo.history?.[proxyInfo.history.length - 1];
                l`Previous Implementation: ${history?.address}`;
            }

        }).toArrayAsync({ threads: 1 })

        let timelock = new StrataMasterChef(tranches.accounts.timelock.admin.address, client);
        let service = new TimelockService(timelock, {
            execute: false,
            simulate: false,
        });

        let account = tranches.accounts.safe.admin;
        if (tranches.isTestnet()) {
            await client.debug.setBalance(account.address, BigInt(10e18));
            await client.debug.impersonateAccount(account.address);
        }

        await service.scheduleCallBatch('batch', account, batch.getTxData());

        if (tranches.isTestnet()) {
            await client.debug.mine('3days');
            await service.executeCallBatch('batch', account, batch.getTxData());
        }
    },
    async 'ensure Lenses'() {
        const { tranches } = await PlatformFactory.init({ cdo: 'ethena' });
        await tranches.ensureLenses();
    }
})


const Roles = [
    "PAUSER_ROLE",
    "UPDATER_CDO_APR_ROLE",
    "UPDATER_FEED_ROLE",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "UPDATER_STRAT_CONFIG_ROLE",
    "RESERVE_MANAGER_ROLE",
    "COOLDOWN_WORKER_ROLE",
    "PROPOSER_CONFIG_ROLE",
    "DEPOSITOR_CONFIG_ROLE",
];
