import { MM1UsdDeployments } from '@s/deployments/MM1UsdDeployments';
import { ITestHelper } from '../interfaces/ITestHelper';
import { $date } from 'dequanto/utils/$date';
import { $bigint } from 'dequanto/utils/$bigint';
import { TEth } from 'dequanto/models/TEth';
import { type $hh } from 'test/tranches/utils/$hh';
import { $erc20 } from '@test/tranches/utils/$erc20';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export class MM1UsdTestHelper implements ITestHelper {
    constructor(public test: $hh.Test<MM1UsdDeployments>) {}

    async getStrategyTokensMain() {
        const { base, mM1USD } = await this.test.factory.ensureUnderlying();
        return {
            base: base.address,
            receipt: mM1USD.address,
        };
    }

    async getStrategyTokensIn() {
        const { mM1USD } = await this.test.factory.ensureUnderlying();
        return [ mM1USD ]
    }

    async getStrategyTokensOut() {
        const { base, mM1USD } = await this.test.factory.ensureUnderlying();
        return [
            {
                ...base,
                cooldown: 'unstake' as const,
            },
            mM1USD,
        ];
    }

    async distributeRewards(params: { dt: number | string; amount?: number; apr?: number | bigint }) {
        let { oracle } = await this.test.tranches;

        let dt = typeof params.dt === 'number' ? params.dt : $date.parseTimespan(params.dt, { get: 's' });

        let round = await oracle.latestRoundData();

        if (params.apr != null) {
            let apr = typeof params.apr === 'bigint' ? params.apr : $bigint.toWei(params.apr, 12);
            let gainFactor = (apr * BigInt(dt)) / BigInt(SECONDS_PER_YEAR);
            let nextPrice = (round.answer * (10n ** 12n + gainFactor)) / 10n ** 12n;
            let updater = {
                address: `0x9e104D8Bd58759CF0C8d45f32C846df82916E69e`,
                type: 'impersonated',
            } as TEth.IAccount;

            await oracle.$receipt().setRoundData(updater, nextPrice);
            return;
        }
    }

    async getUnderlyingExitFee(tokenOut: TEth.Address) {
        return 0;
        // No fees for "requestRedeem"
    }

    async getUnderlyingUnstakePeriod() {
        return '3days';
    }

    async finalizeUnderlyingUnstake() {
        const { base, redemptionVault } = await this.test.factory.ensureUnderlying();
        const latestRequestId = (await redemptionVault.currentRequestId()) - 1n;
        const account = {
            address: '0x2ACB4BdCbEf02f81BF713b696Ac26390d7f79A12',
            type: 'impersonated',
        } as TEth.IAccount;

        const requestRedeemer = await redemptionVault.requestRedeemer();
        await $erc20.setBalanceAny(base as any, requestRedeemer, BigInt(1_000e6));

        const req = await redemptionVault.redeemRequests(latestRequestId);
        await redemptionVault.$receipt().approveRequest(account, latestRequestId, req.mTokenRate);
    }
}
