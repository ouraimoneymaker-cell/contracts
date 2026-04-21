import { MROXDeployments } from '@s/deployments/MROXDeployments';
import { ITestHelper } from '../interfaces/ITestHelper';
import { $date } from 'dequanto/utils/$date';
import { $bigint } from 'dequanto/utils/$bigint';
import { TEth } from 'dequanto/models/TEth';
import { type $hh } from 'test/tranches/utils/$hh';
import { $erc20 } from '@test/tranches/utils/$erc20';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export class MROXTestHelper implements ITestHelper {
    constructor(public test: $hh.Test<MROXDeployments>) {}

    async getStrategyTokensMain() {
        const { base, mROX } = await this.test.factory.ensureUnderlying();
        return {
            base: base.address,
            receipt: mROX.address,
        };
    }

    async getStrategyTokensIn() {
        const { mROX } = await this.test.factory.ensureUnderlying();
        return [mROX];
    }

    async getStrategyTokensOut() {
        const { base, mROX } = await this.test.factory.ensureUnderlying();
        return [
            {
                ...base,
                cooldown: 'unstake' as const,
            },
            mROX,
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
                address: `0x3e7FcC64544A4582095d0b0e6cC19bf80CC21d2C`,
                type: 'impersonated',
            } as TEth.IAccount;

            await oracle.$receipt().setRoundData(updater, nextPrice);
            return;
        }
    }

    async getUnderlyingExitFee(tokenOut: TEth.Address) {
        return 0;
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

    getSanityAprTarget() {
        return [0, 0.1] as [number, number];
    }
}
