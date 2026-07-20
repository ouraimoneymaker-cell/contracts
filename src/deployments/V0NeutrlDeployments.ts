import memd from 'memd';
import { AccessControlManager } from '@0xc/hardhat/AccessControlManager/AccessControlManager'
import { Tranche } from '@0xc/hardhat/Tranche/Tranche'
import { Web3Client } from 'dequanto/clients/Web3Client'
import { Deployments } from 'dequanto/contracts/deploy/Deployments'
import { TEth } from 'dequanto/models/TEth'
import { Platforms } from '../platforms/Platforms'
import { IPlatform, IPlatformAccounts } from '../platforms/IPlatform'
import { $require } from 'dequanto/utils/$require'
import { SNUSDStrategy } from '@0xc/hardhat/sNUSDStrategy/sNUSDStrategy'
import { StrataCDO } from '@0xc/hardhat/StrataCDO/StrataCDO'
import { ERC20Cooldown } from '@0xc/hardhat/ERC20Cooldown/ERC20Cooldown'
import { UnstakeCooldown } from '@0xc/hardhat/UnstakeCooldown/UnstakeCooldown'
import { Accounting } from '@0xc/hardhat/Accounting/Accounting'
import { Tranches } from '../platforms/Tranches'
import { $address } from 'dequanto/utils/$address'
import { IERC4626 } from 'dequanto/prebuilt/openzeppelin/IERC4626'
import { $contract } from 'dequanto/utils/$contract'
import { SNUSDCooldownRequestImpl } from '@0xc/hardhat/sNUSDCooldownRequestImpl/sNUSDCooldownRequestImpl';
import { $date } from 'dequanto/utils/$date';
import { AprPairFeed } from '@0xc/hardhat/AprPairFeed/AprPairFeed';
import { SNUSDAprPairProvider } from '@0xc/hardhat/sNUSDAprPairProvider/sNUSDAprPairProvider';
import { SharesCooldown } from '@0xc/hardhat/SharesCooldown/SharesCooldown';
import { ContractBase } from 'dequanto/contracts/ContractBase';
import { Constructor } from 'dequanto/utils/types';
import { Addresses } from '@s/constants';
import { MockNUSD } from '@0xc/hardhat/MockNUSD/MockNUSD';
import { MockStakedNUSD } from '@0xc/hardhat/MockStakedNUSD/MockStakedNUSD';
import { MockStakedUSDe } from '@0xc/hardhat/MockStakedUSDe/MockStakedUSDe';
import { MockUSDe } from '@0xc/hardhat/MockUSDe/MockUSDe';
import { TrancheDepositor } from '@0xc/hardhat/TrancheDepositor/TrancheDepositor';
import { SNUSDSwapAdapter } from '@0xc/hardhat/sNUSDSwapAdapter/sNUSDSwapAdapter';

export class V0NeutrlDeployments {
    ds: Deployments;
    platform: IPlatform;
    owner: TEth.IAccount;
    deployer: TEth.EoAccount;
    client: Web3Client;
    neutrlInfo: typeof Tranches.neutrl;

    accounts: IPlatformAccounts;

    constructor(params: {
        client: Web3Client
        deployer: TEth.EoAccount
        owner?: TEth.IAccount
        accounts?: IPlatformAccounts
        deployments?: 'throw' | 'redeploy'
    }) {
        this.deployer = params.deployer;
        this.owner = params.owner ?? params.deployer;
        this.client = params.client;
        this.platform = Platforms[params.client.network];
        this.accounts = params.accounts;

        this.ds = new Deployments(params.client, params.deployer, {
            directory: './deployments/',
            whenBytecodeChanged: params.deployments ?? (this.isTestnet() ? null : 'throw'),
            fork: params.client.forked?.platform
        });

        let info = JSON.parse(JSON.stringify(Tranches.neutrl)) as typeof Tranches.neutrl;

        if (this.platform.Tranches?.neutrl) {
            info.jrt = { ...info.jrt, ...(this.platform.Tranches.neutrl.jrt ?? {}) } as any;
            info.srt = { ...info.srt, ...(this.platform.Tranches.neutrl.srt ?? {}) } as any;
        }
        this.neutrlInfo = info;
    }

