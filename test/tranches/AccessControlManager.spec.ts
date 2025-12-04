import { UAction } from 'atma-utest'
import { HardhatProvider } from 'dequanto/hardhat/HardhatProvider';
import { AccessControlManager } from '@0xc/hardhat/AccessControlManager/AccessControlManager';
import { $require } from 'dequanto/utils/$require';
import { $promise } from 'dequanto/utils/$promise';


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

        await acm.$receipt().grantCall(deployer, deployer.address, sel, deployer.address);

        const isAllowed = await acm.$config({ from: deployer.address }).isAllowedToCall(deployer.address, sel);
        $require.eq(isAllowed, true);
    }
})
