import { Tranche } from '@0xc/hardhat/Tranche/Tranche';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $bigint } from 'dequanto/utils/$bigint';
import { $acc } from './$acc';
import { $erc20 } from './$erc20';

export namespace $tranche {
    export async function deposit (tranche: Tranche, sender: TEth.IAccount, token: $acc.Address, amount: bigint | number | `${number}%`) {
        let tokenAddress = $acc.toAddress(token);
        let erc20 = new ERC20(tokenAddress, tranche.client);
        let amountWei = await $erc20.toAmount(token, amount, sender);

        await erc20.$receipt().approve(sender, tranche.address, amountWei);
        await tranche.$receipt().deposit(sender, tokenAddress, amountWei, sender.address);
    }

    export async function withdraw (tranche: Tranche, sender: TEth.IAccount, token: $acc.Address, amount: bigint | number | `${number}%`) {
        let tokenAddress = $acc.toAddress(token);
        let amountWei = await $erc20.toAmount(token, amount, sender);

        await tranche.$receipt().withdraw(sender, tokenAddress, amountWei, sender.address, sender.address);
    }
}
