import alot from 'alot';
import { UTest } from 'atma-utest';
import { StrategyBasicSuite } from './StrategyBasicSuite';
import { $hh } from '../utils/$hh';
import { TCDOKey, Tranches } from '@s/platforms/Tranches';
import { $require } from 'dequanto/utils/$require';

const STRATS = ['neutrl', 'mhyper']; // Object.keys(Tranches);

// Run basic tests for each strategy in the forked environment

UTest.create({
    $config: {
        timeout: 60_000
    },

    ...alot(STRATS).toDictionary(key => key, key => {
        const test = $hh.create(key as TCDOKey, {
            forked: 24672000,
            cdoInfo: {
                pfx: `HHBasicSuite${key}`
            }
        });

        $require.notNull(new Tranches[key].TestHelper, `${key} has no TestHelper`);
        const suite = new StrategyBasicSuite(test, new Tranches[key].TestHelper(test));
        return async function factory () {
            return suite.createTests()
        }
    })

})