    async get<T extends ContractBase>(Ctor: Constructor<T>, params?: { id?: 'jrNUSD' | 'srNUSD', cdo?: 'NUSD' }) {
        if (params?.id === 'jrNUSD') {
            return await this.ds.get(Ctor, { id: 'NUSDJrt' })
        }
        if (params?.id === 'srNUSD') {
            return await this.ds.get(Ctor, { id: 'NUSDSrt' })
        }
        let all = await this.ds.store.getDeployments();
        let byName = all.filter(d => d.name === Ctor.name);
        $require.gt(byName.length, 0, `${Ctor.name} not found in deployments`);

        if (byName.length === 1) {
            return await this.ds.get(Ctor, { id: byName[0].id });
        }
        let cdo = params?.cdo ?? 'NUSD';
        let byCdo = byName.filter(x => x.id.toLowerCase().includes(cdo.toLowerCase()));
        if (byCdo.length === 1) {
            return await this.ds.get(Ctor, { id: byCdo[0].id });
        }

        if (byCdo.length === 0) {
            throw new Error(`No ${Ctor.name} found for CDO ${cdo} in deployments`);
        }
        if (byCdo.length > 1) {
            throw new Error(`Multiple ${Ctor.name} found for CDO ${cdo}: ${byCdo.map(x => x.id).join(', ')}`);
        }
    }

    @memd.deco.memoize()
    async ensureNeutrl() {
        let network = this.ds.client.network;
        if (network === 'hardhat') {
            let NUSD = await this.ds.ensureContract(MockNUSD);
            let sNUSD = await this.ds.ensureContract(MockStakedNUSD, {
                arguments: [
                    NUSD.address,
                    this.owner.address,
                ]
            });

            let USDe = await this.ds.ensureContract(MockUSDe);
            let sUSDe = await this.ds.ensureContract(MockStakedUSDe, {
                arguments: [
                    USDe.address,
                    this.owner.address,
                    this.owner.address
                ]
            });

            await sNUSD.$receipt().setCooldownDuration(this.owner, $date.parseTimespan('1week', { get: 's' }));

            return {
                NUSD,
                sNUSD,
                USDe,
                sUSDe,
            };
        }
        if (network === 'hoodi') {
            let USDeAddress = $require.Address(this.platform.Tokens['USDe'].address);
            let sUSDeAddress = $require.Address(this.platform.Tokens['sUSDe'].address);
            let NUSDAddress = $require.Address(this.platform.Tokens['NUSD']?.address);
            let sNUSDAddress = $require.Address(this.platform.Tokens['sNUSD']?.address);
            return {
                NUSD: new MockNUSD(NUSDAddress, this.ds.client),
                sNUSD: new MockStakedNUSD(sNUSDAddress, this.ds.client),
                USDe: new MockUSDe(USDeAddress, this.ds.client),
                sUSDe: new MockStakedUSDe(sUSDeAddress, this.ds.client),
            };
        }

        let NUSDAddress = $require.Address(this.platform.Tokens['NUSD']?.address);
        let sNUSDAddress = $require.Address(this.platform.Tokens['sNUSD']?.address);
        let USDeAddress = $require.Address(this.platform.Tokens['USDe'].address);
        let sUSDeAddress = $require.Address(this.platform.Tokens['sUSDe'].address);
        return {
            NUSD: new MockNUSD(NUSDAddress, this.ds.client),
            sNUSD: new MockStakedNUSD(sNUSDAddress, this.ds.client),
            USDe: new MockUSDe(USDeAddress, this.ds.client),
            sUSDe: new MockStakedUSDe(sUSDeAddress, this.ds.client),
        };
    }

