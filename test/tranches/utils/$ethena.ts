
import { MockStakedUSDe } from '@0xc/hardhat/MockStakedUSDe/MockStakedUSDe';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $bigint } from 'dequanto/utils/$bigint';

export namespace $ethena {
    export async function distribute (sUSDe: MockStakedUSDe | any, USDe: ERC20 | any, distributor: TEth.IAccount,  amount: number | bigint) {

        await USDe.$receipt().approve(distributor, sUSDe.address, $bigint.MAX_UINT256);
        let amountWei = typeof amount === 'number'
            ? $bigint.toWei(amount, 18)
            : amount;
        await sUSDe.$receipt().transferInRewards(distributor, amountWei);
    }
}
