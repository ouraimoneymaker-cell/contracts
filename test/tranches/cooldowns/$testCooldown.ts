import { ICooldown } from '@0xc/hardhat/ICooldown/ICooldown';
import { ERC20 } from 'dequanto/prebuilt/openzeppelin/ERC20';
import { $acc } from '../utils/$acc';
import { $date } from 'dequanto/utils/$date';
import { $require } from 'dequanto/utils/$require';
import { $hh } from '../utils/$hh';

export namespace $testCooldown {


    export async function finalize (cooldown: ICooldown, token: ERC20 | any, to: $acc.Address) {
        await cooldown.$receipt().finalize($hh.test.deployer,  token.address, $acc.toAddress(to));
    }


    export async function eqBalanceOf(cooldown: ICooldown, token: ERC20 | any, account: $acc.Address, amounts: {
        pending?: bigint,
        claimable?: bigint
        nextUnlockAmount?: bigint
        nextUnlockAt?: string | bigint
        totalRequests?: bigint
    }) {
        const balance = await cooldown.balanceOf(token.address, $acc.toAddress(account));

        $require.eq(balance.pending, amounts.pending ?? 0n, 'invalid pending');
        $require.eq(balance.claimable, amounts.claimable ?? 0n, 'invalid claimable');
        if (amounts.nextUnlockAmount != null) {
            $require.eq(balance.nextUnlockAmount, amounts.nextUnlockAmount, 'invalid nextUnlockAmount');
        }
        if (amounts.totalRequests != null) {
            $require.eq(balance.totalRequests, amounts.totalRequests, 'invalid totalRequests');
        }
        if (typeof amounts.nextUnlockAt ==='string') {
            let now = (await cooldown.client.getBlock('latest')).timestamp;
            let s = $date.parseTimespan(amounts.nextUnlockAt, { get:'s' });
            let unlockAt = now + s;
            let diff = Math.abs(unlockAt - Number(balance.nextUnlockAt));
            $require.lt(diff, s * 0.01); // 1%
        } else if (typeof amounts.nextUnlockAt === 'bigint') {
            $require.eq(amounts.nextUnlockAt, balance.nextUnlockAt, 'invalid nextUnlockAt');
        }
    }

}
