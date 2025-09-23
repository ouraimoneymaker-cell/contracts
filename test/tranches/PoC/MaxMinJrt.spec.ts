import { UTest } from 'atma-utest'
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';
import { $erc4626 } from '../utils/$erc4626';
import { $erc20 } from '../utils/$erc20';
import { $bigint } from 'dequanto/utils/$bigint';


await $hh.test.deploy();

UTest.create({
    async $after () {
        await $hh.test.reset();
    },

    async 'mint 1K with jrtVault, and make the share price < 1, maxMint should handle it' () {
        let { deployer } = $hh.test;
        let { USDe, jrtVault, accounting } = $hh.test.tranches;
        await $erc20.mint(USDe, deployer, deployer.address, 1000);
        await $erc4626.deposit(jrtVault, deployer, '100%');

        const AMOUNT = 10n**21n;
        $require.eq(await accounting.jrtNav(), AMOUNT);
        $require.eq(await jrtVault.maxMint(deployer.address), $bigint.MAX_UINT256);

        // simulate loss, transfer 50% to srt
        await accounting.storage.$set('jrtNav', AMOUNT / 2n);
        await accounting.storage.$set('srtNav', AMOUNT / 2n);
        $require.eq(await jrtVault.totalAssets(), AMOUNT / 2n);
        $require.eq(await jrtVault.maxMint(deployer.address), $bigint.MAX_UINT256);
    }
});
