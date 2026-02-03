import { UAction } from 'atma-utest'
import { $hh } from '../utils/$hh';
import { Addresses } from '@s/constants';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { TEth } from 'dequanto/models/TEth';
import { $address } from 'dequanto/utils/$address';
import { $erc20 } from '../utils/$erc20';


const test = $hh.create('neutrl', { forked: 24375510 });


UAction.create({
    async $before() {
       await test.deploy();
       await test.snapshot('neutrl');
    },
    async $after() {
        await $hh.reset(test.client);
    },
    async $teardown () {
        await test.reset('neutrl')
    },
    async 'should deposit USDC'() {
        const testOwner = {
            type: 'impersonated',
            address: `0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c`
        } as TEth.EoAccount;
        const USDC = new ERC20(Addresses.eth.USDC, test.client);

        const depositor = test.depositor;
        const jrtVault = test.tranches.jrtVault;
        const amount = BigInt(10e6);
        await USDC.$receipt().approve(testOwner, depositor.address, amount);
        await depositor.$receipt().deposit(testOwner, jrtVault.address, USDC.address, amount, testOwner.address, {
            minShares: 0n,
            swapAmountOutMinimum: 0n,
            swapDeadline: 0n,
            swapTokenOut: $address.ZERO
        });

        await $erc20.eqBalanceDiff(jrtVault, testOwner, BigInt(10e18), BigInt(1e18));
    },

});
