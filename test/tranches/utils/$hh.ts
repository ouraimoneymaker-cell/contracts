import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';

export namespace $hh {
    export function client () {
        let hh = new HardhatProvider();
        let client = hh.client('localhost');
        return client;
    }
}
