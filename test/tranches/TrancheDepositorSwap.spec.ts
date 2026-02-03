import { UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { Addresses } from '@s/constants';
import { TEth } from 'dequanto/models/TEth';
import { $hh } from './utils/$hh';
import { EthenaDeployments } from '@s/deployments/EthenaDeployments';
import { TrancheDepositor } from '@0xc/hardhat/TrancheDepositor/TrancheDepositor';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $erc20 } from './utils/$erc20';
import { MockMetaERC4626 } from '@0xc/hardhat/MockMetaERC4626/MockMetaERC4626';
import { $promise } from 'dequanto/utils/$promise';

await $hh.test.init();

let forked: EthenaDeployments;

UTest.create({

    async $before () {
        forked = await $hh.forked({
            block: 24164000
        });
    },

    async $after () {
        await $hh.reset(forked.client)
    },

    async 'deposit via Swap' () {
        let { deployer, client } = forked;

        let acm = await forked.ensureACM();
        let usde = Addresses.eth.USDe;

        const router = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
        const usdt = new ERC20(Addresses.eth.USDT, client);

        let { contract: depositor } = await forked.ds.ensureWithProxy(TrancheDepositor, {
            id: 'TrancheDepositorTest',
            initialize: [
                deployer.address,
                acm.address
            ]
        });
        let { contract: vault } = await forked.ds.ensure(MockMetaERC4626, {
            arguments: [
                usde
            ]
        });

        await depositor.storage.$set(`tranches[${vault.address}][${usde}]`, true);
        await depositor.storage.$set(`autoSwaps[${usdt.address}]`, {
            router,
            fee: 100
        });

        const someUsdtHolder = { address: '0x6AC38D1b2f0c0c3b9E816342b1CA14d91D5Ff60B' } as TEth.IAccount;
        await client.debug.impersonateAccount(someUsdtHolder.address);

        return UTest.create({
            async 'simple swap with predefined minimum percentage' () {
                const balanceBefore = await vault.balanceOf(someUsdtHolder.address);
                const amount = BigInt(1e6);
                await usdt.$receipt().approve(someUsdtHolder, depositor.address, amount);

                await depositor
                    .$receipt()
                    .deposit(someUsdtHolder, vault.address, usdt.address, amount, someUsdtHolder.address, {
                        minShares: 0n,
                        swapAmountOutMinimum: 0n,
                        swapDeadline: 0n,
                        swapTokenOut: usde
                    });

                await $erc20.eqBalanceDiff(vault, someUsdtHolder, balanceBefore + BigInt(1e18), BigInt(1e17))
            },
            async 'too low return revert' () {
                const amount = BigInt(1e6);
                await usdt.$receipt().approve(someUsdtHolder, depositor.address, amount);

                let { error } = await $promise.caught(() => depositor
                    .$receipt()
                    .deposit(someUsdtHolder, vault.address, usdt.address, amount, someUsdtHolder.address, {
                        minShares: 0n,
                        swapAmountOutMinimum: BigInt(1.5e18),
                        swapDeadline: 0n,
                        swapTokenOut: usde
                    }));

                $require.match(/Too little received/, error?.message);
            }
        })

    },
})