    @memd.deco.memoize()
    async ensureACM() {
        const owner = this.owner!;
        const acm = await this.ds.ensureContract(AccessControlManager, {
            arguments: [owner.address]
        });

        if (this.isTestnet() === false) {
            let ownerIsAdmin = await acm.hasRole('0x', owner.address);
            let deployer = this.deployer;
            await this.ds.configure(acm, {
                title: `Grant Owner the AccessControlManager Admin Role`,
                shouldUpdate: ownerIsAdmin === false,
                async updater() {
                    await acm.$receipt().grantRole(deployer, '0x', owner.address);
                    await acm.$receipt().revokeRole(owner, '0x', deployer.address);
                }
            });
            let deployerIsAdmin = await acm.hasRole('0x', deployer.address);
            await this.ds.configure(acm, {
                title: `Revoke Deployer the AccessControlManager Admin Role`,
                shouldUpdate: deployerIsAdmin && $address.eq(deployer.address, owner.address) === false,
                async updater() {
                    await acm.$receipt().revokeRole(owner, '0x', deployer.address);
                }
            });
        }
        return acm;
    }

    async ensureRole(role: TEth.Hex, account: TEth.Address) {
        let acm = await this.ensureACM();
        let has = await acm.hasRole(role, account);
        if (has === false) {
            await acm.$receipt().grantRole(this.owner, role, account);
        }
    }

    async ensureRoles(roles: Record<string, Record<TEth.Address, boolean>>) {
        const acm = await this.ensureACM();
        const admin = this.owner;
        for (let role in roles) {
            for (let address in roles[role]) {
                await ensure(role, address as TEth.Address, roles[role][address]);
            }
        }

        async function ensure(role: string, address: TEth.Address, has: boolean) {
            let roleHash = role.startsWith('0x')
                ? role as TEth.Hex
                : $contract.keccak256(role);
            let hasCurrent = await acm.hasRole(roleHash, address);
            if (hasCurrent !== has) {
                if (has) {
                    await acm.$receipt().grantRole(admin, roleHash, address)
                } else {
                    await acm.$receipt().revokeRole(admin, roleHash, address)
                }
            }
        }
    }

    async addRoles(roles?: Record<TEth.Address, string[]>) {
        roles ??= {
            [this.owner.address]: [
                $contract.keccak256('PAUSER_ROLE'),
                $contract.keccak256('UPDATER_STRAT_CONFIG_ROLE'),
                $contract.keccak256('UPDATER_FEED_ROLE'),
                $contract.keccak256('RESERVE_MANAGER_ROLE'),
            ]
        };
        for (let account in roles) {
            for (let role of roles[account]) {
                await this.ensureRole(role, account as TEth.Address);
            }
        }
    }

    async ensureNeutrlTranches(cdo: StrataCDO) {
        const { NUSD } = await this.ensureNeutrl();

        const acm = await this.ensureACM();
        const info = this.neutrlInfo;
        let { contract: jrtVault } = await this.ds.ensureWithProxy(Tranche, {
            arguments: [false],
            id: 'NUSDJrt',
            initialize: [
                this.owner.address,
                acm.address,
                info.jrt.name,
                info.jrt.symbol,
                NUSD.address,
                cdo.address,
            ]
        });
        let { contract: srtVault } = await this.ds.ensureWithProxy(Tranche, {
            arguments: [false],
            id: 'NUSDSrt',
            initialize: [
                this.owner.address,
                acm.address,
                info.srt.name,
                info.srt.symbol,
                NUSD.address,
                cdo.address,
            ]
        });

        return {
            jrtVault: jrtVault as Tranche & IERC4626,
            srtVault: srtVault as Tranche & IERC4626,
        };
    }

