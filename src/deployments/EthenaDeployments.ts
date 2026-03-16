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
import { $date } from 'dequanto/utils/$date';
import { Addresses } from '@s/constants';
import { MockStakedUSDe } from '@0xc/hardhat/MockStakedUSDe/MockStakedUSDe';
import { MockUSDe } from '@0xc/hardhat/MockUSDe/MockUSDe';
import { TrancheDepositor } from '@0xc/hardhat/TrancheDepositor/TrancheDepositor';
import { DeploymentsBase } from './DeploymentsBase';
import { IStrategy } from '@0xc/hardhat/IStrategy/IStrategy';
import { SUSDeAprPairProvider } from '@0xc/hardhat/sUSDeAprPairProvider/sUSDeAprPairProvider';
import { IBeaconProxy } from 'dequanto/contracts/deploy/proxy/ProxyDeployment';
import { AaveAprPairProvider } from '@0xc/hardhat/AaveAprPairProvider/AaveAprPairProvider';
import { MockStakedUSDS } from '@0xc/hardhat/MockStakedUSDS/MockStakedUSDS';
import { MockERC4626 } from '@0xc/hardhat/MockERC4626/MockERC4626';
import { SUSDeCooldownRequestImpl } from '@0xc/hardhat/sUSDeCooldownRequestImpl/sUSDeCooldownRequestImpl';
import { SUSDeStrategy } from '@0xc/hardhat/sUSDeStrategy/sUSDeStrategy';
import { ICDO } from '@s/platforms/Tranches';


type TUnderlyingTokens = {
    USDe: MockUSDe
    sUSDe: MockStakedUSDe
    sUSDS: MockStakedUSDS
    pUSDe: MockERC4626
}

