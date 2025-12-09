import { UAction } from 'atma-utest'
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { AccessControlManager } from '@0xc/hardhat/AccessControlManager/AccessControlManager';
import { $require } from 'dequanto/utils/$require';
import { $promise } from 'dequanto/utils/$promise';
import { l } from 'dequanto/utils/$logger';
import { $hh } from './utils/$hh';
import { Accounting } from '@0xc/hardhat/Accounting/Accounting';
import { $address } from 'dequanto/utils/$address';
import { StrataMasterChef } from '@0xc/hardhat/StrataMasterChef/StrataMasterChef';
import { $date } from 'dequanto/utils/$date';



const hh = new HardhatProvider();
const client = await hh.client();
const deployer = await hh.deployer();

UAction.create({

    async 'should check permission' () {
        let { contract: acm } = await hh.deployClass(AccessControlManager, {
            client,
            arguments: [ deployer.address ]
        });

        const hasPermission = await acm.hasPermission( deployer.address, deployer.address, '0x12345612');
        $require.eq(hasPermission, false);

        const sel = '0x12345612';
        const { error } = await $promise.caught(acm.isAllowedToCall(deployer.address, sel));
        $require.notNull(error, `Should revert`);

        l`Grant`
        await acm.$receipt().grantCall(deployer, deployer.address, sel, deployer.address);

        const isAllowed = await acm.$config({ from: deployer.address }).isAllowedToCall(deployer.address, sel);
        $require.eq(isAllowed, true);

        l`Revoke`
        await acm.$receipt().revokeCall(deployer, deployer.address, sel, deployer.address);

        const { error: errorAfter } = await $promise.caught(acm.isAllowedToCall(deployer.address, sel));
        $require.notNull(errorAfter, `Should revert`);


        await $hh.test.init();
        let { contract: accounting } = await $hh.test.factory.ds.ensureWithProxy(Accounting, {
            initialize: [
                deployer.address,
                deployer.address,
                deployer.address,
                deployer.address,
            ]
        });

        await accounting.$receipt().setAccessControlManager(deployer, acm.address);

        const { contract: timelock } = await hh.deployClass(StrataMasterChef, {
            client,
            arguments: [
                [ deployer.address ],
                []
             ]
        });

        $require.eq(await timelock.getMinDelay(), BigInt($date.parseTimespan('24hours', { get: 's' })));
    },

})
