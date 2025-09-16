import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { TranchesDeploy } from '../../../src/deployments/TranchesDeploy';
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
await $erc4626.deposit(sUSDe, alice, 1000.0);

let snapshotId;

UAction.create({
    async $before () {
        snapshotId = await client.debug.snapshot();
    },
    async $after () {
        await client.debug.revert(snapshotId);
    },
    async 'cooldown to self with 2 requests' () {

        let { unstakeCooldown } = await deploy.ensureCooldowns();

        await transfer(unstakeCooldown, sUSDe, alice, alice.address, 20n);

        await client.debug.mine(`2d`);
        await transfer(unstakeCooldown, sUSDe, alice, alice.address, 30n);


        // no transfers yet
        await $erc20.eqBalance(USDe, alice, 0n);

        // fail to withdraw
        try {
            await finalize(unstakeCooldown, sUSDe, alice);
            throw new Error(`Unreached`)
        } catch (error) {
            $require.notEq(error.message, 'Unreached');
        }

        // #1: 7days passed, withdraw 1. portion
        await client.debug.mine(`6days`);

        await finalize(unstakeCooldown, sUSDe, alice);
        await $erc20.eqBalance(USDe, alice, 20n);

        // No balance yet
        await eqBalanceOf(unstakeCooldown, sUSDe, alice, 0n);

        // #2: 9days passed, withdraw 2. portion
        await client.debug.mine(`3days`);
        await eqBalanceOf(unstakeCooldown, sUSDe, alice, 30n);
        await finalize(unstakeCooldown, sUSDe, alice);

        // Check USDe balance (after unstake)
        await $erc20.eqBalance(USDe, alice, 50n);
        await eqBalanceOf(unstakeCooldown, sUSDe, alice, 0n);
    },
})


async function transfer (cooldown: UnstakeCooldown, token: ERC20 | any, from: TEth.IAccount, to: $acc.Address, amount: bigint) {
    await token.$receipt().approve(from, cooldown.address, amount);
    await cooldown.$receipt().transfer(from, token.address, $acc.toAddress(to), amount);
}

async function finalize (cooldown: UnstakeCooldown, token: ERC20 | any, to: $acc.Address) {
    await cooldown.$receipt().finalize(deployer,  token.address, $acc.toAddress(to));
}

async function eqBalanceOf(cooldown: UnstakeCooldown, token: ERC20 | any, account: $acc.Address, requireAmount: bigint) {
    const balance = await cooldown.balanceOf(token.address, $acc.toAddress(account));
    $require.eq(balance, requireAmount);
}
