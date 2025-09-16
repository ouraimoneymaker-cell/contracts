import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeploy } from '../../../src/deployments/TranchesDeploy';
import { UAction } from 'atma-utest'
import { $usde } from '../utils/$usde';
import { $erc20 } from '../utils/$erc20';
import { $acc } from '../utils/$acc';
import { TEth } from 'dequanto/models/TEth';
import { ERC20Cooldown } from '@0xc/hardhat/ERC20Cooldown/ERC20Cooldown';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';


let hh = new HardhatProvider();
let client = await hh.client('localhost');
let deployer = await hh.deployer(0);

let alice = await hh.deployer(1);
let bob = await hh.deployer(2);

let deploy = new TranchesDeploy({
    client,
    deployer
});

let { USDe, sUSDe } = await deploy.ensureEthena();
await $usde.mint(USDe, alice, 1000.0);



UAction.create({
    async $before () {
        // burn
        await USDe.$receipt().transfer(bob, '0x1', await USDe.balanceOf(bob.address));
    },
    async 'transfer via cooldown' () {

        let { erc20Cooldown } = await deploy.ensureCooldowns();

        await transfer(erc20Cooldown, USDe, alice, bob, 20n, '60s');
        await transfer(erc20Cooldown, USDe, alice, bob, 30n, '120s');

        await client.debug.mine(`30s`);

        // no transfers yet
        await $erc20.eqBalance(USDe, bob, 0n);
        await eqBalanceOf(erc20Cooldown, USDe, bob, 0n);

        // fail to withdraw

        try {
            await finalize(erc20Cooldown, USDe, bob);
            throw new Error(`Unreached`)
        } catch (error) {
            $require.notEq(error.message, 'Unreached');
        }

        // #1: 60s passed, withdraw 1. portion
        await client.debug.mine(`51s`);
        await eqBalanceOf(erc20Cooldown, USDe, bob, 20n);

        await finalize(erc20Cooldown, USDe, bob);
        await $erc20.eqBalance(USDe, bob, 20n);

        // No balance yet
        await eqBalanceOf(erc20Cooldown, USDe, bob, 0n);

        // #2: 120s passed, withdraw 2. portion
        await client.debug.mine(`61s`);
        await eqBalanceOf(erc20Cooldown, USDe, bob, 30n);
        await finalize(erc20Cooldown, USDe, bob);
        await $erc20.eqBalance(USDe, bob, 50n);
        await eqBalanceOf(erc20Cooldown, USDe, bob, 0n);
    },
})


async function transfer (cooldown: ERC20Cooldown, token: ERC20 | any, from: TEth.IAccount, to: $acc.Address, amount: bigint, timespan: string) {
    let cooldownSeconds = BigInt(Math.floor($date.parseTimespan(timespan) / 1000));
    await token.$receipt().approve(from, cooldown.address, amount);
    await cooldown.$receipt().transfer(from, token.address, $acc.toAddress(to), amount, cooldownSeconds);
}

async function finalize (cooldown: ERC20Cooldown, token: ERC20 | any, to: $acc.Address) {
    await cooldown.$receipt().finalize(deployer,  token.address, $acc.toAddress(to));
}

async function eqBalanceOf(cooldown: ERC20Cooldown, token: ERC20 | any, account: $acc.Address, requireAmount: bigint) {
    const balance = await cooldown.balanceOf(token.address, $acc.toAddress(account));
    $require.eq(balance, requireAmount);
}
