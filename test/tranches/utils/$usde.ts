import { TEth } from 'dequanto/models/TEth';
import { $bigint } from 'dequanto/utils/$bigint';
import { MockUSDe } from '@0xc/hardhat/MockUSDe/MockUSDe';

export namespace $usde {
    export async function mint (usde: MockUSDe, sender: TEth.IAccount,  amount: bigint | number) {
        let amountWei = typeof amount === 'number' ? $bigint.toWei(amount, 18) : amount;
        await usde.$receipt().mint(sender, sender.address, amountWei);
    }
}
