import { UAction } from 'atma-utest'
import { $erc4626 } from './utils/$erc4626';
import { $hh } from './utils/$hh';
import { $address } from 'dequanto/utils/$address';
import { $bigint } from 'dequanto/utils/$bigint';
import { $erc20 } from './utils/$erc20';
import { l } from 'dequanto/utils/$logger';
import { TrancheDepositor } from '@0xc/hardhat/TrancheDepositor/TrancheDepositor';
import { Tranche } from '@0xc/hardhat/Tranche/Tranche';
import { TEth } from 'dequanto/models/TEth';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { ERC20Permit } from 'dequanto/prebuilt/openzeppelin/ERC20Permit';
import { $date } from 'dequanto/utils/$date';
import { $signSerializer } from 'dequanto/utils/$signSerializer';
import { $sig } from 'dequanto/utils/$sig';
import { $promise } from 'dequanto/utils/$promise';
import { $require } from 'dequanto/utils/$require';

await $hh.test.deploy();

UAction.create({
    async $before () {

    },
    async $teardown () {
        await $hh.test.reset();
    },

    async 'deposit Meta: USDe/sUSDe' () {
        let { jrtVault, srtVault, USDe, sUSDe} = $hh.test.tranches;
        let { depositor, deployer } = $hh.test;

        let amount = $bigint.toWei(42);
        await $erc20.mint(USDe, deployer, deployer, amount * 4n);
        await $erc4626.deposit(sUSDe, deployer, amount * 2n);

        l`jrtVault deposit USDe`;
        await $helper.deposit(depositor, jrtVault, deployer, USDe, amount);
        await $erc20.eqBalance(jrtVault, deployer, amount);

        l`srtVault deposit USDe`;
        await $helper.deposit(depositor, srtVault, deployer, USDe, amount);
        await $erc20.eqBalance(srtVault, deployer, amount);

        l`jrtVault deposit sUSDe`;
        await $helper.deposit(depositor, jrtVault, deployer, sUSDe, amount);
        await $erc20.eqBalance(jrtVault, deployer, amount * 2n);

        l`srtVault deposit sUSDe`;
        await $helper.deposit(depositor, srtVault, deployer, sUSDe, amount);
        await $erc20.eqBalance(srtVault, deployer, amount * 2n);
    },
    async 'deposit via ERC4626 withdrawal' () {
        let { jrtVault, srtVault,  USDe, sUSDe, pUSDe, acm } = $hh.test.tranches;
        let { depositor, deployer } = $hh.test;

        let amount = $bigint.toWei(42);
        await $erc20.mint(USDe, deployer, deployer, amount * 2n);
        await $erc4626.deposit(pUSDe, deployer, amount * 2n);

        l`jrtVault deposit pUSDe`;
        await $helper.deposit(depositor, jrtVault, deployer, pUSDe, amount);
        await $erc20.eqBalance(jrtVault, deployer, amount);

        l`srtVault deposit pUSDe`;
        await $helper.deposit(depositor, srtVault, deployer, pUSDe, amount);
        await $erc20.eqBalance(srtVault, deployer, amount);
    },
    async 'deposit with Permit' () {
        let { jrtVault, srtVault, USDe, sUSDe} = $hh.test.tranches;
        let { depositor, deployer } = $hh.test;

        let amount = $bigint.toWei(42);
        await $erc20.mint(USDe, deployer, deployer, amount * 4n);
        await $erc4626.deposit(sUSDe, deployer, amount * 2n);


        l`jrtVault deposit sUSDe with Permit`;
        junior: {
            let { deadline, v, r, s } = await $helper.createPermit(
                sUSDe as any as ERC20Permit,
                deployer as TEth.EoAccount,
                depositor,
                amount
            );
            await depositor.$receipt().depositWithPermit(
                deployer,
                jrtVault.address,
                sUSDe.address,
                amount,
                deployer.address,
                {
                    minShares: 0n,
                    swapAmountOutMinimum: 0n,
                    swapDeadline: 0n,
                    swapTokenOut: $address.ZERO
                },
                BigInt(deadline),
                Number(v),
                r,
                s,
            );
            await $erc20.eqBalance(jrtVault, deployer, amount);
        }


        l`srtVault deposit sUSDe with Permit`;
        senior: {
            let { deadline, v, r, s } = await $helper.createPermit(
                sUSDe as any as ERC20Permit,
                deployer as TEth.EoAccount,
                depositor,
                amount
            );
            await depositor.$receipt().depositWithPermit(
                deployer,
                srtVault.address,
                sUSDe.address,
                amount,
                deployer.address,
                {
                    minShares: 0n,
                    swapAmountOutMinimum: 0n,
                    swapDeadline: 0n,
                    swapTokenOut: $address.ZERO
                },
                BigInt(deadline),
                Number(v),
                r,
                s,
            );
            await $erc20.eqBalance(srtVault, deployer, amount);
        }
    },
    async 'revert on minShares' () {
        let { jrtVault, srtVault,  USDe, sUSDe, pUSDe, acm } = $hh.test.tranches;
        let { depositor, deployer } = $hh.test;

        let amount = $bigint.toWei(42);
        await $erc20.mint(USDe, deployer, deployer, amount * 2n);
        await $erc4626.deposit(pUSDe, deployer, amount * 2n);

        l`jrtVault deposit pUSDe`;
        let { error } = await $promise.caught(() => {
            return $helper.deposit(depositor, jrtVault, deployer, pUSDe, amount, { minShares: amount + 1n })
        });
        $require.match(/MintedSharesBelowMin/, error?.message);
    },
    async 'deposit with wrong permit, but existing allowance' () {
        let { jrtVault, srtVault, USDe, sUSDe} = $hh.test.tranches;
        let { depositor } = $hh.test;
        let alice = await $hh.test.createAccount('permit-alice');

        let amount = $bigint.toWei(42);
        await $erc20.mint(USDe, alice, alice, amount * 4n);
        await $erc4626.deposit(sUSDe, alice, amount * 2n);

        await sUSDe.$receipt().approve(alice, depositor.address, amount);

        let { deadline, v, r, s } = await $helper.createPermit(
            sUSDe as any as ERC20Permit,
            alice as TEth.EoAccount,
            depositor,
            amount,
            $date.toUnixTimestamp($date.additive(new Date(), '-1day'))
        );
        await depositor.$receipt().depositWithPermit(
            alice,
            jrtVault.address,
            sUSDe.address,
            amount,
            alice.address,
            {
                minShares: 0n,
                swapAmountOutMinimum: 0n,
                swapDeadline: 0n,
                swapTokenOut: $address.ZERO
            },
            BigInt(deadline),
            Number(v),
            r,
            s,
        );
        await $erc20.eqBalance(jrtVault, alice, amount);

    },
})

