import { ITestHelper } from '../interfaces/ITestHelper';
import { $date } from 'dequanto/utils/$date';
import { $bigint } from 'dequanto/utils/$bigint';
import { TEth } from 'dequanto/models/TEth';
import { type $hh } from 'test/tranches/utils/$hh';
import { SaturnDeployments } from '@s/deployments/SaturnDeployments';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $erc20 } from '@test/tranches/utils/$erc20';
import { $bigfloat } from 'dequanto/utils/$bigfloat';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export class SaturnTestHelper implements ITestHelper {
    constructor (public test: $hh.Test<SaturnDeployments>) {

    }
    async getStrategyTokensMain() {
        const { base, sUSDat } = await this.test.factory.ensureUnderlying();
        return {
            base: base.address,
            receipt: sUSDat.address,
        };
    }


    async getStrategyTokensIn() {
        const { strategy } = this.test.tranches;
        const tokens = await strategy.getSupportedTokens();
        return tokens.map(address => ({ address }))
    }
    async getStrategyTokensOut() {
        const { base, sUSDat } = await this.test.factory.ensureUnderlying();
        return [
            sUSDat,
            {
                ...base,
                cooldown: 'unstake' as const
            },
        ];
    }

    async distributeRewards (params: {
        assetsBefore?: bigint
        dt: number | string
        amount?: number
        apr?: number | bigint
    }) {
        let { strategy, sUSDat } = await this.test.tranches;

        let dt = typeof params.dt === 'number'
            ? params.dt
            : $date.parseTimespan(params.dt, { get:'s' });

        let assets = params.assetsBefore;

        if (params.apr != null) {

            let apr = typeof params.apr === 'bigint' ? params.apr : $bigint.toWei(params.apr, 12);

            const weiPerDt = $bigfloat
                .from(assets)
                .mul(apr)
                .mul(dt)
                .div(SECONDS_PER_YEAR)
                .div(10**12)
                .toBigInt();

            const nextAssets = assets + weiPerDt;
            const shares = await strategy.convertToTokens(sUSDat.address, nextAssets, 1);

            await $erc20.setBalanceAny(sUSDat as any as ERC20, strategy.address, shares);
            return;
        }
    }

    async getUnderlyingExitFee (tokenOut: TEth.Address) {
        return 0;
        // sUSDat has no exit fee for withdrawals (only deposit fee).
        // The 0.1% deposit fee is handled in SaturnStrategy.deposit().
    }

    async getUnderlyingUnstakePeriod () {
        return '7days';
    }

    async finalizeUnderlyingUnstake () {
        // Saturn's WithdrawalQueueERC721 requires off-chain processing.
        // In tests, use MockStakedUSDat.processAllPending() to mark requests as processed.
        const { sUSDat } = await this.test.factory.ensureUnderlying();
        await (sUSDat as any).$receipt().processAllPending(this.test.factory.owner);
    }
}
