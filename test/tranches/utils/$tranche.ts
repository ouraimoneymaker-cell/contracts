import { Tranche } from '@0xc/hardhat/Tranche/Tranche';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $bigint } from 'dequanto/utils/$bigint';
import { $acc } from './$acc';
import { $erc20 } from './$erc20';
import { StrataCDO } from '@0xc/hardhat/StrataCDO/StrataCDO';
import { $erc4626 } from './$erc4626';
import { DeploymentsBase } from '@s/deployments/DeploymentsBase';
import { $hh } from './$hh';
import { $date } from 'dequanto/utils/$date';
import { $bigfloat } from 'dequanto/utils/$bigfloat';
import { CDOLens } from '@0xc/hardhat/CDOLens/CDOLens';

export namespace $tranche {
    export async function deposit(tranche: Tranche, sender: TEth.IAccount, token: $acc.Address, amount: bigint | number | `${number}%`) {
        let tokenAddress = $acc.toAddress(token);
        let erc20 = new ERC20(tokenAddress, tranche.client);
        let amountWei = await $erc20.toAmount(token, amount, sender);

        await erc20.$receipt().approve(sender, tranche.address, amountWei);
        await tranche.$receipt().deposit(sender, tokenAddress, amountWei, sender.address);
    }

    export async function withdraw(tranche: Tranche, sender: TEth.IAccount, token: $acc.Address, amount: bigint | number | `${number}%`) {
        let tokenAddress = $acc.toAddress(token);
        let amountWei = await $erc20.toAmount(token, amount, sender);

        await tranche.$receipt().withdraw(sender, tokenAddress, amountWei, sender.address, sender.address);
    }

    export async function balanceOfAssets(tranche: Tranche, cdo: StrataCDO, account: $acc.Address) {
        let address = $acc.toAddress(account);
        let pps = await cdo.pricePerShare(tranche.address);
        let balance = await tranche.balanceOf(address);

        return $bigint.toEther(balance * pps / 10n ** 18n);
    }

    export async function ensureCoverage(test: $hh.Test<DeploymentsBase>, covPct: number, minimums?: { jrt?: number, srt?: number }) {
        let { cdo, jrtVault, srtVault } = test.tranches;
        let { deployer } = test.factory;
        let { jrtNav, srtNav } = await cdo.totalAssetsUnlocked();
        let jrtNavEth = $bigint.toEther(jrtNav);
        let srtNavEth = $bigint.toEther(srtNav);

        if (jrtNavEth === 0 && srtNavEth === 0) {
            let minJrt = minimums.jrt!
            let srt = Math.abs(minJrt / (covPct / 100));
            await $erc4626.deposit(jrtVault, deployer, $bigint.toWei(minJrt));
            await $erc4626.deposit(srtVault, deployer, $bigint.toWei(srt));
            return;
        }

        let current = jrtNavEth / srtNavEth * 100;
        if (current < covPct) {
            let amount = covPct / 100 * srtNavEth - jrtNavEth;
            await $erc4626.deposit(jrtVault, deployer, $bigint.toWei(amount));
            jrtNavEth += amount;
        } else if (current > covPct) {
            let amount = jrtNavEth * 100 / covPct - srtNavEth;
            await $erc4626.deposit(srtVault, deployer, $bigint.toWei(amount));
            srtNavEth += amount;
        }

        let scale = 1;
        if (minimums?.jrt > jrtNavEth) {
            scale = minimums.jrt / jrtNavEth;
        }
        if (minimums?.srt > srtNavEth) {
            scale = Math.max(scale, minimums.srt / srtNavEth);
        }
        if (scale > 1) {
            await $erc4626.deposit(jrtVault, deployer, $bigint.toWei(jrtNavEth * scale - jrtNavEth));
            await $erc4626.deposit(srtVault, deployer, $bigint.toWei(srtNavEth * scale - srtNavEth));
        }
    }

    export async function calcWeiPerT(tranche: Tranche, lens: CDOLens, dt: number | string = 1 /* 1 second */) {
        const [apr, nav] = await Promise.all([
            lens.getTrancheAPR(tranche.address),
            tranche.totalAssets()
        ]);
        const seconds = typeof dt === 'number'
            ? dt
            : $date.parseTimespan(dt, { get: 's' });

        const WEI_PER_DT = $bigfloat
            .from(nav)
            .mul(apr)
            .mul(seconds)
            .div(365 * 24 * 3600)
            .div(10 ** 12)
            .toBigInt();

        return WEI_PER_DT;
    }
}
