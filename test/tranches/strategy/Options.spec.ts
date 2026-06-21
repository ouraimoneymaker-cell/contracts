import { UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { $abiUtils } from 'dequanto/utils/$abiUtils';
import { l } from 'dequanto/utils/$logger';
import { $bigint } from 'dequanto/utils/$bigint';
import { $exitMode } from '@s/utils/$exitMode';
import { $address } from 'dequanto/utils/$address';

const test = await $hh.deploy('ethena', {
    cdoInfo: {
        ContractVersions: {
            accounting: 'discrete'
        }
    }
});
const { cdo, jrtVault, USDe, sharesCooldown } = test.tranches;
const { deployer, client } = test;

UTest.create({

    async $after() {
        await test.wipe();
    },
    async 'should forward user options to strategy'() {
        const hh = new HardhatProvider();
        const { contract: mockStrategy } = await hh.deployCode(`
            interface IERC20 {
                function transfer(address recipient, uint256 amount) external returns (bool);
                function transferFrom(
                    address from,
                    address to,
                    uint256 amount
                ) external returns (bool);
            }

            contract MockStrategy {
                IERC20 public constant USDe = IERC20(${USDe.address});
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
                    address owner,
                    bytes memory options
                ) external returns (uint256) {
                    TOptions memory option = abi.decode(options, (TOptions));
                    optionsArr.push(option);
                    USDe.transferFrom(owner, address(this), baseAssets);
                    return baseAssets;
                }
                function withdraw (
                    address,
                    address,
                    uint256,
                    uint256 baseAssets,
                    address,
                    address receiver,
                    bool,
                    bytes memory options
                ) external returns (uint256) {
                    TOptions memory option = abi.decode(options, (TOptions));
                    optionsArr.push(option);
                    USDe.transfer(receiver, baseAssets);
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
                function maxDeposit(address, address, uint256) external pure returns (uint256) {
                    return type(uint256).max;
                }
                function maxWithdraw (address tranche, address tokenIn, uint256 tokenAmount) external pure returns (uint256) {
                    return tokenAmount;
                }
            }
        `, { client });

        await cdo.storage.$set('strategy', mockStrategy.address);
        await USDe.storage.$set(`_allowances[${jrtVault.address}][${mockStrategy.address}]`, $bigint.MAX_UINT256);

        await USDe.$receipt().mint(deployer, deployer.address, BigInt(100e18));
        await USDe.$receipt().approve(deployer, jrtVault.address, BigInt(100e18));

        return UTest.create({
            async 'deposit via overloaded ERC4626 vault'() {
                await jrtVault.$receipt().deposit(deployer, BigInt(10e18), deployer.address, {
                    strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [42n, 8n]),
                });
                const opt = await mockStrategy.optionsArr(0);
                $require.eq(opt.a, 42n);
                $require.eq(opt.b, 8n);
            },
            async 'deposit as Meta-Token' () {
                await jrtVault.$receipt().deposit(deployer, USDe.address, BigInt(10e18), deployer.address, {
                    strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [32n, 5n]),
                });
                const opt = await mockStrategy.optionsArr(1);
                $require.eq(opt.a, 32n);
                $require.eq(opt.b, 5n);
            },
            async 'mint via overloaded ERC4626 vault'() {
                await jrtVault.$receipt().mint(deployer, BigInt(10e18), deployer.address, {
                    strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [12n, 20n]),
                });
                const opt = await mockStrategy.optionsArr(2);
                $require.eq(opt.a, 12n);
                $require.eq(opt.b, 20n);
            },
            async 'mint as Meta-Token'() {
                await jrtVault.$receipt().mint(deployer, USDe.address, BigInt(10e18), deployer.address, {
                    strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [3n, 7n]),
                });
                const opt = await mockStrategy.optionsArr(3);
                $require.eq(opt.a, 3n);
                $require.eq(opt.b, 7n);
            },

            async 'withdraw via overloaded ERC4626 vault'() {
                await jrtVault.$receipt().withdraw(deployer, BigInt(1e18), deployer.address, deployer.address, {
                    cooldownSeconds: null,
                    exitMode: null,
                    exitFee: null,
                    strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [12n, 11n]),
                });
                const opt = await mockStrategy.optionsArr(4);
                $require.eq(opt.a, 12n);
                $require.eq(opt.b, 11n);
            },
            async 'withdraw as Meta-Token' () {
                await jrtVault.$receipt().withdraw(deployer, USDe.address, BigInt(1e18), deployer.address,  deployer.address, {
                    cooldownSeconds: null,
                    exitMode: null,
                    exitFee: null,
                    strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [14n, 15n]),
                });
                const opt = await mockStrategy.optionsArr(5);
                $require.eq(opt.a, 14n);
                $require.eq(opt.b, 15n);
            },
            async 'redeem via overloaded ERC4626 vault'() {
                await jrtVault.$receipt().redeem(deployer, BigInt(11e18), deployer.address, deployer.address, {
                    cooldownSeconds: null,
                    exitMode: null,
                    exitFee: null,
                    strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [5n, 3n]),
                });
                const opt = await mockStrategy.optionsArr(6);
                $require.eq(opt.a, 5n);
                $require.eq(opt.b, 3n);
            },
            async 'redeem as Meta-Token'() {
                await jrtVault.$receipt().redeem(deployer, USDe.address, BigInt(11e18), deployer.address, deployer.address, {
                    cooldownSeconds: null,
                    exitMode: null,
                    exitFee: null,
                    strategyOptions: $abiUtils.encode(['uint256', 'uint256'], [14n, 18n]),
                });
                const opt = await mockStrategy.optionsArr(7);
                $require.eq(opt.a, 14n);
                $require.eq(opt.b, 18n);
            },

            async 'should redeem via SharesCooldown' () {
                await sharesCooldown.$receipt().setTwoStepConfigManager(deployer, deployer.address);
                await sharesCooldown.$receipt().setVaultExitBounds(deployer, jrtVault.address, $exitMode.map([{
                    covPct: 0, feeBps: 0, lock: '1day'
                }]));

                const strategyOptionsHex = $abiUtils.encode(['uint256', 'uint256'], [18n, 1n]);
                await jrtVault.$receipt().withdraw(deployer, BigInt(1e18), deployer.address, deployer.address, {
                    cooldownSeconds: null,
                    exitMode: null,
                    exitFee: null,
                    strategyOptions: strategyOptionsHex,
                });

                const req = await sharesCooldown.activeRequests(jrtVault.address, deployer.address, 0n);
                const meta = await sharesCooldown.requestMeta(jrtVault.address, deployer.address, req.metaKey);
                $require.eq(meta, strategyOptionsHex);

                await client.debug.mine('2days');
                await sharesCooldown.$receipt().finalize(deployer, jrtVault.address, deployer.address);

                const opt = await mockStrategy.optionsArr(8);
                $require.eq(opt.a, 18n);
                $require.eq(opt.b, 1n);
            },
            async 'should redeem via SharesCooldown with Override' () {
                await sharesCooldown.$receipt().setTwoStepConfigManager(deployer, deployer.address);
                await sharesCooldown.$receipt().setVaultExitBounds(deployer, jrtVault.address, $exitMode.map([{
                    covPct: 0, feeBps: 0, lock: '1day'
                }]));

                const strategyOptionsHex = $abiUtils.encode(['uint256', 'uint256'], [17n, 15n]);
                await jrtVault.$receipt().withdraw(deployer, BigInt(1e18), deployer.address, deployer.address, {
                    cooldownSeconds: null,
                    exitMode: null,
                    exitFee: null,
                    strategyOptions: strategyOptionsHex,
                });

                const req = await sharesCooldown.activeRequests(jrtVault.address, deployer.address, 0n);
                const meta = await sharesCooldown.requestMeta(jrtVault.address, deployer.address, req.metaKey);
                $require.eq(meta, strategyOptionsHex);

                await client.debug.mine('2days');
                const strategyOptionsHexOverride = $abiUtils.encode(['uint256', 'uint256'], [14n, 16n]);
                await sharesCooldown.$receipt().finalizeWithOverrides(deployer, jrtVault.address, $address.ZERO, deployer.address, strategyOptionsHexOverride);

                const opt = await mockStrategy.optionsArr(9);
                $require.eq(opt.a, 14n);
                $require.eq(opt.b, 16n);
            },
            async 'should redeem via SharesCooldown with Override for Single request' () {
                await sharesCooldown.$receipt().setTwoStepConfigManager(deployer, deployer.address);
                await sharesCooldown.$receipt().setVaultExitBounds(deployer, jrtVault.address, $exitMode.map([{
                    covPct: 0, feeBps: 0, lock: '1day'
                }]));

                const strategyOptionsHex = $abiUtils.encode(['uint256', 'uint256'], [10n, 25n]);
                await jrtVault.$receipt().withdraw(deployer, BigInt(1e18), deployer.address, deployer.address, {
                    cooldownSeconds: null,
                    exitMode: null,
                    exitFee: null,
                    strategyOptions: strategyOptionsHex,
                });

                const req = await sharesCooldown.activeRequests(jrtVault.address, deployer.address, 0n);
                const meta = await sharesCooldown.requestMeta(jrtVault.address, deployer.address, req.metaKey);
                $require.eq(meta, strategyOptionsHex);

                await client.debug.mine('2days');
                const strategyOptionsHexOverride = $abiUtils.encode(['uint256', 'uint256'], [23n, 27n]);
                await sharesCooldown.$receipt().finalizeRequest(deployer, jrtVault.address, 0n, $address.ZERO, deployer.address, strategyOptionsHexOverride);

                const opt = await mockStrategy.optionsArr(10);
                $require.eq(opt.a, 23n);
                $require.eq(opt.b, 27n);
            }
        });
    }
})
