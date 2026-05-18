import { MockYieldVault } from '@0xc/hardhat/MockYieldVault/MockYieldVault';
import { MockFeedVerifier } from '@0xc/hardhat/MockFeedVerifier/MockFeedVerifier';
import { TEth } from 'dequanto/models/TEth';
import { $bigint } from 'dequanto/utils/$bigint';
import { l } from 'dequanto/utils/$logger';

export namespace $figure {
    /**
     * Distribute rewards to the StakingVault by increasing the NAV price
     * on the FeedVerifier. This simulates yield accrual in the Figure protocol.
     */
    export async function distributeRewards (
        feedVerifier: MockFeedVerifier,
        admin: TEth.IAccount,
        newPrice: bigint
    ) {
        l`Setting NAV price to yellow<${$bigint.toEther(newPrice, 18)}>`;
        await feedVerifier.$receipt().setPrice(admin, newPrice as any);
    }

    /**
     * Set NAV price on the FeedVerifier (1e18 scaled).
     * 1.05e18 means 1 PRIME = 1.05 wYLDS = 1.05 USDC
     */
    export async function setNavPrice (
        feedVerifier: MockFeedVerifier,
        admin: TEth.IAccount,
        price: number | bigint
    ) {
        let priceWei = typeof price === 'number'
            ? $bigint.toWei(price, 18)
            : price;
        l`Setting NAV price to yellow<${$bigint.toEther(priceWei, 18)}>`;
        await feedVerifier.$receipt().setPrice(admin, priceWei as any);
    }

    /**
     * Complete a pending redemption on the YieldVault for a given proxy.
     * This simulates the Figure admin completing the async redemption.
     */
    export async function completeRedeem (
        yieldVault: MockYieldVault,
        admin: TEth.IAccount,
        user: TEth.Address
    ) {
        l`Completing redemption for yellow<${user}>`;
        await yieldVault.$receipt().completeRedeem(admin, user);
    }
}
