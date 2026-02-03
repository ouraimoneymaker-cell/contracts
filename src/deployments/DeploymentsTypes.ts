import { EthenaDeployments } from './EthenaDeployments'
import { NeutrlDeployments } from './NeutrlDeployments'

export namespace DeploymentsTypes {
    export type CDOs = {
        'ethena': EthenaDeployments,
        'neutrl': NeutrlDeployments
    };
}
