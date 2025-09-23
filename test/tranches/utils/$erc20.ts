import memd from'memd';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $bigint } from 'dequanto/utils/$bigint';
import { $require } from 'dequanto/utils/$require';
import { $acc } from './$acc';
import { $hh } from './$hh';
import { l } from 'dequanto/utils/$logger';

export namespace $erc20 {

    export async function mint (erc20: any, minter: TEth.IAccount, receiver: $acc.Address, amount: bigint | number): Promise<void> {
        let amountWei = await toAmount(erc20, amount);
        let receiverAddr = $acc.toAddress(receiver);
        await erc20.$receipt().mint(minter, receiverAddr, amountWei);
    }

    export async function toAmount (token: $acc.Address, amount: bigint | number | `${number}%`, account?: $acc.Address): Promise<bigint> {
        if (typeof amount === 'bigint') {
            return amount;
        }
        let erc20 = new ERC20($acc.toAddress(token), $hh.getClient());
        if (typeof amount === 'number') {
            return $bigint.toWei(amount, await Tools.decimals(erc20))
        }
        if (amount.endsWith('%')) {
            let p = Number(/^\d+/.exec(amount)[0]);
            let user = $acc.toAddress(account);
            let balance = await erc20.balanceOf(user);
            return $bigint.multWithFloat(balance, p / 100);
        }
        throw new Error(`Invalid amount format: ${amount}`);
    }

    export async function transfer (erc20: ERC20 | any, from, to, amount: bigint | number | `${number}%`): Promise<any> {
        let amountWei = await toAmount(erc20, amount, from);
        await erc20.$receipt().transfer(from, to, amountWei);
    }

    export async function eqBalance(erc20: ERC20 | any, account: $acc.Address, amount: bigint | number, message?: string) {
        return eqBalanceDiff(erc20, account, amount, 0n, message);
    }

    export async function eqBalanceDiff(erc20: ERC20 | any, account: $acc.Address, amount: bigint | number, maxDiffWei: bigint, message?: string) {
        let decimals = await erc20.decimals();
        let amountWei = typeof amount === 'number'
            ? $bigint.toWei(amount, decimals)
            : amount;

        let address = $acc.toAddress(account);

        let balanceWei = await erc20.balanceOf(address);

        let amountEth = $bigint.toEther(amountWei, decimals);
        let balanceEth = $bigint.toEther(balanceWei, decimals);
        let diffWei = $bigint.abs(amountWei - balanceWei);
        console.log(diffWei, 'max', maxDiffWei);

        $require.lte(diffWei, maxDiffWei, `"${await erc20.symbol()}" balance missmatch for user "${address}" (${amountEth} != ${balanceEth}) ${message ?? ''}`);
        l`✅ ${account?.name}`;
        return amountWei;
    }

    export async function decimals(erc20: ERC20): Promise<number> {
        return Tools.decimals(erc20);
    }

    class Tools {
        @memd.deco.memoize()
        static async decimals (erc20: ERC20) {
            return await erc20.decimals();
        }
    }
}