    @memd.deco.memoize()
    async ensureCooldowns(cdo?: StrataCDO) {
        const acm = await this.ensureACM();
        const { contract: erc20Cooldown } = await this.ds.ensureWithProxy(ERC20Cooldown, {
            initialize: [
                this.owner.address,
                acm.address
            ]
        });
        const { contract: unstakeCooldown } = await this.ds.ensureWithProxy(UnstakeCooldown, {
            initialize: [
                this.owner.address,
                acm.address
            ]
        });
        const { contract: sharesCooldown } = await this.ds.ensureWithProxy(SharesCooldown, {
            initialize: [
                this.owner.address,
                acm.address
            ]
        });

        let { sNUSD } = await this.ensureNeutrl();
        const { contractBeaconProxy: sNUSDCooldownRequestImpl } = await this.ds.ensureWithBeacon(SNUSDCooldownRequestImpl, {
            id: 'SNUSDCooldownRequestBeacon',
            arguments: [sNUSD.address],
            initialize: [$address.ZERO, $address.ZERO]
        });

        await this.ds.configure(unstakeCooldown, {
            shouldUpdate: async () => {
                let impl = await unstakeCooldown.implementations(sNUSD.address);
                return $address.eq(impl, sNUSDCooldownRequestImpl.address) === false
            },
            updater: async () => {
                await unstakeCooldown.$receipt().setImplementations(this.owner, [sNUSD.address], [sNUSDCooldownRequestImpl.address]);
            }
        });

        if (cdo != null) {
            await this.ds.configure(cdo, {
                shouldUpdate: $address.eq(await cdo.sharesCooldown(), sharesCooldown.address) === false,
                updater: async () => {
                    await cdo.$receipt().setSharesCooldown(this.owner, sharesCooldown.address);
                }
            });
        }

        return {
            erc20Cooldown,
            unstakeCooldown,
            sharesCooldown,
            acm,
        };
    }

    async ensureFeeds() {
        const acm = await this.ensureACM();
        const { sNUSD, USDe, sUSDe } = await this.ensureNeutrl();

        const { contract: sNUSDAprPairProvider } = await this.ds.ensure(SNUSDAprPairProvider, {
            arguments: [
                sUSDe.address,
                sNUSD.address,
            ]
        });

        const stalePeriodAfter = $date.parseTimespan(this.platform.Feed.stalePeriodAfter, { get: 's' });
        const { contract: feed } = await this.ds.ensureWithProxy(AprPairFeed, {
            id: 'sNUSDAprFeeds',
            initialize: [
                this.owner.address,
                acm.address,
                sNUSDAprPairProvider.address,
                BigInt(stalePeriodAfter),
                "Neutrl CDO APR Pair"
            ]
        });

        await this.ds.configure(feed, {
            title: 'Update AprPair Feed Provider',
            shouldUpdate: async () => {
                let providerAddress = await feed.provider();
                return !$address.eq(providerAddress, sNUSDAprPairProvider.address);
            },
            updater: async () => {
                await feed.$receipt().setProvider(this.owner, sNUSDAprPairProvider.address)
            }
        });

        return {
            feed,
            sNUSDAprPairProvider,
        };
    }

    @memd.deco.memoize()
    async ensureNeutrlCDO() {
        const { NUSD, sNUSD } = await this.ensureNeutrl();

        const acm = await this.ensureACM();
        const info = this.neutrlInfo;

        const { contract: cdo } = await this.ds.ensureWithProxy(StrataCDO, {
            id: 'NUSDCDO',
            arguments: [],
            initialize: [
                this.owner.address,
                acm.address,
            ]
        });

        // Strategy
        const { erc20Cooldown, unstakeCooldown, sharesCooldown } = await this.ensureCooldowns(cdo);

        const { contract: strategy } = await this.ds.ensureWithProxy(SNUSDStrategy, {
            arguments: [
                sNUSD.address
            ],
            initialize: [
                this.owner.address,
                acm.address,
                cdo.address,
                erc20Cooldown.address,
                unstakeCooldown.address
            ]
        });
        await this.ensureRole(await erc20Cooldown.COOLDOWN_WORKER_ROLE(), strategy.address)

        // Accounting
        const accounting = await this.ensureAccounting(cdo.address);

        // Oracle
        const { feed, sNUSDAprPairProvider } = await this.ensureFeeds();

        const { jrtVault, srtVault } = await this.ensureNeutrlTranches(cdo);

        await this.ds.configure(cdo, {
            shouldUpdate: async () => $address.eq(await cdo.strategy(), $address.ZERO),
            updater: async (x, value) => {
                await cdo.$receipt().configure(
                    this.owner,
                    accounting.address,
                    strategy.address,
                    jrtVault.address,
                    srtVault.address
                );
            },
        });

        const output = {
            acm,
            jrtVault,
            srtVault,
            cdo,
            strategy,
            accounting,
            erc20Cooldown,
            unstakeCooldown,
            sharesCooldown,
            feed,
            NUSD,
            sNUSD,
            sNUSDAprPairProvider,
        };

        await this.configure(info, output);
        return output;
    }

