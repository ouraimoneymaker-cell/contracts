import { FigureDeployments } from '@s/deployments/FigureDeployments';
import { ITestHelper } from '../interfaces/ITestHelper';
import { $date } from 'dequanto/utils/$date';
import { $bigint } from 'dequanto/utils/$bigint';
import { TEth } from 'dequanto/models/TEth';
import { type $hh } from 'test/tranches/utils/$hh';
import { $erc20 } from '@test/tranches/utils/$erc20';
import { $bigfloat } from 'dequanto/utils/$bigfloat';
import { MockFeedVerifier } from '@0xc/hardhat/MockFeedVerifier/MockFeedVerifier';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export class FigureTestHelper implements ITestHelper {

    static forked = 25099102;

    constructor(public test: $hh.Test<FigureDeployments>) {

    }
    async getStrategyTokensMain() {
        const { base, stakingVault } = await this.test.factory.ensureUnderlying();
        return {
            base: base.address,
            receipt: stakingVault.address,
        };
    }

    async getStrategyTokensIn() {
        const { strategy } = this.test.tranches;
        const tokens = await strategy.getSupportedTokens();
        return tokens.map(address => ({ address }))
    }
    async getStrategyTokensOut() {
        const { base, yieldVault, stakingVault } = await this.test.factory.ensureUnderlying();
        return [
            {
                ...base,
                cooldown: 'unstake' as const
            },
            yieldVault,
            stakingVault,
        ];
    }

    async distributeRewards(params: {
        assetsBefore?: bigint
        dt: number | string
        amount?: number
        apr?: number | bigint
    }) {
        let { stakingVault, feedVerifier } = await this.test.factory.ensureUnderlying();

        let dt = typeof params.dt === 'number'
            ? params.dt
            : $date.parseTimespan(params.dt, { get: 's' });

        if (params.apr != null) {
            let apr = typeof params.apr === 'bigint' ? params.apr : $bigint.toWei(params.apr, 12);

            let feedAdmin = {
                address: '0x8D358B8aE881F8ea92C3d07783aBCA21727C6309', // FEED_ADMIN
                type: 'impersonated',
            } as TEth.IAccount;

            await feedVerifier.$receipt().setMaxStaleness(feedAdmin, 0);

            let totalAssets = await stakingVault.totalAssets();
            let amount = totalAssets * apr * BigInt(dt) / BigInt(SECONDS_PER_YEAR) / 10n ** 12n;

            let rewardsAdmin = {
                address: '0xA8C3CF6183D49d5D372f8FC149BD2cb5CFC0faCd', // REWARDS_ADMIN
                type: 'impersonated',
            } as TEth.IAccount;
            await stakingVault.$receipt().distributeRewards(rewardsAdmin, amount);

            let oldPrice = await stakingVault.getVerifiedNav();
            let newPrice = $bigfloat.from(oldPrice)
                .add($bigfloat.from(oldPrice)
                .mul(apr)
                .mul(dt)
                .div(SECONDS_PER_YEAR)
                .div(10 ** 12))
                .toBigInt();
            await this.setPriceInFeedVerifier(feedVerifier, newPrice);
            return;
        }
    }

    async getUnderlyingExitFee(tokenOut: TEth.Address) {
        return 0;
    }

    async getUnderlyingUnstakePeriod() {
        return '1days';
    }

    async finalizeUnderlyingUnstake(acc: TEth.Address) {
        const { base, yieldVault } = await this.test.factory.ensureUnderlying();
        const { unstakeCooldown } = this.test.tranches;

        const req = await unstakeCooldown.activeRequests(yieldVault.address, acc, 0n);
        const proxyAddress = req.proxy as TEth.Address;

        // Makes sure the redeemVault has enough USDC
        const redeemVault = await yieldVault.redeemVault();
        await $erc20.setBalanceAny(base as any, redeemVault, BigInt(1_000_000e6));

        // Impersonate the REWARDS_ADMIN to call completeRedeem
        const rewardsAdmin = {
            address: '0xA8C3CF6183D49d5D372f8FC149BD2cb5CFC0faCd', // REWARDS_ADMIN
            type: 'impersonated',
        } as TEth.IAccount;

        await yieldVault.$receipt().completeRedeem(rewardsAdmin, proxyAddress);

    }

    private async setPriceInFeedVerifier(feedVerifier: MockFeedVerifier, price: bigint) {
        const feedId = '0x0007c8ed155d952e003b1e15ce7666fea785cfbe216577d578fce3920e997271';

        await feedVerifier.storage.$set(`priceByFeed[${feedId}]`, price);
        await feedVerifier.storage.$set(`timestampByFeed[${feedId}]`, $date.toUnixTimestamp());
    }

    getSanityAprTarget() {
        return [0, 0.1] as [number, number];
    }

}
