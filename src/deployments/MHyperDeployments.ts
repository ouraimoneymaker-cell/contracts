import memd from 'memd';
import { AccessControlManager } from '@0xc/hardhat/AccessControlManager/AccessControlManager'
import { Web3Client } from 'dequanto/clients/Web3Client'
import { TEth } from 'dequanto/models/TEth'
import { IPlatformAccounts } from '../platforms/IPlatform'
import { $require } from 'dequanto/utils/$require'
import { StrataCDO } from '@0xc/hardhat/StrataCDO/StrataCDO'
import { ERC20Cooldown } from '@0xc/hardhat/ERC20Cooldown/ERC20Cooldown'
import { UnstakeCooldown } from '@0xc/hardhat/UnstakeCooldown/UnstakeCooldown'
import { $address } from 'dequanto/utils/$address'
import { Constructor } from 'dequanto/utils/types';
import { Addresses } from '@s/constants';
import { TrancheDepositor } from '@0xc/hardhat/TrancheDepositor/TrancheDepositor';
import { DeploymentsBase } from './DeploymentsBase';
import { IStrategy } from '@0xc/hardhat/IStrategy/IStrategy';
import { IBeaconProxy } from 'dequanto/contracts/deploy/proxy/ProxyDeployment';
import { MockMToken } from '@0xc/hardhat/MockMToken/MockMToken';
import { MockOracle } from '@0xc/hardhat/MockOracle/MockOracle';
import { MockDepositVault } from '@0xc/hardhat/MockDepositVault/MockDepositVault';
import { MockRedemptionVault } from '@0xc/hardhat/MockRedemptionVault/MockRedemptionVault';
import { MidasStrategy } from '@0xc/hardhat/MidasStrategy/MidasStrategy';
import { AaveOracleAprPairProvider } from '@0xc/hardhat/AaveOracleAprPairProvider/AaveOracleAprPairProvider';
import { MockERC20 } from '@0xc/hardhat/MockERC20/MockERC20';
import { MidasCooldownRequestImpl } from '@0xc/hardhat/MidasCooldownRequestImpl/MidasCooldownRequestImpl';
import { MockUSDe } from '@0xc/hardhat/MockUSDe/MockUSDe';


type TUnderlyingContracts = {
    mHYPER: MockMToken
    oracle: MockOracle
    depositVault: MockDepositVault
    redemptionVault: MockRedemptionVault

    USDC: MockERC20
    DAI: MockERC20
    USDS: MockERC20
}

