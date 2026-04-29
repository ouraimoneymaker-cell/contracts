import { MKRAlphaDeployments } from '@s/deployments/MKRAlphaDeployments';
import { ITestHelper } from '../interfaces/ITestHelper';
import { $date } from 'dequanto/utils/$date';
import { $bigint } from 'dequanto/utils/$bigint';
import { TEth } from 'dequanto/models/TEth';
import { type $hh } from 'test/tranches/utils/$hh';
import { $erc20 } from '@test/tranches/utils/$erc20';
import { Eth } from '@s/platforms/Eth';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export class MKRAlphaTestHelper implements ITestHelper {

    static forked = 24649868;

    constructor(public test: $hh.Test<MKRAlphaDeployments>) {}
    async getStrategyTokensMain() {
        const { base, mKRALPHA } = await this.test.factory.ensureUnderlying();
        return {
            base: base.address,
            receipt: mKRALPHA.address,
        };
    }

    async getStrategyTokensIn() {
        const { base, mKRALPHA } = await this.test.factory.ensureUnderlying();
        return [ base, mKRALPHA ];
        // const { strategy } = this.test.tranches;
        // const tokens = await strategy.getSupportedTokens();
        // return tokens.map((address) => ({ address }));
    }
    async getStrategyTokensOut() {
        const { base, mKRALPHA } = await this.test.factory.ensureUnderlying();
        return [
            {
                ...base,
                cooldown: 'unstake' as const,
            },
            mKRALPHA,
        ];
    }

    async setup () {
        let { oracle, accounting } = await this.test.tranches;
        let round = await oracle.latestRoundData();
        let now = (await this.test.client.getBlock('latest')).timestamp;
        let dt = now - Number(round.startedAt);

        await this.distributeRewards({
            apr: 0.08,
            dt,
        });
        await this.test.client.debug.mine('5min');
        await accounting.$receipt().onAprChanged(this.test.factory.owner);

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
                address: `0x7e332D7E498813cB4894355971385E815E1Ab54e`,
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

    async finalizeUnderlyingUnstake(account: TEth.Address) {
        const { base, redemptionVault } = await this.test.factory.ensureUnderlying();
        const latestRequestId = (await redemptionVault.currentRequestId()) - 1n;

        // Fund the request redeemer with base tokens and approve the redemption vault
        const requestRedeemer = {
            address: await redemptionVault.requestRedeemer(),
            type: 'impersonated',
        } as TEth.IAccount;

        await $erc20.setBalanceAny(base as any, requestRedeemer.address, BigInt(1_000e6));
        await base.$receipt().approve(requestRedeemer, Eth.mkralpha.redemptionVault, $bigint.MAX_UINT256);

        // Finaize the unstake request
        const approver = {
            address: '0x2ACB4BdCbEf02f81BF713b696Ac26390d7f79A12',
            type: 'impersonated',
        } as TEth.IAccount;
        const req = await redemptionVault.redeemRequests(latestRequestId);
        await redemptionVault.$receipt().approveRequest(approver, latestRequestId, req.mTokenRate);
    }

    getSanityAprTarget () {
        return [0, 0.1] as [number, number];
    }
}
