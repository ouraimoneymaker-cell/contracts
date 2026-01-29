import memd from 'memd';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { NeutrlDeployment } from '@s/deployments/NeutrlDeployment';
import { $require } from 'dequanto/utils/$require';
import { Web3Client } from 'dequanto/clients/Web3Client';
import { TEth } from 'dequanto/models/TEth';
import { $sig } from 'dequanto/utils/$sig';
import { TwoStepConfigManager } from '@0xc/hardhat/TwoStepConfigManager/TwoStepConfigManager';



export namespace $neutrl {
    export function getClient() {
        const hh = new HardhatProvider();
        return hh.client('hardhat');
    }

    export class Test {
        snapshots: Record<string, any> = {};
        client: Web3Client;
        factory: NeutrlDeployment;
        tranches: Awaited<ReturnType<NeutrlDeployment['ensureNeutrlCDO']>>;
        neutrl: Awaited<ReturnType<NeutrlDeployment['ensureNeutrl']>>;
        deployer: TEth.IAccount;
        configManager: TwoStepConfigManager;

        @memd.deco.memoize()
        async init() {
            const hh = new HardhatProvider();
            const client = getClient();
            const deployer = hh.deployer(0);
            const depl = new NeutrlDeployment({
                client, deployer, accounts: {
                    deployer: deployer,
                    safe: { admin: deployer, operator: deployer },
                    timelock: { admin: deployer, config: deployer }
                }
            });

            this.client = client;
            this.factory = depl;
            this.deployer = deployer;
        }

        async createAccount(name: string, client?: Web3Client) {
            let account = $sig.$account.generate({ name });
            await (client ?? this.client).debug.setBalance(account.address, 10n ** 20n);
            return account;
        }

        @memd.deco.memoize()
        async deploy() {
            await this.init();

            this.neutrl = await this.factory.ensureNeutrl();
            this.tranches = await this.factory.ensureNeutrlCDO();

            await this.snapshot();
            return {
                ...this.tranches,
                ...this.neutrl,
            };
        }

        async snapshot(snapshotName: string = 'root') {
            if (this.client == null) {
                return;
            }
            this.snapshots[snapshotName] = await this.client.debug.snapshot();
        }

        async reset(snapshotName: string = 'root') {
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

        async mine(t: string | '30mins' | '5hours' | '1year') {
            await this.client.debug.mine(t);
        }
    }

    export const test = new Test();

}