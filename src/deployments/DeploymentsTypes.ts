import { EthenaDeployments } from './EthenaDeployments';
import { MHyperDeployments } from './MHyperDeployments';
import { MM1UsdDeployments } from './MM1UsdDeployments';
import { MROXDeployments } from './MROXDeployments';
import { NeutrlDeployments } from './NeutrlDeployments';

export namespace DeploymentsTypes {
    export type CDOs = {
        ethena: EthenaDeployments;
        neutrl: NeutrlDeployments;
        mhyper: MHyperDeployments;
        mm1usd: MM1UsdDeployments;
        mrox: MROXDeployments;
    };

    export const Tranches = {
        ethena: EthenaDeployments,
        neutrl: NeutrlDeployments,
        mhyper: MHyperDeployments,
        mm1usd: MM1UsdDeployments,
        mrox: MROXDeployments,
    };
}
