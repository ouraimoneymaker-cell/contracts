import { UAction, UTest } from 'atma-utest';
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { $hh } from '../utils/$hh';
import { AprsProvider } from '@0xc/hardhat/AprsProvider/AprsProvider';
import { Addresses } from '@s/constants';
import { $bigint } from 'dequanto/utils/$bigint';
import { Web3ClientFactory } from 'dequanto/clients/Web3ClientFactory';
import { Web3Client } from 'dequanto/clients/Web3Client';
import { IsUSDe } from '@0xc/hardhat/IsUSDe/IsUSDe';
import { $date } from 'dequanto/utils/$date';
import { l } from 'dequanto/utils/$logger';
import { BlockDateResolver } from 'dequanto/blocks/BlockDateResolver';
import { $ethena } from '@s/utils/$ethena';


//let net = await $hh.forked();

UAction.create({
    async 'aprs' () {


        // let provider = await net.ds.ensureContract(AprsProvider, {
        //     arguments:[
        //         Addresses.eth.sUSDS,
        //         Addresses.eth.sUSDe,
        //     ]
        // });

        // //console.log($bigint.toEther(await provider.getAPRtarget(), 12))

        // console.log($bigint.toEther(await provider.getAPRbase(), 12))


        let client = await Web3ClientFactory.getAsync('eth');

        let HOUR = 60 * 60;
        let distrTimestamp = 1758261719;
        let block = 23395201;

        let sUSDe = new IsUSDe(Addresses.eth.sUSDe, client);
        let cursor = Number(await sUSDe.lastDistributionTimestamp());

        let aprs = [];
        console.log('');
        for (let i = 0; i < 80; i++) {
            let aprV1 = await $ethena.getAPRbaseFromDeltaT(
                // { blockNr: block + 100},
                // { blockNr: block + 305 }
                { timestamp: cursor },
                { timestamp: cursor - 8 * HOUR }
            );
            let aprV2 = await getAPRbase(client, cursor);
            let aprV3 = await getAPRbaseV3(client, cursor);

            let date = $date.fromUnixTimestamp(cursor);
            aprs.push([
                date,
                aprV1,
                aprV2,
                aprV3,
            ]);

            let cells = [
                $date.format(date, 'dd-MM HH:mm'), aprV1, aprV2, aprV3
            ]
            console.log(cells.join(', '));
            cursor -= 8 * HOUR;
        }



        //let blockNr = await new BlockDateResolver(client).getBlockNumberFor($date.fromUnixTimestamp(distrTimestamp));


        // await getAPRbaseForBlock(client, block - 1);
        // await getAPRbaseForBlock(client, block);

        // await getAPRbaseForBlock(client, block + 1);
        // await getAPRbaseForBlock(client, block + 2);
        // await getAPRbaseForBlock(client, block + 3);
        // await getAPRbaseForBlock(client, block + 4);
        // await getAPRbaseForBlock(client, block + 305);

        let date = $date.parse('11-09-2025 20:00')

        await getAPRbase(client, $date.toUnixTimestamp(date));
        let apr = await $ethena.getAPRbaseFromDeltaT(
            // { blockNr: block + 100},
            // { blockNr: block + 305 }
            { timestamp: $date.toUnixTimestamp(date) - 8 * 60 * 60 },
            { timestamp: $date.toUnixTimestamp(date) },
        );
        console.log(apr);

        // await getAPRbase(client, distr - 5 * HOUR);
        // await getAPRbase(client, distr - 4 * HOUR);
        // await getAPRbase(client, distr - 3 * HOUR);
        // await getAPRbase(client, distr - 2 * HOUR);
        // await getAPRbase(client, distr - 1 * HOUR);
        // await getAPRbase(client, distr);
        // await getAPRbase(client, distr + 1 * HOUR);
        // await getAPRbase(client, distr + 2 * HOUR);
        // await getAPRbase(client, distr + 3 * HOUR);
        // await getAPRbase(client, distr + 4 * HOUR);
        // await getAPRbase(client, distr + 5 * HOUR);
        // await getAPRbase(client, distr + 6 * HOUR);
        // await getAPRbase(client, distr + 7 * HOUR);
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
