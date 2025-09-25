import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UAction } from 'atma-utest'
import { $usde } from '../utils/$usde';
import { $erc20 } from '../utils/$erc20';
import { $acc } from '../utils/$acc';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';
import { $erc4626 } from '../utils/$erc4626';
import { UnstakeCooldown } from '@0xc/hardhat/UnstakeCooldown/UnstakeCooldown';
import { $hh } from '../utils/$hh';
import { $promise } from 'dequanto/utils/$promise';
import { $testCooldown } from './$testCooldown';



let hh = new HardhatProvider();
let alice = await hh.deployer(1);
let bob = await hh.deployer(2);

await $hh.test.deploy();

let { USDe, sUSDe } = await $hh.test.factory.ensureEthena();
let { unstakeCooldown, acm } = await $hh.test.factory.ensureCooldowns();

await $usde.mint(USDe, alice, 1000.0);
await $erc4626.deposit(sUSDe, alice, 1000.0);
await acm.$receipt().grantRole($hh.test.deployer, await unstakeCooldown.COOLDOWN_WORKER_ROLE(), alice.address);

await $hh.test.snapshot('unstakeCooldown');

UAction.create({
    async $teardown () {
        await $hh.test.reset('unstakeCooldown');
    },
    async $after () {
        await $hh.test.reset();
    },
    async 'cooldown to self with 2 requests' () {

        let { unstakeCooldown, acm } = await $hh.test.factory.ensureCooldowns();
        await acm.$receipt().grantRole($hh.test.deployer, await unstakeCooldown.COOLDOWN_WORKER_ROLE(), alice.address);

        await transfer(unstakeCooldown, sUSDe, alice, bob.address, 20n);
        await $testCooldown.eqBalanceOf(unstakeCooldown, sUSDe, bob, { pending: 20n, claimable: 0n, nextUnlockAmount: 20n, nextUnlockAt: '7days' });
        await $hh.test.mine(`2d`);
        await transfer(unstakeCooldown, sUSDe, alice, bob.address, 30n);
        await $testCooldown.eqBalanceOf(unstakeCooldown, sUSDe, bob, { pending: 50n, claimable: 0n, nextUnlockAmount: 20n, nextUnlockAt: '5days' });

        // no transfers yet
        await $erc20.eqBalance(USDe, bob, 0n);

        // fail to withdraw
        try {
            await $testCooldown.finalize(unstakeCooldown, sUSDe, bob);
            throw new Error(`Unreached`)
        } catch (error) {
            $require.notEq(error.message, 'Unreached');
        }

        // #1: 7days passed, withdraw 1. portion
        await $hh.test.mine(`6days`);
        await $testCooldown.eqBalanceOf(unstakeCooldown, sUSDe, bob, { pending: 30n, claimable: 20n, nextUnlockAmount: 30n, nextUnlockAt: '1day' });

        await $testCooldown.finalize(unstakeCooldown, sUSDe, bob);
        await $erc20.eqBalance(USDe, bob, 20n);

        // No balance yet
        await $testCooldown.eqBalanceOf(unstakeCooldown, sUSDe, bob, { pending: 30n, claimable: 0n, nextUnlockAmount: 30n, nextUnlockAt: '1day' });

        // #2: 9days passed, withdraw 2. portion
        await $hh.test.mine(`3days`);
        await $testCooldown.eqBalanceOf(unstakeCooldown, sUSDe, bob, { pending: 0n, claimable: 30n, nextUnlockAmount: 0n, nextUnlockAt: 0n });
        await $testCooldown.finalize(unstakeCooldown, sUSDe, bob);

        // Check USDe balance (after unstake)
        await $erc20.eqBalance(USDe, bob, 50n);
        await $testCooldown.eqBalanceOf(unstakeCooldown, sUSDe, bob, { pending: 0n, claimable: 0n, nextUnlockAmount: 0n, nextUnlockAt: 0n });
    },
    async 'emergency unstake for sUSDe' () {

        await transfer(unstakeCooldown, sUSDe, alice, bob.address, 21n);

        let result = await $promise.caught(() => $testCooldown.finalize(unstakeCooldown, sUSDe, bob.address));
        $require.match(/NothingToFinalize/, result.error?.message);

        await sUSDe.$receipt().setCooldownDuration($hh.test.deployer, 0);
        await $testCooldown.eqBalanceOf(unstakeCooldown, sUSDe, bob, { pending: 0n, claimable: 21n, nextUnlockAmount: 0n, nextUnlockAt: 0n });
        await $testCooldown.finalize(unstakeCooldown, sUSDe, bob.address);
        await $erc20.eqBalance(USDe, bob, 21n);
    }
})


async function transfer (cooldown: UnstakeCooldown, token: ERC20 | any, from: TEth.IAccount, to: $acc.Address, amount: bigint) {
    await token.$receipt().approve(from, cooldown.address, amount);
    await cooldown.$receipt().transfer(from, token.address, $acc.toAddress(to), amount);
}
