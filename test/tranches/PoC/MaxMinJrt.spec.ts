import { UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { $erc4626 } from '../utils/$erc4626';
import { $erc20 } from '../utils/$erc20';
import { $bigint } from 'dequanto/utils/$bigint';
import { $date } from 'dequanto/utils/$date';

const test = await $hh.deploy('ethena', {
    cdoInfo: {
        ContractVersions: { accounting: 'discrete' }
    },
    fresh: true,
});

UTest.create({
    async $after () {
        await test.wipe();
    },

    async $teardown () {
        await test.reset();
    },

    async 'mint 1K with jrtVault, and make the share price < 1, maxMint should handle it' () {
        let { deployer } = test;
        let { USDe, jrtVault, accounting } = test.tranches;
        await $erc20.mint(USDe, deployer, deployer.address, 1000);
        await $erc4626.deposit(jrtVault, deployer, '100%');

        const AMOUNT = 10n**21n;
        $require.eq(await accounting.jrtNav(), AMOUNT);
        $require.eq(await jrtVault.maxMint(deployer.address), $bigint.MAX_UINT256);

        // simulate loss, transfer 50% to srt
        await accounting.storage.$set('jrtBaseNav', AMOUNT / 2n);
        await accounting.storage.$set('jrtNavProjected', AMOUNT / 2n);
        await accounting.storage.$set('srtBaseNav', AMOUNT / 2n);

        $require.eq(await jrtVault.totalAssets(), AMOUNT / 2n);
        $require.eq(await jrtVault.maxMint(deployer.address), $bigint.MAX_UINT256);
    },

    async 'Senior yield should be effectively stopped whenever Junior Assets are $1' () {
        let { deployer, client } = test;
        let { USDe, cdo, sUSDe, jrtVault, srtVault, accounting, feed, strategy } = test.tranches;
        await $erc20.mint(USDe, deployer, deployer.address, 1000);


        await feed.$receipt().setRoundStaleAfter(deployer, BigInt(356 * 24 * 60 * 60));
        await feed.$receipt().updateRoundData(deployer, 2e12, 1e12, $date.toUnixTimestamp());

        await $erc4626.deposit(jrtVault, deployer, 1);
        await $erc4626.deposit(srtVault, deployer, 11);

        await client.debug.mine('3month');

        $require.gt(await jrtVault.totalAssets(), BigInt(1e18), `Junior yield continues`);
        $require.eq(await accounting.jrtBaseNav(), BigInt(1e18), `Juniors asset remain at $1`);
        $require.eq(await srtVault.totalAssets(), BigInt(11e18), `Senior gained no yield, as not possible to cover by Junior`);

        await srtVault.$receipt().redeem(
            deployer,
            BigInt(1e18),
            deployer.address,
            deployer.address
        );

        await $erc4626.deposit(sUSDe, deployer, 1);
        // Distribute 1wei to trigger the true-up
        await sUSDe.$receipt().transfer(deployer, strategy.address, 1n);

        $require.eq(await jrtVault.totalAssets(), BigInt(1e18), `Junior projection dropped to real $1`);
        $require.eq(await accounting.jrtBaseNav(), BigInt(1e18), `Junior assets remain at $1`);
        $require.eq(
            await srtVault.totalAssets(),
            // initial value
            BigInt(11e18)
            // minus redemption
            - BigInt(1e18)
            // plus yield
            + 1n,
            `Senior received the 1wei yield`
        );
    },
});
