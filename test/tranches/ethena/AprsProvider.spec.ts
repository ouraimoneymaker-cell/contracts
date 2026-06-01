import { UTest } from 'atma-utest';
import { $hh } from '../utils/$hh';
import { Addresses } from '@s/constants';
import { $bigint } from 'dequanto/utils/$bigint';
import { Web3Client } from 'dequanto/clients/Web3Client';
import { IsUSDe } from '@0xc/hardhat/IsUSDe/IsUSDe';
import { $date } from 'dequanto/utils/$date';
import { l } from 'dequanto/utils/$logger';
import { BlockDateResolver } from 'dequanto/blocks/BlockDateResolver';
import { SUSDeAprPairProvider } from '@0xc/hardhat/sUSDeAprPairProvider/sUSDeAprPairProvider';
import { $erc4626 } from '../utils/$erc4626';


await $hh.test.deploy();

UTest.create({
    async $before () {

    },
    async $after () {
        await $hh.test.reset();
    },

    async 'aprs' () {
        let { factory, deployer } = $hh.test
        let { sUSDS, sUSDe, USDe } = await factory.ensureUnderlying();

        await sUSDS.$receipt().setSsr(deployer, 1000000001471536429740616381n);
        await USDe.$receipt().mint(deployer, deployer.address, 1000n * 10n**18n);
        await $erc4626.deposit(sUSDe, deployer, '50%');

        await USDe.$receipt().approve(deployer, sUSDe.address, $bigint.MAX_UINT256);
        await sUSDe.$receipt().transferInRewards(deployer, 10n * 10n**18n)

        let { contract: provider } = await factory.ds.ensure(SUSDeAprPairProvider, {
            arguments:[
                sUSDS.address,
                sUSDe.address,
            ]
        });

        let APRbase = $bigint.toEther(await provider.getAPRbase(), 12);
        let APRtarget = $bigint.toEther(await provider.getAPRtarget(), 12);
        eq_(APRtarget, 0.0464);
        eq_(APRbase, 21.9);

    },
})


async function unvestedAmount (client: Web3Client, blockNr: number) {
    let sUSDe = new IsUSDe(Addresses.eth.sUSDe, client).forBlock(blockNr);
    let amount = await sUSDe.getUnvestedAmount();
    let amountF = $bigint.toEther(amount, 18);
    l`cyan<${blockNr}>: green<${amountF}>`;
}

async function getAPRbase (client: Web3Client, timestamp: number) {
    let blockNr = await new BlockDateResolver(client).getBlockNumberFor($date.fromUnixTimestamp(timestamp));
    return getAPRbaseForBlock(client, blockNr);
}


async function getAPRbaseV3 (client: Web3Client, timestamp: number) {
    let blockNr = await new BlockDateResolver(client).getBlockNumberFor($date.fromUnixTimestamp(timestamp));
    return getAPRbaseForBlockV3(client, blockNr);
}

async function getAPRbaseForBlock (client: Web3Client, blockNr: number) {

    let timestamp = (await client.getBlock(blockNr)).timestamp;
    let sUSDe = new IsUSDe(Addresses.eth.sUSDe, client).forBlock(blockNr);
    let t1 = timestamp;
    let t0 = await sUSDe.lastDistributionTimestamp();
    let VESTING_PERIOD_sUSDe = BigInt($date.parseTimespan('8hours', { get: 's'}));
    let SECONDS_PER_YEAR = BigInt(31_536_000);
    if (t1 >= t0 + VESTING_PERIOD_sUSDe) {
        // No distribution yet;
        return 0;
    }

    let vestingAmount = await sUSDe.vestingAmount();
    let unvestedAmount = await sUSDe.getUnvestedAmount();
    let totalAssets = await sUSDe.totalAssets();

    let WAD = 10n**18n;
    let WAD_OUT = 10n**12n;
    // APR ≈ (vestingAmount / vestingPeriod) / totalAssets * SECONDS_PER_YEAR
    let apr = vestingAmount * SECONDS_PER_YEAR * WAD
        / VESTING_PERIOD_sUSDe
        / (totalAssets - (vestingAmount - unvestedAmount));


    let out = apr * WAD_OUT / WAD;

    let timeF = $date.format($date.fromUnixTimestamp(timestamp), 'MM-dd HH:mm');
    let aprF =  $bigint.toEther(out * 100n, 12);
    //l`APR cyan<${timeF}> green<${aprF}> (block: yellow<${blockNr}>)`;
    return aprF;
}


async function getAPRbaseForBlockV3 (client: Web3Client, blockNr: number) {

    let timestamp = (await client.getBlock(blockNr)).timestamp;
    let sUSDe = new IsUSDe(Addresses.eth.sUSDe, client).forBlock(blockNr);
    let t1 = BigInt(timestamp);
    let t0 = await sUSDe.lastDistributionTimestamp();
    let VESTING_PERIOD_sUSDe = BigInt($date.parseTimespan('8hours', { get: 's'}));
    let SECONDS_PER_YEAR = BigInt(31_536_000);

    let deltaT = t1 - t0;

    if (deltaT >= VESTING_PERIOD_sUSDe) {
        // No distribution yet;
        return 0;
    }
    let WAD = 10n**18n;
    let WAD_OUT = 10n**12n;


    let unvestedAmount = await sUSDe.getUnvestedAmount();
    let totalAssets = await sUSDe.totalAssets();

    let apr = unvestedAmount * SECONDS_PER_YEAR * WAD
        / (VESTING_PERIOD_sUSDe - deltaT)
        / totalAssets;




    let out = apr * WAD_OUT / WAD;

    let timeF = $date.format($date.fromUnixTimestamp(timestamp), 'MM-dd HH:mm');
    let aprF =  $bigint.toEther(out * 100n, 12);
    //l`APR cyan<${timeF}> green<${aprF}> (block: yellow<${blockNr}>)`;
    return aprF;
}
