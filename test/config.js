const hh = require('hardhat');
const { coverage } = require('@0xweb/hardhat');
const enableCoverage = app.config.$get('coverage');
const noCompile = app.config.$get('no-compile');

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
                if (noCompile) {
                    await coverage.attachToHardhatVM();
                } else {
                    await coverage.compile({
                        contracts: './coverage/contracts/'
                    });
                }

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

