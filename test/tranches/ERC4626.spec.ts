import { UAction, UTest } from 'atma-utest'
import { $erc4626 } from './utils/$erc4626';
import { $hh } from './utils/$hh';
import { $require } from 'dequanto/utils/$require';
import { $address } from 'dequanto/utils/$address';
import { $bigint } from 'dequanto/utils/$bigint';
import alot from 'alot';
import { $number } from 'dequanto/utils/$number';
import { $erc20 } from './utils/$erc20';
import { l } from 'dequanto/utils/$logger';
import { $promise } from 'dequanto/utils/$promise';

await $hh.test.deploy();

UAction.create({
    async $before () {
        let { sUSDe, strategy } = $hh.test.tranches;
        // Disable default cooldowns
        await sUSDe.$receipt().setCooldownDuration($hh.test.deployer, 0);
        await strategy.$receipt().setCooldowns($hh.test.deployer, 0n, 0n);
    },
    async $after () {
        await $hh.test.reset();
    },
    async 'ERC4626::maxDeposit' () {

        let { jrtVault, srtVault,  } = $hh.test.tranches;

        $require.eq(await jrtVault.maxDeposit($address.ZERO), $bigint.MAX_UINT256);
        $require.eq(await jrtVault.maxMint($address.ZERO), $bigint.MAX_UINT256);
        // Jrt is empty, Srt deposits are not allowed
        $require.eq(await srtVault.maxDeposit($address.ZERO), 0n);
        $require.eq(await srtVault.maxMint($address.ZERO), 0n);
    },
    async '!ERC4626::deposit/withdraw Juniors single user' () {
        let { jrtVault, srtVault, cdo, USDe, sUSDe, acm } = $hh.test.tranches;

        // Deposit initial
        await USDe.$receipt().mint($hh.test.deployer, $hh.test.deployer.address, 10n**18n);
        await $erc4626.deposit(jrtVault, $hh.test.deployer, 10n**18n);

        $require.eq(await srtVault.maxDeposit($address.ZERO), (10n**18n) * 20n); // max 20x

        let alice = await $hh.test.createAccount('alice');
        await USDe.$receipt().mint(alice, alice.address, 1000n * 10n**18n);

        return UTest.create({
            async 'some access checks' () {
                let directDepo = await $promise.caught(() => cdo.$receipt().deposit(alice, jrtVault.address, USDe.address, 10n**18n, 10n**18n));
                $require.notNull(directDepo.error, `manual deposit via CDO`);

                let directUpdate = await $promise.caught(() => cdo.$receipt().updateAccounting(alice));
                $require.notNull(directUpdate.error, `manual update via CDO`);

                let directInit = await $promise.caught(() => cdo.$receipt().initialize(alice, alice.address, acm.address));
                $require.notNull(directInit.error, `manual init`);

                let directReconfigure = await $promise.caught(() => jrtVault.$receipt().configure(alice));
                $require.notNull(directReconfigure.error, `manual config`);
            },
            async 'USDe' () {
                await $erc4626.deposit(jrtVault, alice, 600);
                await $erc20.eqBalance(USDe, alice, 400);
                await $erc4626.redeem(jrtVault, alice, '100%');
                await $erc20.eqBalance(USDe, alice, 1000);
            },
            async 'sUSDe' () {
                await $erc4626.deposit(sUSDe, alice, 600);
                await $erc4626.depositMeta(jrtVault, sUSDe.address, alice, '100%');

                await $erc20.eqBalance(USDe, alice, 400);
                await $erc20.eqBalance(sUSDe, alice, 0);

                await $erc4626.redeemMeta(jrtVault, sUSDe.address, alice, '100%');
                await $erc20.eqBalance(sUSDe, alice, 600);

                await $erc4626.redeem(sUSDe, alice, '100%');
                await $erc20.eqBalance(USDe, alice, 1000);
            }
        })
    },
    async 'ERC4626::deposit/withdraw Seniors single user' () {
        let { jrtVault, srtVault, USDe, sUSDe } = $hh.test.tranches;

        // Deposit initial
        await USDe.$receipt().mint($hh.test.deployer, $hh.test.deployer.address, 1000_000n * 10n**18n);
        await $erc4626.deposit(jrtVault, $hh.test.deployer, 500_000n * 10n**18n);
        await $erc4626.deposit(srtVault, $hh.test.deployer, 10n**18n);

        let bob = await $hh.test.createAccount('bob');
        await USDe.$receipt().mint(bob, bob.address, 1000n * 10n**18n);

        return UTest.create({
            async 'USDe' () {
                await $erc4626.deposit(srtVault, bob, 600);
                await $erc20.eqBalance(USDe, bob, 400);
                await $erc4626.redeem(srtVault, bob, '100%');
                await $erc20.eqBalance(USDe, bob, 1000);
            },
            async 'sUSDe' () {
                await $erc4626.deposit(sUSDe, bob, 600);
                await $erc4626.depositMeta(srtVault, sUSDe.address, bob, '100%');

                await $erc20.eqBalance(USDe, bob, 400);
                await $erc20.eqBalance(sUSDe, bob, 0);

                await $erc4626.redeemMeta(srtVault, sUSDe.address, bob, '100%');
                await $erc20.eqBalance(sUSDe, bob, 600);

                await $erc4626.redeem(sUSDe, bob, '100%');
                await $erc20.eqBalance(USDe, bob, 1000);
            }
        })
    },
    async 'ERC4626::deposit/withdraw Juniors many' () {

        let { jrtVault, USDe } = $hh.test.tranches;

        let users = await alot
            .fromRange(0, 30)
            .mapAsync(async i => {
                let user = await $hh.test.createAccount(`user_${i}`);

                let amount = $bigint.toWei($number.randomInt(5000, 1000_000));
                await USDe.$receipt().mint(user, user.address, amount);
                return {
                    user,
                    amount
                };
            })
            .toArrayAsync();

        let depositors = [
            ...users
        ];
        let withdrawers = [];

        while (depositors.length > 0) {
            let depo = depositors.shift();
            l`Deposit ${depo.user.name}`;

            await $erc4626.deposit(jrtVault, depo.user, depo.amount);
            withdrawers.push(depo);

            if ($number.randomInt(0, 5) === 1 && withdrawers.length > 2) {
                let i = $number.randomInt(0, withdrawers.length - 1);
                let [ withdrawer ] = withdrawers.splice(i, 1);
                await $erc4626.redeem(jrtVault, withdrawer.user, '100%');
                depositors.push(withdrawer);
                l`Withdraw ${depo.user.name}`;
            }
        }

        while (withdrawers.length > 1) {
            let withdrawer = withdrawers.shift();
            await $erc4626.redeem(jrtVault, withdrawer.user, '100%');
            l`Withdraw ${withdrawer.user.name}`;
            await $erc20.eqBalance(USDe, withdrawer.user, withdrawer.amount);
        }

    }
})
