import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { UAction } from 'atma-utest'
import { $erc20 } from '../utils/$erc20';
import { $acc } from '../utils/$acc';
import { TEth } from 'dequanto/models/TEth';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { $testCooldown } from './$testCooldown';
import { $promise } from 'dequanto/utils/$promise';
import { l } from 'dequanto/utils/$logger';
import { $erc4626 } from '../utils/$erc4626';
import { SharesCooldown } from '@0xc/hardhat/SharesCooldown/SharesCooldown';
import { ERC4626 } from 'dequanto/prebuilt/openzeppelin/ERC4626';
import { MockERC4626 } from '@0xc/hardhat/MockERC4626/MockERC4626';
import { $exitMode } from '@s/utils/$exitMode';
import { MockMetaERC4626 } from '@0xc/hardhat/MockMetaERC4626/MockMetaERC4626';
import { $ethena } from '../utils/$ethena';
import { $address } from 'dequanto/utils/$address';


const _7DAYS = BigInt(7 * 24 * 60 * 60);

let hh = new HardhatProvider();
let alice = await hh.deployer(1);
let bob = await hh.deployer(2);

let {
    jrtVault,
    srtVault,
    cdo,
} = await $hh.test.deploy();

let { USDe, sUSDe } = await $hh.test.factory.ensureUnderlying();
let { contract: Vault } = await $hh.test.factory.ds.ensure(MockMetaERC4626, {
    arguments: [ USDe.address ]
});
let { sharesCooldown, acm } = await $hh.test.factory.ensureCooldowns(cdo);
let { strategy } = $hh.test.tranches;
let { deployer } = $hh.test;

