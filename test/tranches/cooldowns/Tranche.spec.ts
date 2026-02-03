import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UAction } from 'atma-utest'
import { $usde } from '../utils/$usde';
import { $erc20 } from '../utils/$erc20';
import { $acc } from '../utils/$acc';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $require } from 'dequanto/utils/$require';
import { UnstakeCooldown } from '@0xc/hardhat/UnstakeCooldown/UnstakeCooldown';
import { $tranche } from '../utils/$tranche';
import { $hh } from '../utils/$hh';


let hh = new HardhatProvider();
let alice = await hh.deployer(1);

await $hh.test.deploy();

UAction.create({
    async $after () {
        await $hh.test.reset();
    },
    async 'deposit/withdraw sUSDe/USDe jrt/srt' () {

        let {
            jrtVault,
            srtVault,
            strategy,
            erc20Cooldown,
            unstakeCooldown,
            USDe,
            sUSDe,
        } = await $hh.test.factory.ensureDeployment();

        // Alice deposits into jrt and srt vaults
        await $usde.mint(USDe, alice, 1000.0);
        await $tranche.deposit(jrtVault, alice, USDe, 300.0);
        await $tranche.deposit(srtVault, alice, USDe, 300.0);

        await $erc20.eqBalance(USDe, alice, 400);


        // Alice withdraws sUSDe from jrt tokens with erc20 cooldown
        let sUSDeTokens = await strategy.convertToTokens(sUSDe.address, 150n * 10n**18n, 0);
        await $tranche.withdraw(jrtVault, alice, sUSDe, sUSDeTokens);
        // Alice withdraws USDe from srt tokens with unstake cooldown
        await $tranche.withdraw(srtVault, alice, USDe , 150.0);

        // Alice withdraws USDe from jrt
        await $hh.test.mine('2days');
        await $tranche.withdraw(jrtVault, alice, USDe, 100);

        await $hh.test.mine('5days');

        // Finalize erc20 cooldown
        await erc20Cooldown.$receipt().finalize(alice, sUSDe.address, alice.address);
        await $erc20.eqBalance(sUSDe, alice, 150.0);
        await $erc20.eqBalance(USDe, alice, 400, `No withdrawals for USDe, balance remains`);

        // Finalize 1. unstake cooldown from srt
        await unstakeCooldown.$receipt().finalize(alice, sUSDe.address, alice.address);
        await $erc20.eqBalance(USDe, alice, 550, `withdrawn 150 from srt after cooldown`);

        await $hh.test.mine('2days');
         // Finalize 2. unstake cooldown from jrt
        await unstakeCooldown.$receipt().finalize(alice, sUSDe.address, alice.address);
        await $erc20.eqBalance(USDe, alice, 650, `withdrawn 100 from srt after cooldown`);

        // Withdraw sUSDe from srt (no cooldown)
        await $erc20.eqBalance(sUSDe, alice, 150.0);
        await $tranche.withdraw(srtVault, alice, sUSDe, 100.0);
        await $erc20.eqBalance(sUSDe, alice, 250.0);

    },
})


async function transfer (cooldown: UnstakeCooldown, token: ERC20 | any, from: TEth.IAccount, to: $acc.Address, amount: bigint) {
    await token.$receipt().approve(from, cooldown.address, amount);
    await cooldown.$receipt().transfer(from, token.address, $acc.toAddress(to), amount);
}

async function finalize (cooldown: UnstakeCooldown, token: ERC20 | any, to: $acc.Address) {
    await cooldown.$receipt().finalize($hh.test.deployer,  token.address, $acc.toAddress(to));
}

async function eqBalanceOf(cooldown: UnstakeCooldown, token: ERC20 | any, account: $acc.Address, requireAmount: bigint) {
    const balance = await cooldown.balanceOf(token.address, $acc.toAddress(account));
    $require.eq(balance, requireAmount);
}
