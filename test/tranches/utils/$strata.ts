import { $apr } from '@s/utils/$apr';
import { $hh } from './$hh';
import { $bigint } from 'dequanto/utils/$bigint';
import { $ethena } from './$ethena';
import { $require } from 'dequanto/utils/$require';
import { l } from 'dequanto/utils/$logger';
import { $test } from './$test';
import { $date } from 'dequanto/utils/$date';
import { AprPairFeed } from '@0xc/hardhat/AprPairFeed/AprPairFeed';
import { DiscreteAccounting as Accounting } from '@0xc/hardhat/DiscreteAccounting/DiscreteAccounting';
import { DeploymentsBase } from '@s/deployments/DeploymentsBase';

export namespace $strata {
    export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

    export async function disableAPRs (tranches: DeploymentsBase) {
        l`Disable APRs`;
        const { client, accounts } = tranches;
        const ROUND_STALE = $date.parseTimespan('1year', { get: 's' });
        const [
            block,
            feed,
            accounting
        ] = await Promise.all([
            client.getBlock('latest'),
            tranches.get(AprPairFeed),
            tranches.get(Accounting, { id: 'Accounting' })
        ]);
        await feed.$receipt().setRoundStaleAfter(accounts.timelock.admin, BigInt(ROUND_STALE));
        await feed.$receipt().updateRoundData(accounts.safe.operator, 0, 0, block.timestamp);
        await accounting.$receipt().onAprChanged(accounts.safe.operator);
    }

    export async function setAprsViaDistribution (test: $hh.Test<DeploymentsBase>, aprTarget: number, aprBase: number) {
        let { sUSDe, USDe, sUSDs } = test.underlying;
        let { feed } = test.tranches;

        await sUSDe.storage.$set('vestingAmount', 0n);
        await distribute(test, { apr: aprBase });

        let ssr = $bigint.toWei(aprTarget, 27) / BigInt(SECONDS_PER_YEAR) + 10n**18n;
        await sUSDs.setSsr(test.deployer,  ssr);

        let aprs = await feed.latestRoundData();
        l`APR target cyan<${$bigint.toEther(aprs.aprTarget, 12)}>; APR base cyan<${$bigint.toEther(aprs.aprBase, 12)}>;`;
        $require.eq($bigint.toEther(aprs.aprTarget, 12), aprTarget, `APR target does not match`);
    }
    export async function setAprsViaFeed (test: $hh.Test<DeploymentsBase>, aprTarget: number, aprBase: number) {
        let { deployer } = test;
        let { feed, accounting } = test.tranches;

        let timestamp = (await feed.client.getBlock('latest')).timestamp;
        await feed.$receipt().updateRoundData(deployer, $apr.toWei(aprTarget), $apr.toWei(aprBase), timestamp);
        await accounting.$receipt().onAprChanged(deployer);
    }

    export async function distribute (test: $hh.Test<DeploymentsBase>, x: { amount?: number | bigint, apr?: number }) {
        let dt: string = '8hours';
        let { sUSDe, USDe } = test.underlying;
        let { feed } = test.tranches;
        let rewards = 0n;
        if (x.apr != null) {
            let tvl = await sUSDe.totalAssets();
            let $ = $apr.Yield($bigint.toEther(tvl), x.apr, dt);
            rewards = $bigint.toWei($);
            l`Distrubute cyan<${ $bigint.toEther(rewards) }> based on cyan<${ $bigint.toEther(tvl) }> TVL and cyan<${x.apr }> APR`;
        } else {
            rewards = typeof x.amount === 'number' ? $bigint.toWei(x.amount) : x.amount;
        }

        await $ethena.distribute(sUSDe, USDe, test.deployer, rewards);

        if (x.apr != null) {
            let aprs = await feed.latestRoundData();
            let aprBase = $bigint.toEther(aprs.aprBase, 12);

            let pair = await test.tranches.sUSDeAprPairProvider.getAprPair();
            $test.eqDiff(aprBase, x.apr, 0.01, 'APR base does not match');
        }

    }
}
