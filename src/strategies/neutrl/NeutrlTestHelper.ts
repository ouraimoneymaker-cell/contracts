import { ITestHelper } from '../interfaces/ITestHelper';
import { $date } from 'dequanto/utils/$date';
import { $bigint } from 'dequanto/utils/$bigint';
import { TEth } from 'dequanto/models/TEth';
import { type $hh } from 'test/tranches/utils/$hh';
import { NeutrlDeployments } from '@s/deployments/NeutrlDeployments';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $erc20 } from '@test/tranches/utils/$erc20';
import { $bigfloat } from 'dequanto/utils/$bigfloat';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export class NeutrlTestHelper implements ITestHelper {
    constructor (public test: $hh.Test<NeutrlDeployments>) {

    }
    async getStrategyTokensMain() {
        const { base, sNUSD } = await this.test.factory.ensureUnderlying();
        return {
            base: base.address,
            receipt: sNUSD.address,
        };
    }


    async getStrategyTokensIn() {
        const { strategy } = this.test.tranches;
        const tokens = await strategy.getSupportedTokens();
        return tokens.map(address => ({ address }))
    }
    async getStrategyTokensOut() {
        const { base, sNUSD } = await this.test.factory.ensureUnderlying();
        return [
            {
                ...base,
                cooldown: 'unstake' as const
            },
            sNUSD
        ];
    }

    async distributeRewards (params: {
        assetsBefore?: bigint
        dt: number | string
        amount?: number
        apr?: number | bigint
    }) {
        let { strategy, sNUSD } = await this.test.tranches;

        let dt = typeof params.dt === 'number'
            ? params.dt
            : $date.parseTimespan(params.dt, { get:'s' });

        let assets = params.assetsBefore;

        if (params.apr != null) {

            let apr = typeof params.apr === 'bigint' ? params.apr : $bigint.toWei(params.apr, 12);
            // let gainFactor = apr * BigInt(dt) / BigInt(SECONDS_PER_YEAR);
            // let nextAssets = assets * (10n**12n + gainFactor) / 10n**12n;

            const weiPerDt = $bigfloat
                .from(assets)
                .mul(apr)
                .mul(dt)
                .div(SECONDS_PER_YEAR)
                .div(10**12)
                .toBigInt();

            const nextAssets = assets + weiPerDt;
            const shares = await strategy.convertToTokens(sNUSD.address, nextAssets, 1);

            await $erc20.setBalanceAny(sNUSD as any as ERC20, strategy.address, shares);
            return;
        }
    }

    async getUnderlyingExitFee (tokenOut: TEth.Address) {
        return 0;
        // No fees for "requestRedeem"
        // const { redemptionVault, mHYPER } = await this.test.factory.ensureUnderlying();
        // if ($address.eq(tokenOut, mHYPER.address)) {
        //     return 0;
        // }
        // const [
        //     tokenConfig,
        //     instantFee
        // ] = await Promise.all([
        //     redemptionVault.tokensConfig(tokenOut),
        //     redemptionVault.instantFee()
        // ]);
        // // bps to fraction
        // return $bigint.toEther(tokenConfig.fee + instantFee, 4);
    }

    async getUnderlyingUnstakePeriod () {
        return '10days';
    }

    async finalizeUnderlyingUnstake () {

    }
}
