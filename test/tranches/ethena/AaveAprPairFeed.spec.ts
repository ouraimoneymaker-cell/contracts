import { EthenaDeployments } from '../../../src/deployments/EthenaDeployments';
import { UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';

import { $hh } from '../utils/$hh';
import { $apr } from '@s/utils/$apr';
import { AaveAprPairProvider } from '@0xc/hardhat/AaveAprPairProvider/AaveAprPairProvider';
import { Addresses } from '@s/constants';
import { $bigint } from 'dequanto/utils/$bigint';
import { l } from 'dequanto/utils/$logger';

await $hh.test.init();

let forked: EthenaDeployments;

UTest.create({

    async $before () {
        forked = await $hh.forked();
    },

    async $after () {;
        await $hh.reset(forked.client);
    },

    async 'aave feed' () {
        //const aaveProtocolDataProvider = '0x0a16f2FCC0D44FaE41cc54e079281D84A363bECD';
        const aavePool = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
        const usdc = Addresses.eth.USDC;
        const usdt = Addresses.eth.USDT;
        // aUSDc = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c'
        const sUSDe = Addresses.eth.sUSDe;

        let { contract: provider } = await forked.ds.ensure(AaveAprPairProvider, {
            arguments: [
                aavePool,
                [
                    usdc,
                    usdt
                ],
                sUSDe
            ]
        });

        const apr = await provider.getAPRtarget();
        const aprEth = $bigint.toEther(apr, 12);
        $require.lt(aprEth, 10 / 100);
        $require.gt(aprEth, .5 / 100);

        const apy = $apr.toApy(apr);
        l`avg APY cyan<${apy}>`;

        const usdcData = await provider.getAaveAsset(0n);
        l`USDC APY cyan<${$apr.toApy(usdcData.apr)}>`;

        const usdtData = await provider.getAaveAsset(1n);
        l`USDT APY cyan<${$apr.toApy(usdtData.apr)}>`;

        const pair = await provider.getAprPair();
        $require.eq(pair.aprTarget, apr, `APR target does not match`);
    }
})