namespace $helper {

    export async function createPermit (
        erc20Permit: ERC20Permit,
        owner: TEth.EoAccount,
        depositor: TrancheDepositor,
        amount: bigint,
        deadline?: number
    ) {
        const nonce = await erc20Permit.nonces(owner.address);
        deadline ??= $date.tool().add('1year').toUnixTimestamp();

        let typedData = {
            types: {
                EIP712Domain: [
                    { name: 'name', type: 'string' },
                    { name: 'version', type: 'string' },
                    { name: 'chainId', type: 'uint256' },
                    { name: 'verifyingContract', type: 'address' },
                ],
                Permit: [
                    { type: 'address', name: 'owner' },
                    { type: 'address', name: 'spender' },
                    { type: 'uint256', name: 'value' },
                    { type: 'uint256', name: 'nonce' },
                    { type: 'uint256', name: 'deadline' },
                ],
            },
            primaryType: 'Permit',
            domain: {
                name: (await erc20Permit.eip712Domain()).name,
                version: '1',
                chainId: $hh.test.client.chainId,
                verifyingContract: erc20Permit.address,
            },
            message: {
                owner: owner.address,
                spender: depositor.address,
                value: amount,
                nonce: nonce,
                deadline: deadline
            }
        };

        let hashed = $signSerializer.serializeTypedData(typedData);
        let { v, r, s } = await $sig.sign(hashed, owner);
        return { v, r, s, deadline };
    }


    export async function deposit (
        depositor: TrancheDepositor,
        vault: Tranche,
        sender: TEth.IAccount,
        token: ERC20 | any,
        amount: bigint,
        params?: { minShares?: bigint }
    ) {
        await token.$receipt().approve(sender, depositor.address, amount);
        await depositor.$receipt().deposit(sender, vault.address, token.address, amount, sender.address, {
            minShares: params?.minShares ?? 0n,
            swapAmountOutMinimum: 0n,
            swapDeadline: 0n,
            swapTokenOut: $address.ZERO
        });
    }
}