export class MHyperDeployments extends DeploymentsBase<{
    Tokens: TUnderlyingContracts
    Strategy: MidasStrategy
}> {

    constructor(params: {
        client: Web3Client
        deployer: TEth.EoAccount
        owner?: TEth.IAccount
        accounts?: IPlatformAccounts
        deployments?: 'throw' | 'redeploy'
    }) {
        super({
            cdo: 'mhyper',
            ...params
        })
    }

    async ensureFeedProvider() {
        let { oracle } = await this.ensureUnderlying()
        let acm = await this.ensureACM();
        let network = this.ds.client.network;
        let aavePool = Addresses[network]?.AavePool;
        if (aavePool == null) {
            // Not found Aave Pool, remove NULL for manula update (@TODO create a mock one if needed)
            return { provider: null };
        }

        const { contract: provider } = await this.ds.ensure(AaveOracleAprPairProvider, {
            arguments: [
                acm.address,
                aavePool,
                [
                    $require.Address(Addresses[network].USDC),
                    $require.Address(Addresses[network].USDT),
                ],
                oracle.address,
            ]
        });
        return {
            provider
        };
    }

    @memd.deco.memoize({ perInstance: true })
    async ensureUnderlying(): Promise<{
        base: MockUSDe
    } & TUnderlyingContracts> {
        let network = this.ds.client.network;
        if (network === 'hardhat') {
            const USDC = await this.ds.ensureContract(MockERC20, {
                id: 'USDC',
                arguments: ['USDC', 6]
            });
            const DAI = await this.ds.ensureContract(MockERC20, {
                id: 'DAI',
                arguments: ['DAI', 18]
            });
            const USDS = await this.ds.ensureContract(MockERC20, {
                id: 'USDS',
                arguments: ['USDS', 18]
            });

            const mHYPER = await this.ds.ensureContract(MockMToken);
            const midasDepositVault = await this.ds.ensureContract(MockDepositVault, {
                arguments: [ mHYPER.address ]
            });
            const midasRedemptionVault = await this.ds.ensureContract(MockRedemptionVault, {
                arguments: [
                    mHYPER.address,
                    USDC.address
                ]
            });
            const oracle = await this.ds.ensureContract(MockOracle);

            return {
                base: USDC as any,
                USDC,
                DAI,
                USDS,
                mHYPER,
                oracle,
                depositVault: midasDepositVault,
                redemptionVault: midasRedemptionVault,
            };
        }

        const { Tokens, mhyper } = this.platform;

        const create = <T>(Ctor: Constructor<T>, symbolOrAddress: string | TEth.Address): T => {
            let address = $require.Address(Tokens[symbolOrAddress]?.address ?? symbolOrAddress);
            let contract = new Ctor(address, this.ds.client);
            return contract;
        };

        return {
            base: create(MockERC20, 'USDC') as any,
            mHYPER: create(MockMToken, 'mHYPER'),

            USDC: create(MockERC20, 'USDC'),
            DAI: create(MockERC20, 'DAI'),
            USDS: create(MockERC20, 'USDS'),

            oracle: create(MockOracle, mhyper.oracle),
            depositVault: create(MockDepositVault, mhyper.depositVault),
            redemptionVault: create(MockRedemptionVault, mhyper.redemptionVault),
        };

    }

    async ensureUnstakeImplemenetations(): Promise<{ token: TEth.Address; impl: IBeaconProxy }[]> {
        let { USDC, mHYPER, redemptionVault  } = await this.ensureUnderlying();
        const { contractBeaconProxy: midasCooldownRequestImpl } = await this.ds.ensureWithBeacon(MidasCooldownRequestImpl, {
            id: 'MHyperCooldownRequestBeacon',
            arguments: [ USDC.address, mHYPER.address, redemptionVault.address ],
            initialize: [$address.ZERO, $address.ZERO]
        });

        return [
            { token: mHYPER.address, impl: midasCooldownRequestImpl }
        ]
    }
    protected async ensureStrategy(
        cdo: StrataCDO,
        acm: AccessControlManager,
        erc20Cooldown: ERC20Cooldown,
        unstakeCooldown: UnstakeCooldown,
    ): Promise<{ strategy: MidasStrategy; }> {
        const { USDC, DAI, USDS, mHYPER, depositVault, redemptionVault, oracle } = await this.ensureUnderlying();
        const { contract: strategy } = await this.ds.ensureWithProxy(MidasStrategy, {
            arguments: [
                USDC.address,
                mHYPER.address,
                depositVault.address,
                redemptionVault.address,
                oracle.address,
            ],
            initialize: [
                this.owner.address,
                acm.address,
                cdo.address,
                erc20Cooldown.address,
                unstakeCooldown.address,
                [ DAI.address, USDS.address ],
            ]
        });
        return { strategy }
    }
    async configureCooldowns(strategy: IStrategy): Promise<void> {

    }
    async configureDepositor(depositor: TrancheDepositor) {
        let { USDC } = await this.ensureUnderlying();
        let { cdo, jrtVault } = await this.ensureCDO();

        let status = await depositor.tranches(jrtVault.address, USDC.address);
        if (status == false) {
            // If JRT and USDC are not supported, add CDO
            await depositor.$receipt().addCdo(this.owner, cdo.address);
        }

        return depositor;
    }
}
