import alot from 'alot';
import { UTest } from 'atma-utest';
import { StrategyBasicSuite } from './StrategyBasicSuite';
import { $hh } from '../utils/$hh';
import { TCDOKey, Tranches } from '@s/platforms/Tranches';
import { $require } from 'dequanto/utils/$require';
import { PlatformFactory } from '@tasks/PlatformFactory';


const config = await PlatformFactory.ConfigLoader.fetch();
const STRATS = Object
    .keys(Tranches)
    .filter(key => Tranches[key].TestHelper != null && (!config.ref || key === config.ref));

$require.notEmpty(STRATS, `No strategies to test`);

// Run basic tests for each strategy in the forked environment
UTest.create({
    $config: {
        timeout: 60_000
    },

    ...alot(STRATS).toDictionary(key => key, key => {

        const TestHelper = $require.notNull(Tranches[key].TestHelper, `${key} has no TestHelper`);
        const test = $hh.create(key as TCDOKey, {
            forked: TestHelper.forked ?? 24808600,
            cdoInfo: {
                pfx: `HHBasicSuite${key}`
            },
            fresh: true
        });

        const helper = new TestHelper(test)
        const suite = new StrategyBasicSuite(test, helper);
        return async function factory () {
            return suite.createTests()
        }
    })

})
