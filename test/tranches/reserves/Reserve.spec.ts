import { UAction, UTest } from 'atma-utest'
import { $erc4626 } from '../utils/$erc4626';
import { $hh } from '../utils/$hh';
import { $require } from 'dequanto/utils/$require';
import { $address } from 'dequanto/utils/$address';
import { $bigint } from 'dequanto/utils/$bigint';
import alot from 'alot';
import { $number } from 'dequanto/utils/$number';
import { $erc20 } from '../utils/$erc20';
import { l } from 'dequanto/utils/$logger';
import { $promise } from 'dequanto/utils/$promise';
import { $ethena } from '../utils/$ethena';

await $hh.test.deploy();

let { deployer, factory } = $hh.test
let { sUSDe, USDe, strategy, cdo, accounting, unstakeCooldown } = $hh.test.tranches;

UAction.create({
    async $before () {
        await $erc20.mint(USDe, deployer, deployer, 1000_000);
        await cdo.$receipt().setReserveTreasury(deployer, '0xff');
        await accounting.$receipt().setReserveBps(deployer, $bigint.toWei(0.02));
    },
    async $after () {
        await $hh.test.reset();
    },
    async 'withdraw sUSDe' () {

        let { jrtVault, srtVault,  } = $hh.test.tranches;
        await $erc4626.deposit(jrtVault, deployer, 100_000);
        await $ethena.distribute(sUSDe, USDe, deployer, 100_000);


        await $hh.test.mine('4hours');
        l`Trigger accouning`;
        await $erc4626.deposit(jrtVault, deployer, 5n);

        let reserve = await accounting.reserveNav();
        $require.eq($bigint.toEther(reserve, 18, 1n), 1000);

        l`Remove 50%`;
        let sUSDeAmount = await sUSDe.previewDeposit(reserve / 2n);
        await cdo.$receipt().reduceReserve(deployer, sUSDe.address, sUSDeAmount);
        await $erc20.eqBalance(sUSDe, '0xff', sUSDeAmount);

        l`Remains 500USDe`;
        reserve = await accounting.reserveNav();
        $require.eq($bigint.toEther(reserve, 18, 1n), 500);

        await $hh.test.mine('4hours');
        l`Trigger accouning`;
        await $erc4626.deposit(jrtVault, deployer, 5n);

        reserve = await accounting.reserveNav();
        l`Earn 996 in reserve, the 4USDe has earned the treasury account`;
        $require.eq($bigint.toEther(reserve, 18, 1n), 1496);


        await cdo.$receipt().reduceReserve(deployer, USDe.address, reserve);

        let accountNav = await accounting.nav();
        let strategyNav = await strategy.totalAssets();
        $require.gte(strategyNav, accountNav);

        l`USDe cooldowns`;
        await $erc20.eqBalance(USDe, '0xff', 0);

        await $hh.test.mine('7days');

        await unstakeCooldown.$receipt().finalize(deployer, sUSDe.address, '0xff');
        await $erc20.eqBalanceDiff(USDe, '0xff', reserve, 5n /** rounding */);
    },
    async 'sUSDe rounding test' () {

        let { jrtVault, srtVault,  } = $hh.test.tranches;

        console.log(`Balance`, await USDe.balanceOf(deployer.address));

        await $erc4626.deposit(jrtVault, deployer, 100_001);
        await $ethena.distribute(sUSDe, USDe, deployer, 111111111111111111111111n);


        await $hh.test.mine('8hours');
        l`Trigger accouning`;
        await $erc4626.deposit(jrtVault, deployer, 5n);

        let r = await accounting.reserveNav();
        await cdo.$receipt().reduceReserve(deployer, USDe.address, r);

        let accountNav = await accounting.nav();
        let strategyNav = await strategy.totalAssets();

        $require.gt(strategyNav, accountNav);

    },
})
