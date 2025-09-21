import memd from 'memd';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeployments } from '@s/deployments/TranchesDeployments';
import { $require } from 'dequanto/utils/$require';
import { Web3Client } from 'dequanto/clients/Web3Client';
import { TEth } from 'dequanto/models/TEth';
import { $sig } from 'dequanto/utils/$sig';



export namespace $hh {
    export function getClient () {
        const hh = new HardhatProvider();
        return hh.client('hardhat');
    }

    export async function forked () {
        const hh = new HardhatProvider();
        const client = await hh.forked({ platform: 'eth' });
        const deployer = await hh.deployer(0);
        const depl = new TranchesDeployments({
            client,
            deployer
        });
        return depl;
    }

    export class Test {
        snapshots: Record<string, any> = {};
        client: Web3Client;
        factory: TranchesDeployments;
        tranches: Awaited<ReturnType<TranchesDeployments['ensureEthenaCDO']>>;
        ethena: Awaited<ReturnType<TranchesDeployments['ensureEthena']>>;
        deployer: TEth.IAccount

        @memd.deco.memoize()
        async init () {
            const hh = new HardhatProvider();
            const client = await getClient();
            const deployer = await hh.deployer(0);
            const depl = new TranchesDeployments({
                client,
                deployer
            });

            this.client = client;
            this.factory = depl;
            this.deployer = deployer;
        }

        async createAccount (name: string) {
            let account = $sig.$account.generate({ name });
            await this.client.debug.setBalance(account.address, 10n**20n);
            return account;
        }

        @memd.deco.memoize()
        async deploy () {
            await this.init();

            this.ethena = await this.factory.ensureEthena();
            this.tranches = await this.factory.ensureEthenaCDO();

            return {
                ...this.tranches,
                ...this.ethena,
            };
        }

        async snapshot (snapshotName: string = 'root') {
            this.snapshots[snapshotName] = await this.client.debug.snapshot();
        }

        async reset (snapshotName: string = 'root') {
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

