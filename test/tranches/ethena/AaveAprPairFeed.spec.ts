import { TranchesDeployments } from '../../../src/deployments/TranchesDeployments';
import { UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import memd from 'memd';

import { $hh } from '../utils/$hh';
import { $apr } from '@s/utils/$apr';
import { AaveAprPairProvider } from '@0xc/hardhat/AaveAprPairProvider/AaveAprPairProvider';
import { Addresses } from '@s/constants';
import { $bigint } from 'dequanto/utils/$bigint';
import { TEth } from 'dequanto/models/TEth';
import { l } from 'dequanto/utils/$logger';

await $hh.test.init();

let forked: TranchesDeployments;

UTest.create({

    async $before () {
        forked = await $hh.forked();
    },

    async $after () {
        await forked.client.debug.reset({});
        memd.fn.clearMemoized($hh.test.factory.ensureEthenaCDO);
        memd.fn.clearMemoized($hh.test.factory.ensureEthena);
        memd.fn.clearMemoized($hh.test.factory.ensureACM);
        memd.fn.clearMemoized($hh.test.factory.ensureCooldowns);
        memd.fn.clearMemoized($hh.test.deploy);
        memd.fn.clearMemoized($hh.test.init);
        forked.client.configureFork(null);
    },

    async 'aave feed' () {
        //const aaveProtocolDataProvider = '0x0a16f2FCC0D44FaE41cc54e079281D84A363bECD';
        const aavePool = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
        const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
        const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
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
        l`USDC APY cyan<${$apr.toApy(usdtData.apr)}>`;
    },
})
