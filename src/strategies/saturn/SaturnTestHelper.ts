import { ITestHelper } from '../interfaces/ITestHelper';
import { $date } from 'dequanto/utils/$date';
import { $bigint } from 'dequanto/utils/$bigint';
import { TEth } from 'dequanto/models/TEth';
import { type $hh } from 'test/tranches/utils/$hh';
import { SaturnDeployments } from '@s/deployments/SaturnDeployments';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $erc20 } from '@test/tranches/utils/$erc20';
import { $bigfloat } from 'dequanto/utils/$bigfloat';
import { ISaturnWithdrawalQueueERC721 } from '@0xc/hardhat/ISaturnWithdrawalQueueERC721/ISaturnWithdrawalQueueERC721';
import { Eth } from '@s/platforms/Eth';
import { SaturnCooldownRequestImpl } from '@0xc/hardhat/SaturnCooldownRequestImpl/SaturnCooldownRequestImpl';
import { IStrcPriceOracle } from '@0xc/hardhat/IStrcPriceOracle/IStrcPriceOracle';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export class SaturnTestHelper implements ITestHelper {

    static forked = 24925000;

    constructor (public test: $hh.Test<SaturnDeployments>) {}

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
        // finalize by saturn earlier (otherwise strc oracle is stale after 7days)
        return '1h';
    }

    async finalizeUnderlyingUnstake (acc: TEth.Address) {
        // Saturn's WithdrawalQueueERC721 requires off-chain processing.
        const { sUSDat } = await this.test.factory.ensureUnderlying();
        const SaturnWithdrawProcessor = {
            address: `0x09D6E34cE24D54890fF0BC6a090b5f880F8C729f`,
            type: 'impersonated'
        } as TEth.IAccount;

        const { unstakeCooldown } = this.test.tranches;
        const req = await unstakeCooldown.activeRequests(Eth.saturn.sUSDat, acc, 0n);
        const proxy = new SaturnCooldownRequestImpl(req.proxy, this.test.client);
        const id = await proxy.requestId();
        const requestedAmount = await proxy.requestedAmount();

        const oracleAddr = await sUSDat.getStrcOracle();
        const oracle = new IStrcPriceOracle(oracleAddr, this.test.client);
        const priceData = await oracle.getPrice();
        const price = priceData.price;
        const shares = requestedAmount * 10n**8n / price;

        const queue = new ISaturnWithdrawalQueueERC721('0x4Bc9FEC04F0F95e9b42a3EF18F3C96fB57923D2e', this.test.client);

        await queue.$receipt().lockRequests(SaturnWithdrawProcessor, [
            id
        ]);
        await queue.$receipt().processRequests(SaturnWithdrawProcessor, [
            id
        ], requestedAmount, shares, price);

        // Move forward 7 days to finalize our unstake request
        await this.test.mine('7days');

    }

}
