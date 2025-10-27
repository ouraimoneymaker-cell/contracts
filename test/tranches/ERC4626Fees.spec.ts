import { UAction, UTest } from 'atma-utest'
import { $erc4626 } from './utils/$erc4626';
import { $hh } from './utils/$hh';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { $promise } from 'dequanto/utils/$promise';
import { l } from 'dequanto/utils/$logger';

await $hh.test.deploy();

let { deployer } = $hh.test;

UAction.create({
    async $before () {
        let { sUSDe, USDe, strategy, jrtVault } = $hh.test.tranches;

        // Disable default cooldowns
        await sUSDe.$receipt().setCooldownDuration(deployer, 0);
        await strategy.$receipt().setCooldowns(deployer, 0n, 0n);

        // min shares
        await $erc4626.deposit(jrtVault, deployer, 10);
    },
    async $after () {
        await $hh.test.reset();
    },
    async 'ERC4626::withdrawal fee' () {
        let { jrtVault, srtVault, cdo, USDe, sUSDe, acm, accounting } = $hh.test.tranches;

        // Deposit initial
        let alice = await $hh.test.createAccount('alice');

        await $erc4626.deposit(jrtVault, alice, 1000);

        let aliceTotalShares = await jrtVault.balanceOf(alice.address);

        l`No fee, max withdraw 1000$`;
        $require.eq(await jrtVault.maxWithdraw(alice.address), $bigint.toWei(1000));
        $require.eq(await jrtVault.maxRedeem(alice.address), aliceTotalShares);
        await cdo.$receipt().setExitFees(deployer, BigInt(1e16), BigInt(1e16));

        l`::previewRedeem (1%: deposited 1000, redeem 990)`;
        let shares = await jrtVault.balanceOf(alice.address);
        $require.eq(await jrtVault.previewRedeem(shares), $bigint.toWei(990));

        l`::previewWithdraw (990 equals users total shares)`;
        $require.eq(await jrtVault.previewWithdraw(990n * 10n**18n), shares);
        l`::maxWithdraw`;
        $require.eq(await jrtVault.maxWithdraw(alice.address), $bigint.toWei(990));
        l`::maxRedeem (unchanged)`;
        $require.eq(await jrtVault.maxRedeem(alice.address), aliceTotalShares);

        await $hh.test.snapshot('fees-alice');

        return UTest.create({
            async $teardown () {
                await $hh.test.reset('fees-alice');
            },
            async 'conversion check' () {
                for (let i = 0n; i < 9n; i++ ) {
                    const shares1 = 989898989898989898989n + i;
                    const assets = await jrtVault.previewRedeem(shares1);
                    const shares2 = await jrtVault.previewWithdraw(assets);
                    $require.eq(shares2, shares1, 'Share conversion error');
                }
                for (let i = 0n; i < 9n; i++ ) {
                    const assets1 = 989898989898989898989n + i;
                    const shares = await jrtVault.previewWithdraw(assets1);
                    const assets2 = await jrtVault.previewRedeem(shares);
                    $require.eq(assets1, assets2, 'Assets conversion error');
                }
            },
            async 'withdraw 1 step - 1% ~ 10$ fee' () {
                l`Should revert, as assetsNet is passed and assetsGross is not enough`;
                let { error } = await $promise.caught(() => {
                    return $erc4626.withdraw(jrtVault, alice, 1000);
                });
                $require.match(/ERC4626ExceededMaxWithdraw/, error.message);

                let balance = await $erc4626.withdraw(jrtVault, alice, 990);
                $require.eq(await accounting.reserveNav(), $bigint.toWei(10));
                $require.eq(balance, 990n * 10n**18n);
            },
            async 'withdraw 2 step' () {
                console.log('Alice', await jrtVault.balanceOf(alice.address));
                let balance = await $erc4626.withdraw(jrtVault, alice, 10);
                // 1% from 10$ net
                $require.eq(await accounting.reserveNav(), 101010101010101010n);
                $require.eq(balance, 10n * 10n**18n);

                let maxWithdraw = await jrtVault.maxWithdraw(alice.address);
                $require.eq(maxWithdraw, 980000000000000000001n, `1 wei rounding in favor of user`)
                balance = await $erc4626.withdraw(jrtVault, alice, 980);
                $require.eq(await accounting.reserveNav(), 9999999999999999999n);
                $require.eq(await jrtVault.balanceOf(alice.address), 1n, `After fixed (980$) withdrawal, user has 1 wei jrUSDe left`);
            },
            async 'redeem' () {
                let balance = await $erc4626.redeem(jrtVault, alice, '100%');
                $require.eq(await accounting.reserveNav(), $bigint.toWei(10));
                $require.eq(balance, 990n * 10n**18n);
            },
            async 'redeem 2 step' () {
                let balance = await $erc4626.redeem(jrtVault, alice, '30%');
                $require.eq(balance, $bigint.toWei(990 * .3));
                $require.eq(await accounting.reserveNav(), $bigint.toWei(990 * .3 / 99));

                balance = await $erc4626.redeem(jrtVault, alice, '100%');
                $require.eq(balance, $bigint.toWei(990 * .7));
                $require.eq(await jrtVault.balanceOf(alice.address), 0n);
                $require.eq(await USDe.balanceOf(alice.address), 990n * 10n**18n);
            }
        });
    },
})


