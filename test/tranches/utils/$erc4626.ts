import memd from'memd';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $bigint } from 'dequanto/utils/$bigint';
import { IERC4626 } from 'dequanto/prebuilt/openzeppelin/IERC4626';
import { $acc } from './$acc';
import { $erc20 } from './$erc20';
import { $require } from 'dequanto/utils/$require';
import { Tranche } from '@0xc/hardhat/Tranche/Tranche';

export namespace $erc4626 {
    export async function deposit (erc4626: IERC4626, sender: TEth.IAccount,  amount: bigint | number) {
        let erc20 = await Tools.getAsset(erc4626);
        let amountWei = typeof amount === 'number' ? $bigint.toWei(amount, 18) : amount;

        await erc20.$receipt().approve(sender, erc4626.address, amountWei);
        await erc4626.$receipt().deposit(sender, amountWei, sender.address);
    }

    export async function depositMeta (tranche: Tranche & IERC4626, token: $acc.Address, sender: TEth.IAccount,  amount: bigint | number) {

        let tokenAddress = $acc.toAddress(token);
        let amountWei = typeof amount === 'number' ? $bigint.toWei(amount, 18) : amount;
        let erc20 = new ERC20(tokenAddress, tranche.client);

        await erc20.$receipt().approve(sender, tranche.address, amountWei);
        await tranche.$receipt().deposit(sender, erc20.address, amountWei, sender.address);
    }

    export async function withdrawMeta (tranche: Tranche, token: $acc.Address, sender: TEth.IAccount,  amount: bigint | number) {
        let tokenAddress = $acc.toAddress(token);
        let amountWei = typeof amount === 'number' ? $bigint.toWei(amount, 18) : amount;
        await tranche.$receipt().withdraw(sender, tokenAddress, amountWei, sender.address, sender.address);
    }

    export async function getAssets (erc4626: IERC4626, account: $acc.Address, shares?: number | bigint): Promise<bigint> {
        let address = $acc.toAddress(account);
        if (shares == null) {
            shares = await erc4626.balanceOf(address)
        };

        let sharesWei = typeof shares === 'number'
            ? $bigint.toWei(shares, 18)
            : shares;

        let assets = await erc4626.convertToAssets(sharesWei);
        return assets;
    }

    export async function eqShares(erc4626: IERC4626, account: $acc.Address, requireAmount: bigint | number) {
        return $erc20.eqBalance(erc4626 as any, account, requireAmount);
    }

    export async function eqAssets(erc4626: IERC4626, account: $acc.Address, requireAmount: bigint | number) {
        let decimals = await $erc20.decimals(await Tools.getAsset(erc4626))
        let address = $acc.toAddress(account);
        let assetsWei = await $erc4626.getAssets(erc4626, account);
        let requireWei = typeof requireAmount === 'number'
            ? $bigint.toWei(requireAmount, decimals)
            : requireAmount;

        let assetsEth = $bigint.toEther(assetsWei, decimals);
        let requireEth = $bigint.toEther(requireWei, decimals);

        $require.eq(assetsWei, requireWei, `"${await erc4626.symbol()}" assets balance missmatch for user "${address}" (${assetsEth} != ${requireEth})`);
    }

    class Tools {
        @memd.deco.memoize()
        static async getAsset (erc4626: IERC4626) {
            const address = await erc4626.asset();
            return new ERC20(address, erc4626.client);
        }
    }
}
