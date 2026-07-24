import { UTest } from 'atma-utest'
import { $erc4626 } from '../utils/$erc4626';
import { $hh } from '../utils/$hh';
import { $require } from 'dequanto/utils/$require';
import { $bigint } from 'dequanto/utils/$bigint';
import { $erc20 } from '../utils/$erc20';
import { l } from 'dequanto/utils/$logger';
import { $ethena } from '../utils/$ethena';


const test = await $hh.deploy('ethena');

let { deployer, factory } = test
let { sUSDe, USDe, strategy, cdo, accounting, unstakeCooldown } = test.tranches;


UTest.create({
    async $before () {
        await $erc20.mint(USDe, deployer, deployer, 1000_000);
        await cdo.$receipt().setReserveTreasury(deployer, '0xff');
    },
    async $after () {
        await test.wipe();
    },
    async $teardown () {
        await accounting.$receipt().setReserveBps(deployer, 0n);
    },
    async 'withdraw sUSDe' () {
        await accounting.$receipt().setReserveBps(deployer, $bigint.toWei(0.02));

        let { jrtVault, srtVault,  } = test.tranches;
        await $erc4626.deposit(jrtVault, deployer, 100_000);
        await $ethena.distribute(sUSDe, USDe, deployer, 1_00);


        await test.mine('4hours');

        let reserve = await accounting.totalReserve();
        $require.eq(Math.round($bigint.toEther(reserve, 18)), 1);

        l`Remove 50%`;
        let sUSDeAmount = await sUSDe.previewDeposit(reserve / 2n);
        await cdo.$receipt().reduceReserve(deployer, sUSDe.address, sUSDeAmount);
        await $erc20.eqBalance(sUSDe, '0xff', sUSDeAmount);

        l`Remains 500USDe`;
        reserve = await accounting.totalReserve();
        $require.eq($bigint.toEther(reserve, 18, 10n), 0.5);

        await test.mine('4hours');
        l`Trigger accouning`;
        await $erc4626.deposit(jrtVault, deployer, 5n);

        reserve = await accounting.totalReserve();
        l`Earn ~1.499 in reserve, the .5USDe has earned the treasury account`;

        $require.eq($bigint.toEther(reserve, 18, 1000n), 1.499);

        await cdo.$receipt().reduceReserve(deployer, USDe.address, reserve);

        let accountNav = await accounting.nav();
        let strategyNav = await strategy.totalAssets();
        $require.gte(strategyNav, accountNav);

        l`USDe cooldowns`;
        await $erc20.eqBalance(USDe, '0xff', 0);

        await test.mine('7days');

        await unstakeCooldown.$receipt().finalize(deployer, sUSDe.address, '0xff');
        await $erc20.eqBalanceDiff(USDe, '0xff', reserve, 5n /** rounding */);
    },
    async 'sUSDe rounding test' () {
        await accounting.$receipt().setReserveBps(deployer, $bigint.toWei(0.02));

        let { jrtVault, srtVault,  } = test.tranches;

        await $erc4626.deposit(jrtVault, deployer, 100_001);
        await $ethena.distribute(sUSDe, USDe, deployer, 111111111111111111111111n);

        await test.mine('8hours');
        l`Trigger accouning`;
        await $erc4626.deposit(jrtVault, deployer, 5n);

        let r = await accounting.totalReserve();
        await cdo.$receipt().reduceReserve(deployer, USDe.address, r);

        let accountNav = await accounting.nav();
        let strategyNav = await strategy.totalAssets();

        $require.gt(strategyNav, accountNav);
    },

    async 'update reserve should trigger accounting' () {
        let { jrtVault, srtVault, accounting } = test.tranches;

        await $erc4626.deposit(jrtVault, deployer, 1_000);
        await $ethena.distribute(sUSDe, USDe, deployer, 2000);

        await test.mine('8hours');
        l`Set reserve after distribution is over`;
        await accounting.$receipt().setReserveBps(deployer, $bigint.toWei(0.02))

        l`Ensure accounting`;
        await $erc4626.deposit(jrtVault, deployer, 100n);

        let r = await accounting.totalReserve();
        $require.eq(r, 0n, `No reserve must be present`);
    }
})
