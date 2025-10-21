import { UAction } from 'atma-utest';
import { PlatformFactory } from './PlatformFactory';

UAction.create({
    async 'config Coverage' () {
       const { tranches } = await PlatformFactory.init();

        await tranches.ensureEthenaCDO();
        await tranches.ensureDepositor();
    }
})
