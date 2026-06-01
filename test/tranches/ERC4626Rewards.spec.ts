import { UTest } from 'atma-utest'
import { $erc4626 } from './utils/$erc4626';
import { $hh } from './utils/$hh';
import { $erc20 } from './utils/$erc20';
import { $ethena } from './utils/$ethena';

await $hh.test.deploy();

UTest.create({
    async $before () {
        let { sUSDe, USDe, strategy, jrtVault } = $hh.test.tranches;
        let { deployer } = $hh.test;
        // Disable default cooldowns
        await sUSDe.$receipt().setCooldownDuration(deployer, 0);
        await strategy.$receipt().setCooldowns(deployer, 0n, 0n);

        // include rewards vesting
        await $erc20.mint(USDe, deployer, deployer, 1000_000);
        await $erc4626.deposit(sUSDe, deployer,  100_000);
        await $ethena.distribute(sUSDe, USDe, deployer, 100);

        // min shares
        await $erc4626.deposit(jrtVault, deployer, 10);
    },
    async $after () {
        await $hh.test.reset();
    },
    async 'ERC4626::deposit/withdraw Juniors single user (No Rewards)' () {
        let { jrtVault, srtVault, cdo, USDe, sUSDe, acm } = $hh.test.tranches;

        // Deposit initial
        let alice = await $hh.test.createAccount('alice');

        await $hh.test.mine('9hours');
        await $erc20.mint(USDe, alice, alice, 1000);

        await $hh.test.snapshot('alice');

        return UTest.create({
            async $teardown () {
                await $hh.test.reset('alice');
            },
            async 'USDe' () {
                await $erc4626.deposit(jrtVault, alice, 600);
                await $erc20.eqBalance(USDe, alice, 400);
                await $erc4626.redeem(jrtVault, alice, '100%');
                await $erc20.eqBalanceDiff(USDe, alice, 1000, 5n);
            },
            async 'sUSDe' () {
                await $erc4626.deposit(sUSDe, alice, 600);
                await $erc4626.depositMeta(jrtVault, sUSDe.address, alice, '100%');

                await $erc20.eqBalance(USDe, alice, 400);
                await $erc20.eqBalance(sUSDe, alice, 0);

                await $erc4626.redeemMeta(jrtVault, sUSDe.address, alice, '100%');
                await $erc4626.redeem(sUSDe, alice, '100%');
                await $erc20.eqBalanceDiff(USDe, alice, 1000, 5n);
            }
        })
    },
})
