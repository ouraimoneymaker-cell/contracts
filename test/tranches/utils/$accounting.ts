import { $bigint } from 'dequanto/utils/$bigint';
import { $date } from 'dequanto/utils/$date';
import { $number } from 'dequanto/utils/$number';

export namespace $accounting {
    export function calculateGain (lastNav, targetIndexCurrent, targetIndex) {
        // Gain = Assets * (TargetIndex1 / TargetIndex0 - 1);
        if (targetIndexCurrent <= targetIndex) {
            // If zero or negative targetIndex, no gain
            return 0;
        }
        return lastNav * targetIndexCurrent / targetIndex - lastNav;
    }


    export function calculateApr (b1: number | bigint, b2: number | bigint, secondsMix: string | number = '1year') {
        let b1_ = typeof b1 === 'bigint'? $bigint.toEther(b1, 18) : b1;
        let b2_ = typeof b2 === 'bigint'? $bigint.toEther(b2, 18) : b2;

        let gain = b2_ - b1_;
        let seconds = typeof secondsMix === 'string'
            ? $date.parseTimespan(secondsMix, { get: 's' })
            : secondsMix;
        let YEAR = 31536000;

        console.log(`CalulateAPR`, gain, 'for s', seconds, secondsMix);

        let return_ = gain / b1_ * YEAR / seconds * 100;
        return $number.round(return_, 2);
    }
}
