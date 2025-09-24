import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeployments } from '../../../src/deployments/TranchesDeployments';
import { UAction } from 'atma-utest'
import { $usde } from '../utils/$usde';
import { $erc20 } from '../utils/$erc20';
import { $acc } from '../utils/$acc';
import { TEth } from 'dequanto/models/TEth';
import { ERC20Cooldown } from '@0xc/hardhat/ERC20Cooldown/ERC20Cooldown';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';


let hh = new HardhatProvider();
let alice = await hh.deployer(1);
let bob = await hh.deployer(2);

await $hh.test.deploy();

let { USDe, sUSDe } = await $hh.test.factory.ensureEthena();
await $usde.mint(USDe, alice, 1000.0);

UAction.create({
    async $before () {
        // burn
        await USDe.$receipt().transfer(bob, '0x1', await USDe.balanceOf(bob.address));
    },
    async $after () {
        await $hh.test.reset();
    },
    async 'transfer via cooldown' () {

        let { erc20Cooldown, acm } = await $hh.test.factory.ensureCooldowns();
        await acm.$receipt().grantRole($hh.test.deployer, await erc20Cooldown.COOLDOWN_WORKER_ROLE(), alice.address);


        await transfer(erc20Cooldown, USDe, alice, bob, 20n, '60s');
        await transfer(erc20Cooldown, USDe, alice, bob, 30n, '120s');

        await $hh.test.mine(`30s`);

        // no transfers yet
        await $erc20.eqBalance(USDe, bob, 0n);
        await eqBalanceOf(erc20Cooldown, USDe, bob, { pending: 50n, nextUnlockAmount: 20n });

        // fail to withdraw
        console.log(await erc20Cooldown.balanceOf(USDe.address, bob.address));
        try {
            await finalize(erc20Cooldown, USDe, bob);
            throw new Error(`Unreached`)
        } catch (error) {
            console.log(error);
            $require.notEq(error.message, 'Unreached');
        }

        // #1: 60s passed, withdraw 1. portion
        await $hh.test.mine(`51s`);
        await eqBalanceOf(erc20Cooldown, USDe, bob, { pending: 30n, claimable: 20n, nextUnlockAmount: 30n });

        await finalize(erc20Cooldown, USDe, bob);
        await $erc20.eqBalance(USDe, bob, 20n);

        // No balance yet
        await eqBalanceOf(erc20Cooldown, USDe, bob, { pending: 30n, claimable: 0n, nextUnlockAmount: 30n });

        // #2: 120s passed, withdraw 2. portion
        await $hh.test.mine(`61s`);
        await eqBalanceOf(erc20Cooldown, USDe, bob, { pending: 0n, claimable: 30n, nextUnlockAmount: 0n });
        await finalize(erc20Cooldown, USDe, bob);
        await $erc20.eqBalance(USDe, bob, 50n);
        await eqBalanceOf(erc20Cooldown, USDe, bob, { pending: 0n, claimable: 0n, nextUnlockAmount: 0n });
    },
})


async function transfer (cooldown: ERC20Cooldown, token: ERC20 | any, from: TEth.IAccount, to: $acc.Address, amount: bigint, timespan: string) {
    let cooldownSeconds = BigInt(Math.floor($date.parseTimespan(timespan) / 1000));
    await token.$receipt().approve(from, cooldown.address, amount);
    await cooldown.$receipt().transfer(from, token.address, $acc.toAddress(to), amount, cooldownSeconds);
}

async function finalize (cooldown: ERC20Cooldown, token: ERC20 | any, to: $acc.Address) {
    await cooldown.$receipt().finalize($hh.test.deployer,  token.address, $acc.toAddress(to));
}

async function eqBalanceOf(cooldown: ERC20Cooldown, token: ERC20 | any, account: $acc.Address, amounts: {
    pending?: bigint,
    claimable?: bigint
    nextUnlockAmount?: bigint
}) {
    const [pending, claimable, nextUnlockAt, nextUnlockAmount] = await cooldown.balanceOf(token.address, $acc.toAddress(account));
    let balance = { pending, claimable, nextUnlockAt, nextUnlockAmount };
    $require.eq(balance.pending, amounts.pending ?? 0n);
    $require.eq(balance.claimable, amounts.claimable ?? 0n);
    if (amounts.nextUnlockAmount != null) {
        $require.eq(balance.nextUnlockAmount, amounts.nextUnlockAmount);
    }
}
