import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UTest } from 'atma-utest'
import { $erc20 } from '../utils/$erc20';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';

import { $promise } from 'dequanto/utils/$promise';
import { l } from 'dequanto/utils/$logger';
import { $erc4626 } from '../utils/$erc4626';
import { $exitMode } from '@s/utils/$exitMode';
import { $address } from 'dequanto/utils/$address';
import { TEth } from 'dequanto/models/TEth';

const hh = new HardhatProvider();
const alice = await hh.deployer(1);
const bob = await hh.deployer(2);
const test = await $hh.create('mhyper');

const {
    mHYPER,
    USDC,
    oracle,
    jrtVault,
    feed,
    redemptionVault,
    cdo,
} = await test.deploy();

const { client, deployer } = test;
const { sharesCooldown, unstakeCooldown } = await test.factory.ensureCooldowns(cdo);

UTest.create({
    async $before () {
        await test.factory.addRoles({
            [alice.address]: [
                await sharesCooldown.COOLDOWN_WORKER_ROLE(),
            ],
            [cdo.address]: [
                await sharesCooldown.COOLDOWN_WORKER_ROLE(),
            ]
        });
        await feed.$receipt().setRoundStaleAfter(deployer, BigInt($date.parseTimespan('5years', { get:'s' })));
        await oracle.$receipt().setRoundData(deployer, 1n, BigInt(1e8), BigInt($date.toUnixTimestamp()));
        await sharesCooldown.$receipt().setTwoStepConfigManager(test.deployer, alice.address);

        const t = (await client.getBlock('latest')).timestamp;
        await feed.$receipt().updateRoundData(deployer, 0, 0, t);
        await redemptionVault.$receipt().setOracle(deployer, oracle.address);

        await $erc4626.deposit(jrtVault, alice, 1000.0);

        await $exitMode.set(sharesCooldown, alice, jrtVault.address, [
            { covPct: 100, lock: 60 }
        ]);
        await test.snapshot('midas');
    },
    async $teardown() {
        await test.client.debug.setAutomine(true);
        await test.reset('midas');
    },
    async $after() {
        await test.wipe();
    },

    async 'finalize' () {
        return UTest.create({
            async $before () {
                await $erc4626.deposit(jrtVault, bob, 1000);

                l`bob creates 2 requests with different tokens`;
                await $erc4626.redeemMeta(jrtVault, USDC.address, bob, 500);
                await $erc4626.redeemMeta(jrtVault, mHYPER.address, bob, 500);
                await $erc20.eqBalance(USDC, bob, 0);
                await $erc20.eqBalance(mHYPER, bob, 0);

                await test.mine(`8days`);
                await test.snapshot('finalize');
            },
            async $teardown () {
                await test.reset('finalize');
            },
            async 'alice finalizes all requests' () {
                await sharesCooldown.$receipt().finalize(alice,  jrtVault.address, bob.address);
                l`bob receives as requested 500 USDC and 500 mHYPER`;
                await $erc20.eqBalance(mHYPER, bob, 500);
                await finalizeRedeemRequest(bob);
                await $erc20.eqBalance(USDC, bob, 500);
            },
            async 'alice finalizes single token: USDC' () {
                await sharesCooldown.$receipt().finalize(alice,  jrtVault.address, USDC.address, bob.address);
                await $erc20.eqBalance(mHYPER, bob, 0);
                await finalizeRedeemRequest(bob);
                await $erc20.eqBalance(USDC, bob, 500);
            },
            async 'alice finalizes all requests (with zero Meta token)' () {
                await sharesCooldown.$receipt().finalize(alice,  jrtVault.address, $address.ZERO, bob.address);
                await $erc20.eqBalance(mHYPER, bob, 500);
                await finalizeRedeemRequest(bob);
                await $erc20.eqBalance(USDC, bob, 500);
            },
            async 'alice fails to finalize with override' () {
                let { error } = await $promise.caught(
                    sharesCooldown.$receipt().finalizeWithTokenOverride(alice,  jrtVault.address, USDC.address, bob.address)
                );
                $require.match(/SharesOwner/, error.message);
            },
            async 'bob finalizes all requests' () {
                await sharesCooldown.$receipt().finalize(bob,  jrtVault.address, bob.address);
                l`bob receives as requeste 500 USDC and 500 mHYPER`;
                await $erc20.eqBalance(mHYPER, bob, 500);
                await finalizeRedeemRequest(bob);
                await $erc20.eqBalance(USDC, bob, 500);
            },
            async 'bob finalizes single token: USDC' () {
                await sharesCooldown.$receipt().finalize(bob,  jrtVault.address, USDC.address, bob.address);
                await $erc20.eqBalance(mHYPER, bob, 0);
                await finalizeRedeemRequest(bob);
                await $erc20.eqBalance(USDC, bob, 500);
            },
            async 'bob finalizes with token override: USDC' () {
                await sharesCooldown.$receipt().finalizeWithTokenOverride(bob,  jrtVault.address, USDC.address, bob.address)
                await $erc20.eqBalance(mHYPER, bob, 0);
                await finalizeRedeemRequest(bob);
                await $erc20.eqBalance(USDC, bob, 1000);
            },
            async 'bob finalizes with token override: mHYPER' () {
                await sharesCooldown.$receipt().finalizeWithTokenOverride(bob,  jrtVault.address, mHYPER.address, bob.address)
                await $erc20.eqBalance(mHYPER, bob, 1000);
                await $erc20.eqBalance(USDC, bob, 0);
            },

        });
    }

})


async function finalizeRedeemRequest (account: TEth.IAccount) {
    await test.mine('3days');
    const requestId = await redemptionVault.nextRequestId();
    await redemptionVault.$receipt().fulfillRequest(deployer, requestId - 1n);
    await unstakeCooldown.$receipt().finalize(account, mHYPER.address, account.address);
}
