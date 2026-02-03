import { UAction, UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { $address } from 'dequanto/utils/$address';
import { $bigint } from 'dequanto/utils/$bigint';
import { $hh } from '../utils/$hh';
import { $erc20 } from '../utils/$erc20';
import { $erc4626 } from '../utils/$erc4626';
import { l } from 'dequanto/utils/$logger';

await $hh.test.deploy();

UAction.create({
    async $before () {
        let { sUSDe, strategy } = $hh.test.tranches;
        let { deployer } = $hh.test;
        // Disable default cooldowns
        await sUSDe.$receipt().setCooldownDuration(deployer, 0);
        await strategy.$receipt().setCooldowns(deployer, 0n, 0n);
    },
    async $after () {
        await $hh.test.reset();
    },
    async 'donations should be handled' () {
        let { deployer } = $hh.test;
        let { sUSDe, USDe } = $hh.test.underlying;
        let { jrtVault, strategy, cdo } = $hh.test.tranches;

        let griefer = await $hh.test.createAccount('griefer');
        let bob = await $hh.test.createAccount('bob');

        await $erc20.mint(USDe, deployer, deployer, 1000_000);
        await $erc20.mint(USDe, griefer, griefer, 1000_000);
        await $erc20.mint(USDe, bob, bob, 1000_000);
        await $erc4626.deposit(sUSDe, griefer, 1000_000);

        l`yellow<Donate 1K: should absorb by reserve>`;
        await sUSDe.$receipt().transfer(griefer, strategy.address, 1000n * 10n**18n);

        l`On mainnet the atomic transaction: activate vaults + initial deposit`
        await cdo.$receipt().setActionStates(deployer, $address.ZERO, true, true);
        await $erc4626.deposit(jrtVault, deployer, 100);

        l`Deployer still has 100$ deposit`;
        $require.eq(await jrtVault.maxWithdraw(deployer.address), 100n * 10n**18n);

        l`Bob's circle: deposit/withdraw>`
        await $erc4626.deposit(jrtVault, bob, 1000_000);
        await $erc20.eqBalance(USDe, bob, 0);
        await $erc20.eqBalance(jrtVault, bob, 1000_000, 'Bobs balance');
        await $erc4626.redeem(jrtVault, bob, '100%');
        await $erc20.eqBalance(USDe, bob, 1000_000);

        l`yellow<Donate 1K: is vaults gain (holders profit)>`;
        await sUSDe.$receipt().transfer(griefer, strategy.address, 5000n * 10n**18n);
        await $hh.test.mine('1day');

        l`green<Bob's circle: deposit/withdraw>`
        await $erc4626.deposit(jrtVault, bob, 1000_000);
        await $erc20.eqBalance(USDe, bob, 0);
        //await $erc20.eqBalance(jrtVault, bob, 1000_000, 'Bobs balance');
        await $erc4626.redeem(jrtVault, bob, '100%');
        await $erc20.eqBalanceDiff(USDe, bob, 1000_000, 1n);

        l`Deployer has received 5000$ gain from griefer`;
        let deployerMaxWithdraw = Math.round($bigint.toEther(await jrtVault.maxWithdraw(deployer.address)))
        $require.eq(deployerMaxWithdraw, 5100);
    }
})
