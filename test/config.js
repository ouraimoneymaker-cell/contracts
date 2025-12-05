const hh = require('hardhat');
const { coverage } = require('@0xweb/hardhat');
const enableCoverage = app.config.$get('coverage');

module.exports = {
    $config: {
        async $before () {
            if (enableCoverage) {
                await coverage.instrumentFiles({
                    source: './contracts/',
                    ignore: [
                        'contracts/test/',
                        'contracts/lens/',
                        'contracts/oz/',
                        'contracts/Proxies.sol'
                    ]
                });
                // await coverage.attachToHardhatVM({
                //     options: {
                //         web3: hh.network.provider
                //     }
                // });
                await coverage.compile({
                    contracts: './coverage/contracts/'
                });

                const processExit = process.exit;
                process.exit = async (code) => {
                    processExit.call(process, 0);
                };
            }
        },
        async $after  () {
            if (enableCoverage) {
                await coverage.report();
            }
        }
    },
    suites: {
        node: {
            tests: 'test/tranches/**.spec.ts'
        }
    }
};

