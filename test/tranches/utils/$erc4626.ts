import memd from'memd';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $bigint } from 'dequanto/utils/$bigint';
import { IERC4626 } from 'dequanto/prebuilt/openzeppelin/IERC4626';
import { $acc } from './$acc';
import { $erc20 } from './$erc20';
import { $require } from 'dequanto/utils/$require';
import { Tranche } from '@0xc/hardhat/Tranche/Tranche';
import { l } from 'dequanto/utils/$logger';
import { MockUSDe } from '@0xc/hardhat/MockUSDe/MockUSDe';

export namespace $erc4626 {
    export async function deposit (erc4626: IERC4626, sender: TEth.IAccount,  amount: bigint | number | `${number}%`) {
        let erc20 = await Tools.getAsset(erc4626);
        let amountWei = await $erc20.toAmount(erc20, amount, sender);
        let balance = await erc20.balanceOf(sender.address);
        if (balance < amountWei) {
            l`Not enough ${await erc20.symbol()} to deposit. Minting ...`;
            let mintable = new MockUSDe(erc20.address, erc20.client);
            await mintable.$receipt().mint(sender, sender.address, amountWei);
        }
        let before = await erc4626.balanceOf(sender.address);
        await erc20.$receipt().approve(sender, erc4626.address, amountWei);
        await erc4626.$receipt().deposit(sender, amountWei, sender.address);
        let after = await erc4626.balanceOf(sender.address);
        // shares minted
        return after - before;
    }
    export async function mint (erc4626: IERC4626, sender: TEth.IAccount,  shares: bigint | number) {
        let erc20 = await Tools.getAsset(erc4626);
        let amountWei = await $erc20.toAmount(erc20, shares, sender);
        let assetsWei = await erc4626.previewMint(amountWei);
        let balance = await erc20.balanceOf(sender.address);
        if (balance < assetsWei) {
            l`Not enough ${await erc20.symbol()} to deposit. Minting ...`;
            let mintable = new MockUSDe(erc20.address, erc20.client);
            await mintable.$receipt().mint(sender, sender.address, assetsWei);
        }
        let before = await erc20.balanceOf(sender.address);
        await erc20.$receipt().approve(sender, erc4626.address, assetsWei);
        await erc4626.$receipt().mint(sender, amountWei, sender.address);
        let after = await erc20.balanceOf(sender.address);
        // assets provided
        return before - after;
    }

    export async function redeem (erc4626: IERC4626, sender: TEth.IAccount,  amount: bigint | number | `${number}%`) {
        let erc20 = await Tools.getAsset(erc4626);
        let before = await erc20.balanceOf(sender.address);
        let shares = await $erc20.toAmount(erc4626, amount, sender);
        await erc4626.$receipt().redeem(sender, shares, sender.address, sender.address);
        let after = await erc20.balanceOf(sender.address);
        return after - before;
    }

    export async function withdraw (erc4626: IERC4626, sender: TEth.IAccount,  amount: bigint | number) {
        let erc20 = await Tools.getAsset(erc4626);
        let before = await erc20.balanceOf(sender.address);
        let assets = await $erc20.toAmount(erc4626, amount, sender);
        await erc4626.$receipt().withdraw(sender, assets, sender.address, sender.address);
        let after = await erc20.balanceOf(sender.address);
        return after - before;
    }

    export async function depositMeta (tranche: Tranche & IERC4626, token: $acc.Address, sender: TEth.IAccount,  amount: bigint | number | `${number}%`) {
        let tokenAddress = $acc.toAddress(token);
        let amountWei = await $erc20.toAmount(token, amount, sender);
        let erc20 = new ERC20(tokenAddress, tranche.client);
        let before = await tranche.balanceOf(sender.address);
        await erc20.$receipt().approve(sender, tranche.address, amountWei);
        await tranche.$receipt().deposit(sender, erc20.address, amountWei, sender.address);
        let after = await tranche.balanceOf(sender.address);
        // minted shares
        return after - before;
    }
    export async function mintMeta (tranche: Tranche & IERC4626, token: $acc.Address, sender: TEth.IAccount,  shares: bigint | number) {
        let tokenAddress = $acc.toAddress(token);
        let sharesWei = await $erc20.toAmount(token, shares, sender);
        let erc20 = new ERC20(tokenAddress, tranche.client);
        let before = await erc20.balanceOf(sender.address);

        let assetsWei = await tranche.previewMint(sharesWei)
        await erc20.$receipt().approve(sender, tranche.address, assetsWei);
        await tranche.$receipt().mint(sender, erc20.address, sharesWei, sender.address);
        let after = await erc20.balanceOf(sender.address);
        // assets provided
        return before - after;
    }

    export async function redeemMeta (tranche: Tranche, token: $acc.Address, sender: TEth.IAccount,  amount: bigint | number | `${number}%`) {
        let tokenAddress = $acc.toAddress(token);
        let shares = await $erc20.toAmount(tranche, amount, sender);
        let erc20 = new ERC20(tokenAddress, tranche.client);
        let before = await erc20.balanceOf(sender.address);
        await tranche.$receipt().redeem(sender, tokenAddress, shares, sender.address, sender.address);
        let after = await erc20.balanceOf(sender.address);
        return after - before;
    }
    export async function withdrawMeta (tranche: Tranche, token: $acc.Address, sender: TEth.IAccount,  amount: bigint | number) {
        let tokenAddress = $acc.toAddress(token);
        let tokenAmount = await $erc20.toAmount(tranche, amount, sender);

        let before = await tranche.balanceOf(sender.address);
        await tranche.$receipt().withdraw(sender, tokenAddress, tokenAmount, sender.address, sender.address);
        let after = await tranche.balanceOf(sender.address);
        // burned shares
        return before - after;
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
