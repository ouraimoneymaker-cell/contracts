import { UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { $abiUtils } from 'dequanto/utils/$abiUtils';

const test = await $hh.deploy('ethena', {
    cdoInfo: {
        ContractVersions: {
            accounting: 'discrete'
        }
    }
});
const { cdo, jrtVault, USDe } = test.tranches;
const { deployer, client } = test;

UTest.create({

    async $after () {
        await test.wipe();
    },
    async 'should forward user options to strategy' () {
        const hh = new HardhatProvider();
        const { contract: mockStrategy } = await hh.deployCode(`
            contract MockStrategy {
                struct TOptions {
                    uint256 a;
                    uint256 b;
                }
                TOptions[] public optionsArr;
                function deposit (
                    address,
                    address,
                    uint256,
                    uint256 baseAssets,
                    address,
                    bytes memory options
                ) external returns (uint256) {
                    TOptions memory option = abi.decode(options, (TOptions));
                    optionsArr.push(option);
                    return baseAssets;
                }

                function totalAssets(uint256 nav, uint256) public pure returns (uint256) {
                    return nav;
                }

                function convertToAssets (address, uint256 tokenAmount, uint8) external pure returns (uint256) {
                    return tokenAmount;
                }
                function convertToTokens (address, uint256 baseAssets, uint8) external pure returns (uint256) {
                    return baseAssets;
                }
                function depositFeeBps(address) external pure returns (uint256) {
                    return 0;
                }
                function maxDeposit(address, address, uint256) external virtual pure returns (uint256) {
                    return type(uint256).max;
                }
            }
        `, { client });

        await cdo.storage.$set('strategy', mockStrategy.address);

        await USDe.$receipt().mint(deployer, deployer.address, BigInt(10e18));
        await USDe.$receipt().approve(deployer, jrtVault.address, BigInt(10e18));

        await jrtVault.$receipt().deposit(deployer, BigInt(10e18), deployer.address, {
            strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [42n, 8n]),
        });

        let opt = await mockStrategy.optionsArr(0);
        $require.eq(opt.a, 42n);
        $require.eq(opt.b, 8n);
    }
})
