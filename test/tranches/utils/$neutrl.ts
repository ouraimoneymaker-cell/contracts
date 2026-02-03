
import { MockStakedNUSD } from '@0xc/hardhat/MockStakedNUSD/MockStakedNUSD';
import { MockStakedUSDe } from '@0xc/hardhat/MockStakedUSDe/MockStakedUSDe';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $bigint } from 'dequanto/utils/$bigint';
import { l } from 'dequanto/utils/$logger';
import { $require } from 'dequanto/utils/$require';

export namespace $neutrl {
    export async function distribute (sNUSD: MockStakedNUSD | any, NUSD: ERC20 | any, distributor: TEth.IAccount,  amount: number | bigint) {

        await NUSD.$receipt().approve(distributor, sNUSD.address, $bigint.MAX_UINT256);
        let amountWei = typeof amount === 'number'
            ? $bigint.toWei(amount, 18)
            : amount;

        let balance = await NUSD.balanceOf(distributor.address);
        if (balance < amountWei) {
            await (NUSD as any).$receipt().mint(distributor, distributor.address, amountWei);
        }
        l`Distributing yellow<${amount}>`;
        await sNUSD.$receipt().transferInRewards(distributor, amountWei);
    }

    export async function setCooldownDuration (sNUSD: MockStakedUSDe, sender: TEth.IAccount, seconds: number) {
        $require.eq(sNUSD.client.platform, 'hardhat');
        await sNUSD.$receipt().setCooldownDuration(sender, seconds);
    }
}
