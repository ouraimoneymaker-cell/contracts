import memd from 'memd';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeployments } from '@s/deployments/TranchesDeployments';
import { $require } from 'dequanto/utils/$require';
import { Web3Client } from 'dequanto/clients/Web3Client';
import { TEth } from 'dequanto/models/TEth';
import { $sig } from 'dequanto/utils/$sig';
import { HardhatWeb3Client } from 'dequanto/hardhat/HardhatWeb3Client';
import { TwoStepConfigManager } from '@0xc/hardhat/TwoStepConfigManager/TwoStepConfigManager';
import { PlatformFactory } from '../../../tasks/PlatformFactory';
import { $cli } from 'dequanto/utils/$cli';


export namespace $hh {

    export function isCoverage () {
        const coverage = Boolean($cli.getParamValue('coverage'));
        return coverage as boolean;
    }

    export function getClient () {
        const hh = new HardhatProvider();
        return hh.client('hardhat');
    }

    export async function forked (opts?: { block?: number }) {
        const config = await PlatformFactory.ConfigLoader.fetch();
        const hh = new HardhatProvider();
        const client = await hh.forked({ platform: 'eth', block: opts?.block ?? void 0 });
        client.configureFork('eth');

        const { tranches } = await PlatformFactory.init({ client });
        return tranches;
    }

    export async function reset (client: Web3Client) {
        await client.debug.reset({});
        memd.fn.clearMemoized($hh.test.factory.ensureEthenaCDO);
        memd.fn.clearMemoized($hh.test.factory.ensureEthena);
        memd.fn.clearMemoized($hh.test.factory.ensureACM);
        memd.fn.clearMemoized($hh.test.factory.ensureCooldowns);
        memd.fn.clearMemoized($hh.test.deploy);
        memd.fn.clearMemoized($hh.test.init);
        (client as HardhatWeb3Client).configureFork(null);
    }

    export class Test {
        snapshots: Record<string, any> = {};
        client: Web3Client;
        factory: TranchesDeployments;
        tranches: Awaited<ReturnType<TranchesDeployments['ensureEthenaCDO']>>;
        ethena: Awaited<ReturnType<TranchesDeployments['ensureEthena']>>;
        deployer: TEth.IAccount
        depositor: Awaited<ReturnType<TranchesDeployments['ensureDepositor']>>
        configManager: TwoStepConfigManager;

        @memd.deco.memoize()
        async init () {
            const hh = new HardhatProvider();
            const client = await getClient();
            const deployer = await hh.deployer(0);
            const depl = new TranchesDeployments({
                client,
                deployer,
                accounts: {
                    deployer: deployer,
                    safe: { admin: deployer, operator: deployer },
                    timelock: { admin: deployer, config: deployer },
                }
            });

            this.client = client;
            this.factory = depl;
            this.deployer = deployer;
        }

        async createAccount (name: string, client?: Web3Client) {
            let account = $sig.$account.generate({ name });
            await (client ?? this.client).debug.setBalance(account.address, 10n**20n);
            return account;
        }

        @memd.deco.memoize()
        async deploy () {
            await this.init();

            this.ethena = await this.factory.ensureEthena();
            this.tranches = await this.factory.ensureEthenaCDO();
            this.depositor = await this.factory.ensureDepositor();
            let { configManager } = await this.factory.ensureConfigManager();
            this.configManager = configManager;

            await this.snapshot();
            return {
                ...this.tranches,
                ...this.ethena,
            };
        }

        async snapshot (snapshotName: string = 'root') {
            if (this.client == null) {
                return;
            }
            this.snapshots[snapshotName] = await this.client.debug.snapshot();
        }

        async reset (snapshotName: string = 'root') {
            if (this.client == null) {
                return;
            }
            let snap = $require.notNull(this.snapshots[snapshotName], snapshotName);
            let result = await this.client.debug.revert(snap);
            if (result == false) {
                throw new Error(`Failed to revert to snapshot ${snapshotName}: ${snap}`);
            }

            let newSnapshotId = await this.client.debug.snapshot();
            this.snapshots[snapshotName] = newSnapshotId;
        }

        async mine (t: string | '30mins' | '5hours' | '1year') {
            await this.client.debug.mine(t);
        }
    }

    export const test = new Test();
}

