import { SharesCooldown } from '@0xc/hardhat/SharesCooldown/SharesCooldown';
import { TwoStepConfigManager } from '@0xc/hardhat/TwoStepConfigManager/TwoStepConfigManager';
import { TEth } from 'dequanto/models/TEth';
import { $bigint } from 'dequanto/utils/$bigint';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';

export namespace $exitMode {

    interface IExitMode {
        // Percentage
        covPct: number
        // Duration (seconds)
        lock?: number | string
        // Exit fee percentage
        feePct?: number

        // Exit fee bps
        feeBps?: number
    }

    export async function propose (proposer: TEth.IAccount, twoStepConfig: TwoStepConfigManager, jrt: IExitMode[], srt: IExitMode[], delay?: number) {
        await twoStepConfig.$receipt().scheduleExitModeBoundsChange(proposer, map(jrt), map(srt), BigInt(delay ?? 24 * 60 * 60));
    }
    export function map (modes: IExitMode[]) {
        while (modes.length < 3) {
            modes.unshift({ covPct: 0 });
        }

        const arr = modes.map(mode => {
            let fee = 0;
            let lock = 0;
            if (mode.feePct > 0) {
                fee = Number($bigint.toWei(mode.feePct / 100, 6))
            }
            if (mode.feeBps > 0) {
                fee = Number($bigint.toWei(mode.feeBps / 10000, 6))
            }
            if (typeof mode.lock === 'number') {
                lock = mode.lock;
            }
            if (typeof mode.lock ==='string') {
                lock = $date.parseTimespan(mode.lock, { get: 's' });
            }
            return {
                coverage: Number($bigint.toWei(mode.covPct / 100, 6)),
                sharesLock: lock,
                fee: fee,
                assetsLock: 0
            };
        });
        return {
            p0: arr[0].coverage,
            p1: arr[1]?.coverage ?? 0,
            r0: { feePpm: arr[0].fee, sharesLock: arr[0].sharesLock },
            r1: { feePpm: arr[1]?.fee ?? 0, sharesLock: arr[1]?.sharesLock ?? 0 },
            r2: { feePpm: arr[2]?.fee ?? 0, sharesLock: arr[2]?.sharesLock ?? 0 },
        }
    }

    export function eq (a: ReturnType<typeof map>, b: ReturnType<typeof map>) {
        if (a.p0 !== b.p0) return false;
        if (a.p1 !== b.p1) return false;
        if (a.r0.feePpm     !== b.r0.feePpm)     return false;
        if (a.r0.sharesLock !== b.r0.sharesLock) return false;
        if (a.r1.feePpm     !== b.r1.feePpm)     return false;
        if (a.r1.sharesLock !== b.r1.sharesLock) return false;
        if (a.r2.feePpm     !== b.r2.feePpm)     return false;
        if (a.r2.sharesLock !== b.r2.sharesLock) return false;
        return true;
    }

    export async function set (sharesCooldown: SharesCooldown, twoStepConfig: TEth.IAccount, vault: TEth.Address, modes: IExitMode[]): Promise<void> {
        $require.eq(sharesCooldown.client.platform, 'hardhat')
        await sharesCooldown.client.debug.setBalance(twoStepConfig.address, BigInt(1e18));
        await sharesCooldown.$receipt().setVaultExitBounds({
            address: twoStepConfig.address,
            type: 'impersonated',
        }, vault, map(modes));
    }

    export async function execute (executor: TEth.IAccount, twoStepConfig: TwoStepConfigManager) {
        await twoStepConfig.$receipt().executeExitModeBoundsChange(executor);
    }
}
