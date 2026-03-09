import { EthenaDeployments } from './EthenaDeployments'
import { MHyperDeployments } from './MHyperDeployments';
import { NeutrlDeployments } from './NeutrlDeployments'

export namespace DeploymentsTypes {
    export type CDOs = {
        'ethena': EthenaDeployments,
        'neutrl': NeutrlDeployments,
        'mhyper': MHyperDeployments,
    };

    export const Tranches = {
        'ethena': EthenaDeployments,
        'neutrl': NeutrlDeployments,
        'mhyper': MHyperDeployments,
    };
}