export class EthenaDeployments extends DeploymentsBase<{
    Tokens: TUnderlyingTokens
    Strategy: SUSDeStrategy
}> {

    constructor(params: {
        client: Web3Client
        deployer: TEth.EoAccount
        owner?: TEth.IAccount
        accounts?: IPlatformAccounts
        deployments?: 'throw' | 'redeploy',
        cdoInfo?: Partial<ICDO>;
    }) {
        super({
            cdo: 'ethena',
            ...params
        })
    }

    async ensureFeedProvider() {
        const { sUSDe, USDe, sUSDS } = await this.ensureUnderlying();
        const { contract: sUSDeAprPairProvider } = await this.ds.ensure(SUSDeAprPairProvider, {
            arguments: [
                sUSDS.address,
                sUSDe.address,
            ]
        });

        const network = this.client.network;
        const aavePool = Addresses[network]?.AavePool;
        if (aavePool) {
            const { contract: aaveAprPairProvider } = await this.ds.ensure(AaveAprPairProvider, {
                arguments: [
                    $require.Address(Addresses[network].AavePool),
                    [
                        $require.Address(Addresses[network].USDC),
                        $require.Address(Addresses[network].USDT),
                    ],
                    sUSDe.address
                ]
            });
            return { provider: aaveAprPairProvider };
        }
        return { provider: sUSDeAprPairProvider };
    }

    @memd.deco.memoize({ perInstance: true })
    async ensureUnderlying(): Promise<{
        base: MockUSDe
        USDe: MockUSDe
        sUSDe: MockStakedUSDe
        sUSDS: MockStakedUSDS
        pUSDe: MockERC4626
    }> {
        let network = this.ds.client.network;
        if (network === 'hardhat') {
            let USDe = await this.ds.ensureContract(MockUSDe);
            let sUSDe = await this.ds.ensureContract(MockStakedUSDe, {
                arguments: [
                    USDe.address,
                    this.owner.address,
                    this.owner.address
                ]
            });
            let sUSDS = await this.ds.ensureContract(MockStakedUSDS, {
                arguments: [
                    USDe.address,
                ]
            });
            let pUSDe = await this.ds.ensureContract(MockERC4626, {
                id: 'pUSDeMock',
                arguments: [USDe.address]
            });
            await sUSDe.$receipt().setCooldownDuration(this.owner, $date.parseTimespan('1week', { get: 's' }));

            return { base: USDe, USDe, sUSDe, sUSDS, pUSDe, };
        }
        if (network === 'hoodi') {
            let USDeAddress = $require.Address(this.platform.Tokens['USDe'].address);
            let sUSDeAddress = $require.Address(this.platform.Tokens['sUSDe'].address);
            let pUSDeAddress = $require.Address(this.platform.Tokens['pUSDe'].address);
            let sUSDS = await this.ds.ensureContract(MockStakedUSDS, {
                arguments: [
                    USDeAddress,
                ]
            });
            return {
                base: new MockUSDe(USDeAddress, this.ds.client),
                USDe: new MockUSDe(USDeAddress, this.ds.client),
                sUSDe: new MockStakedUSDe(sUSDeAddress, this.ds.client),
                sUSDS: sUSDS,
                pUSDe: new MockERC4626(pUSDeAddress, this.ds.client)
            };
        }

        let USDeAddress = $require.Address(this.platform.Tokens['USDe'].address);
        let sUSDeAddress = $require.Address(this.platform.Tokens['sUSDe'].address);
        let sUSDSAddress = $require.Address(this.platform.Tokens['sUSDS'].address);
        let pUSDeAddress = $require.Address(this.platform.Tokens['pUSDe'].address);
        return {
            base: new MockUSDe(USDeAddress, this.ds.client),
            USDe: new MockUSDe(USDeAddress, this.ds.client),
            sUSDe: new MockStakedUSDe(sUSDeAddress, this.ds.client),
            sUSDS: new MockStakedUSDS(sUSDSAddress, this.ds.client),
            pUSDe: new MockERC4626(pUSDeAddress, this.ds.client)
        };

    }

    async ensureUnstakeImplemenetations(): Promise<{ token: TEth.Address; impl: IBeaconProxy }[]> {
        const { sUSDe } = await this.ensureUnderlying();
        const { contractBeaconProxy: sUSDeCooldownRequestImpl } = await this.ds.ensureWithBeacon(SUSDeCooldownRequestImpl, {
            id: 'SUSDeCooldownRequestBeacon',
            arguments: [sUSDe.address],
            initialize: [$address.ZERO, $address.ZERO]
        });

        return [
            { token: sUSDe.address, impl: sUSDeCooldownRequestImpl }
        ]
    }
    protected async ensureStrategy(
        cdo: StrataCDO,
        acm: AccessControlManager,
        erc20Cooldown: ERC20Cooldown,
        unstakeCooldown: UnstakeCooldown,
    ): Promise<{ strategy: SUSDeStrategy; }> {
        const { sUSDe } = await this.ensureUnderlying();
        const { contract: strategy } = await this.ds.ensureWithProxy(SUSDeStrategy, {
            arguments: [
                sUSDe.address
            ],
            initialize: [
                this.owner.address,
                acm.address,
                cdo.address,
                erc20Cooldown.address,
                unstakeCooldown.address
            ]
        });
        return { strategy }
    }
    async configureCooldowns(strategy: SUSDeStrategy): Promise<void> {
        let info = this.cdoInfo;
        let cooldowns = [info.jrt.sUSDeCooldown, info.srt.sUSDeCooldown]
            .map(mix => {
                if (typeof mix === 'string') {
                    return $date.parseTimespan(mix, { get: 's' });
                }
                return mix;
            })
            .map(BigInt);


        let current = await Promise.all([
            await strategy.sUSDeCooldownJrt(),
            await strategy.sUSDeCooldownSrt(),
        ]);
        await this.ds.configure(strategy, {
            shouldUpdate: () => {
                return cooldowns[0] !== current[0] || cooldowns[1] !== current[1]
            },
            updater: async () => {
                await strategy.$receipt().setCooldowns(
                    this.owner,
                    cooldowns[0],
                    cooldowns[1]
                );
            }
        });
    }
    async configureDepositor(depositor: TrancheDepositor) {
        let { pUSDe } = await this.ensureUnderlying();
         if (pUSDe) {
            let status = await depositor.autoWithdrawals(pUSDe.address);
            if (status === false) {
                await depositor.$receipt().addAutoWithdrawals(this.owner, [pUSDe.address], [true]);
            }
        }
    }
}
