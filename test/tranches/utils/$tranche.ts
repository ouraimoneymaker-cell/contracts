import { Tranche } from '@0xc/hardhat/Tranche/Tranche';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $bigint } from 'dequanto/utils/$bigint';
import { $acc } from './$acc';
import { $erc20 } from './$erc20';
import { StrataCDO } from '@0xc/hardhat/StrataCDO/StrataCDO';

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

    export async function balanceOfAssets(tranche: Tranche, cdo: StrataCDO, account: $acc.Address) {
        let address = $acc.toAddress(account);
        let pps = await cdo.pricePerShare(tranche.address);
        let balance = await tranche.balanceOf(address);

        return $bigint.toEther(balance * pps / 10n**18n);
    }
}