    async ensureAccounting(cdo: TEth.Address) {
        const acm = await this.ensureACM();
        const { feed } = await this.ensureFeeds();
        const { contract: accounting } = await this.ds.ensureWithProxy(Accounting, {
            id: `NUSDAccounting`,
            initialize: [
                this.owner.address,
                acm.address,
                cdo,
                feed.address,
            ]
        });
        return accounting;
    }

    async configure(info: typeof Tranches['neutrl'], contracts: {
        acm: AccessControlManager,
        jrtVault: Tranche,
        srtVault: Tranche,
        cdo: StrataCDO,
        strategy: SNUSDStrategy,
        accounting: Accounting,
        feed: AprPairFeed
    }) {

        let {
            acm,
            jrtVault,
            srtVault,
            cdo,
            strategy,
            accounting,
            feed,
        } = contracts;

        await this.addRoles();

        await this.ensureRole($contract.keccak256('UPDATER_CDO_APR_ROLE'), feed.address);
        await this.setCooldown(strategy, info);

        await this.setTrancheActions(cdo, jrtVault, info, 'jrt');
        await this.setTrancheActions(cdo, srtVault, info, 'srt');
    }

    async ensureDepositor() {
        let acm = await this.ensureACM();
        let {  } = await this.ensureNeutrl();
        let { cdo, jrtVault, NUSD } = await this.ensureNeutrlCDO();
        let { contract: depositor } = await this.ds.ensureWithProxy(TrancheDepositor, {
            id: 'TrancheDepositorV3',
            initialize: [
                this.owner.address,
                acm.address
            ]
        });

        await this.ensureRole($contract.keccak256('DEPOSITOR_CONFIG_ROLE'), this.owner.address);

        let status = await depositor.tranches(jrtVault.address, NUSD.address);
        if (status == false) {
            await depositor.$receipt().addCdo(this.owner, cdo.address);
        }

        const NUSD_ROUTER = '0xa052883ebEe7354FC2Aa0f9c727E657FdeCa744a';
        let { contract: swapAdapter } = await this.ds.ensure(SNUSDSwapAdapter, {
            arguments: [
                Addresses.eth.NUSD,
                NUSD_ROUTER
            ]
        });

        const TOKENS = [
            Addresses.eth.USDC,
            Addresses.eth.USDT,
            Addresses.eth.USDe,
        ];

        await this.ds.configure(swapAdapter, {
            shouldUpdate: async () => {
                let result = await depositor.trancheAutoSwaps(jrtVault.address, TOKENS[0])
                return $address.isEmpty(result.router) === false
            },
            updater: async () => {
                for (let token of TOKENS) {
                    await depositor.$receipt().addCdoAutoSwap(this.owner, cdo.address, token, {
                        router: swapAdapter.address,
                        minimumReturnPercentage: 0,
                        fee: 0,
                    });
                }
            }
        });

        return depositor;
    }

    async setTrancheActions(cdo: StrataCDO, tranche: Tranche, info: typeof Tranches['neutrl'], type: 'srt' | 'jrt') {
        let actions = type === 'jrt'
            ? await cdo.actionsJrt()
            : await cdo.actionsSrt();

        let current = type === 'jrt'
            ? info.jrt
            : info.srt;

        if (actions.isDepositEnabled !== current.depositsEnabled || actions.isWithdrawEnabled !== current.withdrawalsEnabled) {
            await cdo.$receipt().setActionStates(
                this.owner,
                tranche.address,
                current.depositsEnabled,
                current.withdrawalsEnabled,
            );
        }
    }

    async setCooldown(strategy: SNUSDStrategy, info: typeof Tranches['neutrl']) {
        let cooldowns = [info.jrt.sUSDeCooldown, info.srt.sUSDeCooldown]
            .map(mix => {
                if (typeof mix === 'string') {
                    return $date.parseTimespan(mix, { get: 's' });
                }
                return mix;
            })
            .map(BigInt);

        let current = await Promise.all([
            await strategy.sNUSDCooldownJrt(),
            await strategy.sNUSDCooldownSrt(),
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

    public isTestnet() {
        return this.client.platform !== 'eth';
    }
}