UAction.create({
    async $before () {
        await $hh.test.factory.addRoles({
            [alice.address]: [
                await sharesCooldown.COOLDOWN_WORKER_ROLE(),
            ],
            [cdo.address]: [
                await sharesCooldown.COOLDOWN_WORKER_ROLE(),
            ]
        });
        await sharesCooldown.$receipt().setTwoStepConfigManager($hh.test.deployer, alice.address);
        await $erc4626.deposit(Vault, alice, 1000.0);
        await $erc4626.deposit(jrtVault, alice, 1000.0);
        await $exitMode.set(sharesCooldown, alice, Vault.address, [
            { covPct: 100, lock: 60 }
        ]);
        await $exitMode.set(sharesCooldown, alice, jrtVault.address, [
            { covPct: 100, lock: 60 }
        ]);
        await $ethena.setCooldownDuration(sUSDe, deployer, 0);
        await $hh.test.snapshot('sharesCooldown');
    },
    async $teardown() {
        await $hh.test.client.debug.setAutomine(true);
        await $hh.test.reset('sharesCooldown');
    },
    async $after() {
        await $hh.test.reset();
    },
    async 'requestRedeem'() {

        await requestRedeem(sharesCooldown, Vault, USDe.address, alice, bob, BigInt(2e18), '60s');
        await $erc20.eqBalance(Vault, alice, 998.0);
        await requestRedeem(sharesCooldown, Vault, USDe.address, alice, bob, BigInt(3e18), '120s');
        await $erc20.eqBalance(Vault, alice, 995.0);

        await $hh.test.mine(`30s`);

        // no transfers yet
        await $erc20.eqBalance(Vault, bob, 0n);
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, {
            pending: BigInt(5e18),
            nextUnlockAmount: BigInt(2e18)
        });

        // fail to withdraw
        const { error } = await $promise.caught($testCooldown.finalize(sharesCooldown, Vault, bob));
        $require.match(/NothingToFinalize/, error.message);

        // #1: 60s passed, withdraw 1. portion
        await $hh.test.mine(`51s`);
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, {
            pending: BigInt(3e18),
            claimable: BigInt(2e18),
            nextUnlockAmount: BigInt(3e18)
        });
        await $testCooldown.finalize(sharesCooldown, Vault, bob);
        await $erc20.eqBalance(USDe, bob, BigInt(2e18));

        // No balance yet
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, {
            pending: BigInt(3e18),
            claimable: 0n,
            nextUnlockAmount: BigInt(3e18)
        });

        // #2: 120s passed, withdraw 2. portion
        await $hh.test.mine(`61s`);
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, { pending: 0n, claimable: BigInt(3e18), nextUnlockAmount: 0n });
        await $testCooldown.finalize(sharesCooldown, Vault, bob);
        await $erc20.eqBalance(USDe, bob, BigInt(5e18));
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, { pending: 0n, claimable: 0n, nextUnlockAmount: 0n });
    },
    async 'emergency disable'() {
        await requestRedeem(sharesCooldown, Vault, USDe.address, alice, bob.address, 21n, '7days');
        let result = await $promise.caught($testCooldown.finalize(sharesCooldown, Vault, bob.address));
        $require.match(/NothingToFinalize/, result.error?.message);


        await $exitMode.set(sharesCooldown, alice, Vault.address, []);
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, { pending: 0n, claimable: 21n, nextUnlockAmount: 0n, nextUnlockAt: 0n });
        await $testCooldown.finalize(sharesCooldown, Vault, bob.address);
        await $erc20.eqBalance(USDe, bob, 21n);
    },
    async 'ensure unstake request is reused within single block'() {

        await Vault.$receipt().transfer(alice, sharesCooldown.address, 50n);

        await $hh.test.client.debug.setAutomine(false);
        await $promise.wait(200);
        let tx1 = await sharesCooldown.requestRedeem(alice, Vault.address, USDe.address, alice.address, bob.address, 23n, 0n, 60);
        let tx2 = await sharesCooldown.requestRedeem(alice, Vault.address, USDe.address, alice.address, bob.address, 27n, 0n, 60);
        await $promise.wait(200);
        await $hh.test.client.debug.setAutomine(true);
        await $hh.test.client.debug.mine(1);

        let [ r1, r2 ] = await Promise.all([
            tx1.wait(),
            tx2.wait()
        ]);


        l`1 request only, as 2 requests were made in the same block`;
        $require.eq(r1.blockNumber, r2.blockNumber, 'different blocks');

        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, {
            pending: 50n,
            nextUnlockAmount: 50n,
            totalRequests: 1n
        });

        await $hh.test.mine(`7days`);
        await $testCooldown.finalize(sharesCooldown, Vault, bob.address);
        await $erc20.eqBalance(USDe, bob, 50n);
    },
    async 'max active requests'() {
        await Vault.$receipt().transfer(alice, sharesCooldown.address, 80n);

        const MAX = $hh.isCoverage() ? 2 : 71;
        for (let i = 0; i < MAX; i++) {
            await sharesCooldown.$receipt().requestRedeem(alice, Vault.address, USDe.address, bob.address, bob.address, 1n, 0n, 7 * 24 * 60 * 60);
        }
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, {
            pending: BigInt(MAX),
            nextUnlockAmount: 1n,
            totalRequests: BigInt(Math.min(MAX, 70))
        });
        await $hh.test.mine(`8days`);
        await $testCooldown.finalize(sharesCooldown, Vault, bob.address);
        await $erc20.eqBalance(USDe, bob, BigInt(MAX));
    },
    async 'max external requests'() {
        await Vault.$receipt().transfer(alice, sharesCooldown.address, 80n);

        const MAX =  $hh.isCoverage() ? 2 : 40;
        const _7d = 7 * 24 * 60 * 60;
        for (let i = 0; i < MAX; i++) {
            await sharesCooldown.$receipt().requestRedeem(alice, Vault.address, USDe.address, alice.address, bob.address, 1n, 0n, _7d );
        }
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, {
            pending: 40n,
            nextUnlockAmount: 1n,
            totalRequests: 40n
        });

        let result = await $promise.caught(() => {
            return sharesCooldown.$receipt().requestRedeem(alice, Vault.address, USDe.address, alice.address, bob.address, 1n, 0n, _7d);
        });
        $require.match(/ExternalReceiverRequestLimitReached/, result.error?.message);

        await sharesCooldown.$receipt().requestRedeem(alice, Vault.address, USDe.address, bob.address, bob.address, 5n, 0n, _7d);
        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, {
            pending: 45n,
            nextUnlockAmount: 1n,
            totalRequests: 41n
        });

        await $hh.test.mine(`8days`);
        await $testCooldown.finalize(sharesCooldown, Vault, bob.address);
        await $erc20.eqBalance(USDe, bob, 45n);
    },
    async 'cancel request' () {
        await requestRedeem(sharesCooldown, Vault, USDe.address, alice, bob, BigInt(2e18), '60s');

        let { error } = await $promise.caught(sharesCooldown.$receipt().cancel(alice, Vault.address, bob.address, 0n, { shares: 0n }));
        $require.match(/OnlySharesOwner/, error.message);

        await $erc20.eqBalance(Vault, bob, 0);

        let { error: errorShares } = await $promise.caught(sharesCooldown.$receipt().cancel(bob, Vault.address, bob.address, 0n, { shares: BigInt(1e18) }));
        $require.match(/UnexpectedShares/, errorShares.message);

        await sharesCooldown.$receipt().cancel(bob, Vault.address, bob.address, 0n, { shares: BigInt(2e18) });
        await $erc20.eqBalance(Vault, bob, 2.0);

        await $testCooldown.eqBalanceOf(sharesCooldown, Vault, bob, {
            totalRequests: 0n
        });
    },
    async 'configure via TwoStepConfigManager' () {
        let { configManager } = await $hh.test.factory.ensureConfigManager();
        let { client, deployer } = $hh.test;

        await sharesCooldown.$receipt().setTwoStepConfigManager(deployer, configManager.address);

        await $exitMode.propose(deployer, configManager,
            [
                { covPct: .5, feePct: 1,  lock: $date.parseTimespan('2days', { get: 's' })  },
                { covPct: 2.3, feePct: 0.5,   lock: $date.parseTimespan('8hours', { get: 's' })  },
                { covPct: 0, feePct: 0.03, lock: 0  },
            ],
            [
                { covPct: 2, feePct: 1,  lock: $date.parseTimespan('3day', { get: 's' })  },
                { covPct: 40, feePct: 0.7,   lock: $date.parseTimespan('7hours', { get: 's' })  },
                { covPct: 0, feePct: 0.15, lock: 0  },
            ]
        );
        await client.debug.mine('2days');
        await $exitMode.execute(deployer, configManager);

        let jrt = await sharesCooldown.vaultExitBounds(jrtVault.address);
        $require.eq(jrt.p0, 0.005e6);
        $require.eq(jrt.p1, 0.023e6);
        $require.eq(jrt.r0.feePpm, 0.01e6);
        $require.eq(jrt.r0.sharesLock, 2 * 24 * 60 * 60);
        $require.eq(jrt.r1.feePpm, 0.005e6);
        $require.eq(jrt.r1.sharesLock, 8 * 60 * 60);
        $require.eq(jrt.r2.feePpm, 0.0003e6);

        let srt = await sharesCooldown.vaultExitBounds(srtVault.address);
        $require.eq(srt.p0, 0.02e6);
        $require.eq(srt.p1, 0.4e6);
        $require.eq(srt.r0.feePpm, 0.01e6);
        $require.eq(srt.r0.sharesLock, 3 * 24 * 60 * 60);
        $require.eq(srt.r1.feePpm, 0.007e6);
        $require.eq(srt.r1.sharesLock, 7 * 60 * 60);
        $require.eq(srt.r2.feePpm, 0.0015e6);


        l`should cancel`;
        await $exitMode.propose(deployer, configManager,
            [
                { covPct: .5, feePct: 1.1,  lock: $date.parseTimespan('2days', { get: 's' })  },
                { covPct: 2.3, feePct: 3,   lock: $date.parseTimespan('8hours', { get: 's' })  },
                { covPct: 0, feePct: 0.3, lock: 0  },
            ],
            [
                { covPct: 2, feePct: 1,  lock: $date.parseTimespan('3day', { get: 's' })  },
                { covPct: 40, feePct: 3,   lock: $date.parseTimespan('7hours', { get: 's' })  },
                { covPct: 0, feePct: 1.5, lock: 0  },
            ]
        );

        let pending = await configManager.pendingExitModeBoundsJrt();
        $require.eq(pending.bounds.p0, 0.005e6);

        await configManager.$receipt().cancelExitModeBoundsChange(deployer);
        pending = await configManager.pendingExitModeBoundsJrt();
        $require.eq(pending.bounds.p0, 0);
    },

    async 'finalize' () {
        return UAction.create({
            async $before () {
                await $erc4626.deposit(jrtVault, bob, 1000);

                l`bob creates 2 requests with different tokens`;
                await $erc4626.redeemMeta(jrtVault, USDe.address, bob, 500);
                await $erc4626.redeemMeta(jrtVault, sUSDe.address, bob, 500);
                await $erc20.eqBalance(USDe, bob, 0);
                await $erc20.eqBalance(sUSDe, bob, 0);

                await $hh.test.mine(`8days`);
                await $hh.test.snapshot('finalize');
            },
            async $teardown () {
                await $hh.test.reset('finalize');
            },
            async 'alice finalizes all requests' () {
                await sharesCooldown.$receipt().finalize(alice,  jrtVault.address, bob.address);
                l`bob receives as requeste 500 USDe and 500 SUSDe`;
                await $erc20.eqBalance(USDe, bob, 500);
                await $erc20.eqBalance(sUSDe, bob, 500);
            },
            async 'alice finalizes single token: USDe' () {
                await sharesCooldown.$receipt().finalize(alice,  jrtVault.address, USDe.address, bob.address);
                await $erc20.eqBalance(USDe, bob, 500);
                await $erc20.eqBalance(sUSDe, bob, 0);
            },
            async 'alice finalizes all requests (with zero Meta token)' () {
                await sharesCooldown.$receipt().finalize(alice,  jrtVault.address, $address.ZERO, bob.address);
                await $erc20.eqBalance(USDe, bob, 500);
                await $erc20.eqBalance(sUSDe, bob, 500);
            },
            async 'alice fails to finalize with override' () {
                let { error } = await $promise.caught(
                    sharesCooldown.$receipt().finalizeWithTokenOverride(alice,  jrtVault.address, USDe.address, bob.address)
                );
                $require.match(/SharesOwner/, error.message);
            },
            async 'bob finalizes all requests' () {
                await sharesCooldown.$receipt().finalize(bob,  jrtVault.address, bob.address);
                l`bob receives as requeste 500 USDe and 500 SUSDe`;
                await $erc20.eqBalance(USDe, bob, 500);
                await $erc20.eqBalance(sUSDe, bob, 500);
            },
            async 'bob finalizes single token: USDe' () {
                await sharesCooldown.$receipt().finalize(bob,  jrtVault.address, USDe.address, bob.address);
                await $erc20.eqBalance(USDe, bob, 500);
                await $erc20.eqBalance(sUSDe, bob, 0);
            },
            async 'bob finalizes with token override: USDe' () {
                await sharesCooldown.$receipt().finalizeWithTokenOverride(bob,  jrtVault.address, USDe.address, bob.address)
                await $erc20.eqBalance(USDe, bob, 1000);
                await $erc20.eqBalance(sUSDe, bob, 0);
            },
            async 'bob finalizes with token override: sUSDe' () {
                await sharesCooldown.$receipt().finalizeWithTokenOverride(bob,  jrtVault.address, sUSDe.address, bob.address)
                await $erc20.eqBalance(USDe, bob, 0);
                await $erc20.eqBalance(sUSDe, bob, 1000);
            },

        });
    }

})


async function requestRedeem(cooldown: SharesCooldown, token: ERC4626 | any, asset: TEth.Address, from: TEth.IAccount, to: $acc.Address, amount: bigint, timespan: string) {
    let cooldownSeconds = Math.floor($date.parseTimespan(timespan) / 1000);
    await token.$receipt().transfer(from, cooldown.address, amount);
    await cooldown.$receipt().requestRedeem(from, token.address, asset, from.address, $acc.toAddress(to), amount, 0n, cooldownSeconds);
}
