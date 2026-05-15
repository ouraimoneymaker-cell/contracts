import { EthenaDeployments } from './EthenaDeployments';
import { FigureDeployments } from './FigureDeployments';
import { MHyperDeployments } from './MHyperDeployments';
import { MM1UsdDeployments } from './MM1UsdDeployments';
import { MROXDeployments } from './MROXDeployments';
import { NeutrlDeployments } from './NeutrlDeployments';
import { SaturnDeployments } from './SaturnDeployments';

export namespace DeploymentsTypes {
    export type CDOs = {
        ethena: EthenaDeployments;
        figure: FigureDeployments;
        neutrl: NeutrlDeployments;
        mhyper: MHyperDeployments;
        mm1usd: MM1UsdDeployments;
        mrox: MROXDeployments;
        saturn: SaturnDeployments;
    };

    export const Tranches = {
        ethena: EthenaDeployments,
        figure: FigureDeployments,
        neutrl: NeutrlDeployments,
        mhyper: MHyperDeployments,
        mm1usd: MM1UsdDeployments,
        mrox: MROXDeployments,
        saturn: SaturnDeployments,
    };
}
