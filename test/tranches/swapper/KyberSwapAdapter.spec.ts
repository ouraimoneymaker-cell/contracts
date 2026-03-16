import { UTest } from 'atma-utest';
import { $hh } from '../utils/$hh';
import { Addresses } from '@s/constants';
import { WETH } from 'dequanto/prebuilt/weth/WETH/WETH';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $require } from 'dequanto/utils/$require';
import { $erc20 } from '../utils/$erc20';
import { $bigint } from 'dequanto/utils/$bigint';
import { KyberSwapClient } from '@s/swap/KyberSwapClient';
import { TEth } from 'dequanto/models/TEth';
import { l } from 'dequanto/utils/$logger';

const test = await $hh.create('ethena', {
    forked: 'latest'
});

UTest.create({
    $config: {
        timeout: 60 * 1000
    },
    async $before() {
        await test.init();
        await test.snapshot();
    },
    async $after() {
        await test.reset();
    },
    async 'integrational test: swap eth to usdc'() {

        const wETH = new WETH(`0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`, test.client);
        const usdc = new ERC20(Addresses.eth.USDC, test.client);
        const ks = await test.factory.ensureKyberSwapAdapter();

        const alice = await test.createAccount('alice');
        await test.client.debug.setBalance(alice.address, BigInt(100e18));
        await wETH.$receipt().deposit({ ...alice, value: BigInt(50e18) });
        await wETH.$receipt().approve(alice, ks.address, $bigint.MAX_UINT256);
        await $erc20.eqBalance(wETH, alice, 50);


        const service = new KyberSwapClient();

        const Tokens = {
            weth: {
                address: wETH.address,
                decimals: 18,
            },
            usdc: {
                address: Addresses.eth.USDC,
                decimals: 6,
            },
        };

        const wethAmount = BigInt(1e18);
        const swapRoute = await service.getSwapCalldata({
            sender: alice.address,
            tokenIn: Tokens.weth,
            tokenOut: Tokens.usdc,
            amountIn: wethAmount,
            routeOptions: {
                onlySinglePath: true,
            },
            swapOptions: {
                slippageTolerance: 2000,
            }
        });

        $require.eq(swapRoute.routerAddress, '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5');

        await wETH.$receipt().approve(alice, swapRoute.routerAddress, $bigint.MAX_UINT256);

        await ks.$receipt().swap(
            alice,
            swapRoute.routerAddress as TEth.Address,
            wETH.address,
            usdc.address,
            wethAmount,
            alice.address,
            swapRoute.encodedData as TEth.Hex,
            0n
        );


        const balance = await usdc.balanceOf(alice.address);
        l`Received: cyan<${balance}>`;
        $require.gte(balance, $bigint.multWithFloat(BigInt(swapRoute.routeSummary.amountOut), .9));
    }
})
