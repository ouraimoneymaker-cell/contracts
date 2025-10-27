import { UAction } from 'atma-utest';
import { PlatformFactory } from './PlatformFactory';

UAction.create({
    async 'ensure all contracts are deployed or redeploy on bytecode change'() {
        const { tranches } = await PlatformFactory.init();

        await tranches.ensureEthenaCDO();
        await tranches.ensureDepositor();
    }
})
