import { $apr } from '@s/utils/$apr';
import { $hh } from './$hh';
import { $bigint } from 'dequanto/utils/$bigint';
import { $ethena } from './$ethena';
import { $require } from 'dequanto/utils/$require';
import { l } from 'dequanto/utils/$logger';
import { $test } from './$test';

export namespace $strata {
    export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

    export async function setAprsViaDistribution (aprTarget: number, aprBase: number) {
        let { sUSDe, USDe, sUSDs } = $hh.test.ethena;
        let { feed } = $hh.test.tranches;

        await sUSDe.storage.$set('vestingAmount', 0n);
        await distribute({ apr: aprBase });

        let ssr = $bigint.toWei(aprTarget, 27) / BigInt(SECONDS_PER_YEAR) + 10n**18n;
        await sUSDs.setSsr($hh.test.deployer,  ssr);

        let aprs = await feed.latestRoundData();
        l`APR target cyan<${$bigint.toEther(aprs.aprTarget, 12)}>; APR base cyan<${$bigint.toEther(aprs.aprBase, 12)}>;`;
        $require.eq($bigint.toEther(aprs.aprTarget, 12), aprTarget, `APR target does not match`);
    }
    export async function setAprsViaFeed (aprTarget: number, aprBase: number) {
        let { deployer } = $hh.test;
        let { feed, accounting } = $hh.test.tranches;

        let timestamp = (await feed.client.getBlock('latest')).timestamp;
        await feed.$receipt().updateRoundData(deployer, $apr.toWei(aprTarget), $apr.toWei(aprBase), timestamp);
        await accounting.$receipt().onAprChanged(deployer);
    }

    export async function distribute (x: { amount?: number | bigint, apr?: number }) {
        let dt: string = '8hours';
        let { sUSDe, USDe } = $hh.test.ethena;
        let { feed } = $hh.test.tranches;
        let rewards = 0n;
        if (x.apr != null) {
            let tvl = await sUSDe.totalAssets();
            let $ = $apr.Yield($bigint.toEther(tvl), x.apr, dt);
            rewards = $bigint.toWei($);
            l`Distrubute cyan<${ $bigint.toEther(rewards) }> based on cyan<${ $bigint.toEther(tvl) }> TVL and cyan<${x.apr }> APR`;
        } else {
            rewards = typeof x.amount === 'number' ? $bigint.toWei(x.amount) : x.amount;
        }

        await $ethena.distribute(sUSDe, USDe, $hh.test.deployer, rewards);

        if (x.apr != null) {
            let aprs = await feed.latestRoundData();
            let aprBase = $bigint.toEther(aprs.aprBase, 12);

            let pair = await $hh.test.tranches.sUSDeAprPairProvider.getAprPair();
            $test.eqDiff(aprBase, x.apr, 0.01, 'APR base does not match');
        }

    }
}
