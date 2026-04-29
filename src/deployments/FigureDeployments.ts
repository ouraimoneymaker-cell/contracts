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
import { TrancheDepositor } from '@0xc/hardhat/TrancheDepositor/TrancheDepositor';
import { DeploymentsBase } from './DeploymentsBase';
import { IStrategy } from '@0xc/hardhat/IStrategy/IStrategy';
import { IBeaconProxy } from 'dequanto/contracts/deploy/proxy/ProxyDeployment';
import { MockERC20 } from '@0xc/hardhat/MockERC20/MockERC20';
import { MockUSDe } from '@0xc/hardhat/MockUSDe/MockUSDe';
import { AprPairFeed } from '@0xc/hardhat/AprPairFeed/AprPairFeed';
import { FigureStrategy } from '@0xc/hardhat/FigureStrategy/FigureStrategy';
import { FigureCooldownRequestImpl } from '@0xc/hardhat/FigureCooldownRequestImpl/FigureCooldownRequestImpl';
import { MockYieldVault } from '@0xc/hardhat/MockYieldVault/MockYieldVault';
import { MockStakingVault } from '@0xc/hardhat/MockStakingVault/MockStakingVault';
import { MockFeedVerifier } from '@0xc/hardhat/MockFeedVerifier/MockFeedVerifier';
import { MockHastraNavEngine } from '@0xc/hardhat/MockHastraNavEngine/MockHastraNavEngine';
import { $bigint } from 'dequanto/utils/$bigint';
import { ConstantOracleAprPairProvider } from '@0xc/hardhat/ConstantOracleAprPairProvider/ConstantOracleAprPairProvider';


type TUnderlyingContracts = {
    USDC: MockERC20
    yieldVault: MockYieldVault
    stakingVault: MockStakingVault
    feedVerifier: MockFeedVerifier
    navEngine: MockHastraNavEngine
}

export class FigureDeployments extends DeploymentsBase<{
    Tokens: TUnderlyingContracts
    Strategy: FigureStrategy
}> {

    constructor(params: {
        client: Web3Client
        deployer: TEth.EoAccount
        owner?: TEth.IAccount
        accounts?: IPlatformAccounts
        deployments?: 'throw' | 'redeploy'
    }) {
        super({
            cdo: 'figure',
            ...params
        })
    }

    async ensureFeedProvider() {
        await this.ensureUnderlying();

        const { contract: provider } = await this.ds.ensure(ConstantOracleAprPairProvider, {
            id: this.getContractId(`ConstantOracleAprPairProvider`),
            arguments: [this.platform.figure.primeFeed],
        });

        return { provider };
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

            const feedVerifier = await this.ds.ensureContract(MockFeedVerifier, {
                id: 'FigureFeedVerifier',
                arguments: [BigInt(1e18)]
            });

            const { contract: yieldVault } = await this.ds.ensureWithProxy(MockYieldVault, {
                id: 'FigureYieldVault',
                arguments: [],
                initialize: [
                    USDC.address,
                    'Wrapped YLDS',
                    'wYLDS',
                    this.owner.address,
                    this.owner.address, // redeemVault
                ]
            });

            await USDC.$receipt().approve(this.owner, yieldVault.address, $bigint.MAX_UINT256);

            const { contract: stakingVault } = await this.ds.ensureWithProxy(MockStakingVault, {
                id: 'FigureStakingVault',
                arguments: [],
                initialize: [
                    yieldVault.address,
                    'Prime Staked YLDS',
                    'PRIME',
                    this.owner.address,
                    yieldVault.address,
                ]
            });

            await stakingVault.$receipt().grantRole(
                this.owner,
                await stakingVault.NAV_ORACLE_UPDATER_ROLE(),
                this.owner.address
            );
            await stakingVault.$receipt().setNavOracle(
                this.owner,
                feedVerifier.address,
                '0x' + '00'.repeat(32) // feedId not used in tests
            );

            await stakingVault.$receipt().grantRole(
                this.owner,
                await stakingVault.REWARDS_ADMIN_ROLE(),
                this.owner.address
            );
            await yieldVault.$receipt().grantRole(
                this.owner,
                await yieldVault.REWARDS_ADMIN_ROLE(),
                this.owner.address
            );

            // Deploy MockHastraNavEngine for APR pair provider
            const { contract: navEngine } = await this.ds.ensureWithProxy(MockHastraNavEngine, {
                id: 'FigureNavEngine',
                arguments: [],
                initialize: [
                    this.owner.address,   // owner
                    this.owner.address,   // updater
                    BigInt(0.5e18),       // maxDifferencePercent (50%)
                    BigInt(0.5e18),       // minRate
                    BigInt(2e18),         // maxRate
                    BigInt(1e18),         // initialTotalSupply_
                    BigInt(1e18)          // initialTotalTVL_
                ]
            });

            return {
                base: USDC as any,
                USDC,
                yieldVault: yieldVault as any,
                stakingVault: stakingVault as any,
                feedVerifier: feedVerifier as any,
                navEngine: navEngine as any,
            };
        }

        const { Tokens, figure } = this.platform;

        const create = <T>(Ctor: Constructor<T>, symbolOrAddress: string | TEth.Address): T => {
            let address = $require.Address(Tokens[symbolOrAddress]?.address ?? symbolOrAddress);
            let contract = new Ctor(address, this.ds.client);
            return contract;
        };

        return {
            base: create(MockERC20, 'USDC') as any,
            USDC: create(MockERC20, 'USDC'),
            yieldVault: create(MockYieldVault, figure.yieldVault),
            stakingVault: create(MockStakingVault, figure.stakingVault),
            feedVerifier: create(MockFeedVerifier, figure.feedVerifier),
            navEngine: create(MockHastraNavEngine, figure.navEngine),
        };
    }

    async ensureUnstakeImplemenetations(): Promise<{ token: TEth.Address; impl: IBeaconProxy }[]> {
        let { USDC, yieldVault } = await this.ensureUnderlying();
        const { contractBeaconProxy: figureCooldownRequestImpl } = await this.ds.ensureWithBeacon(FigureCooldownRequestImpl, {
            id: `${this.pfx}CooldownRequestBeacon`,
            arguments: [yieldVault.address, USDC.address],
            initialize: [$address.ZERO, $address.ZERO]
        });

        return [
            { token: yieldVault.address, impl: figureCooldownRequestImpl }
        ];
    }

    protected async ensureStrategy(
        cdo: StrataCDO,
        acm: AccessControlManager,
        erc20Cooldown: ERC20Cooldown,
        unstakeCooldown: UnstakeCooldown,
    ): Promise<{ strategy: FigureStrategy; }> {
        const { USDC, yieldVault, stakingVault } = await this.ensureUnderlying();
        const { contract: strategy } = await this.ds.ensureWithProxy(FigureStrategy, {
            id: `${this.pfx}FigureStrategy`,
            arguments: [
                stakingVault.address,
                yieldVault.address,
                USDC.address,
            ],
            initialize: [
                this.owner.address,
                acm.address,
                cdo.address,
                erc20Cooldown.address,
                unstakeCooldown.address,
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
            await depositor.$receipt().addCdo(this.owner, cdo.address);
        }

        return depositor;
    }

    protected override async configureAprFeed(feed: AprPairFeed) {
        await this.ensureFeedProvider();
    }
}
