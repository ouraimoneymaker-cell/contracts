import { IsUSDe } from '@0xc/hardhat/IsUSDe/IsUSDe';
import { Addresses } from '@s/constants';
import { BlockDateResolver } from 'dequanto/blocks/BlockDateResolver';
import { Web3Client } from 'dequanto/clients/Web3Client';
import { Web3ClientFactory } from 'dequanto/clients/Web3ClientFactory';
import { TAddress } from 'dequanto/models/TAddress';
import { $bigint } from 'dequanto/utils/$bigint';
import { $date } from 'dequanto/utils/$date';
import { $number } from 'dequanto/utils/$number';
import { $require } from 'dequanto/utils/$require';
import { $apr } from './$apr';

export namespace $ethena {
    const SECONDS_PER_YEAR = BigInt(31_536_000);

    export async function getAPRbaseFromVesting (p: { blockNr?: number, timestamp?: number }) {
        let client = await Web3ClientFactory.getAsync('eth');

        let { blockNr, timestamp } = await getTPoint(client, p)
        let t1 = timestamp;
        let sUSDe = new IsUSDe( Addresses.eth.sUSDe, client).forBlock(blockNr);

        let t0 = await sUSDe.lastDistributionTimestamp();
        let VESTING_PERIOD_sUSDe = BigInt($date.parseTimespan('8hours', { get: 's'}));

        if (t1 >= t0 + VESTING_PERIOD_sUSDe) {
            // No distribution yet;
            return 0;
        }

        let vestingAmount = await sUSDe.vestingAmount();
        let unvestedAmount = await sUSDe.getUnvestedAmount();
        let totalAssets = await sUSDe.totalAssets();

        let WAD = 10n**18n;
        let WAD_OUT = 10n**12n;
        // APRavg = (vestingAmount / vestingPeriod) / totalAssets * SECONDS_PER_YEAR
        let apr = vestingAmount * SECONDS_PER_YEAR * WAD
            / VESTING_PERIOD_sUSDe
            / (totalAssets - (vestingAmount - unvestedAmount));

        let out = apr * WAD_OUT / WAD;
        return out;
    }

    export async function getAPRbaseFromDeltaT (
        erc4626Address: TAddress,
        p0_: { blockNr?: number, timestamp?: number },
        p1_: { blockNr?: number, timestamp?: number }
    ) {
        let result = await getAPRDataFromDeltaTExt(erc4626Address, p0_, p1_);
        return result.apr;
    }

    export async function getAPRDataFromDeltaTExt (
        erc4626Address: TAddress,
        p0_: { blockNr?: number, timestamp?: number },
        p1_: { blockNr?: number, timestamp?: number }
    ) {
        let client = await Web3ClientFactory.getAsync('eth');

        let p0 = await getTPoint(client, p0_);
        let p1 = await getTPoint(client, p1_);

        let erc4626 = new IsUSDe( erc4626Address, client);

        let a0 = await getAssets(erc4626, p0.blockNr);
        let a1 = await getAssets(erc4626, p1.blockNr);

        let deltaT = p1.timestamp - p0.timestamp;

        let exchangeRate_T0 = a0.totalAssets / a0.totalSupply;
        let exchangeRate_T1 = a1.totalAssets / a1.totalSupply;

        let growthFactor = exchangeRate_T1 / exchangeRate_T0 - 1;

        let APR = growthFactor / deltaT * Number(SECONDS_PER_YEAR);
        let APY = $apr.toApy(APR);
        return {
            apr: $number.round(APR * 100, 5),
            apy: APY,
            priceT0: exchangeRate_T0,
            priceT1: exchangeRate_T1,
        };
    }

    async function getTPoint (client: Web3Client, p: { blockNr?: number, timestamp?: number }) {
        let blocks = new BlockDateResolver(client);

        let blockNr = p.blockNr;
        if (blockNr == null) {
            let t = $require.notNull(p.timestamp, 'At least timestamp must be present');
            blockNr = await blocks.getBlockNumberFor($date.fromUnixTimestamp(t));
        }
        let block = await client.getBlock(blockNr);
        let timestamp = block.timestamp;

        return {
            blockNr,
            timestamp
        };
    }
    async function getAssets (vault: IsUSDe, blockNr: number) {
        vault = vault.forBlock(blockNr);

        let [
            totalAssets,
            totalSupply
        ] = await Promise.all([
            vault.totalAssets(),
            vault.totalSupply()
        ]);

        return {
            totalAssets: $bigint.toEther(totalAssets),
            totalSupply: $bigint.toEther(totalSupply),
        }
    }
}
