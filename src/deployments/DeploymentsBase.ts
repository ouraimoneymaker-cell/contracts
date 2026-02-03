import alot from 'alot';
import memd from 'memd';
import { AccessControlManager } from '@0xc/hardhat/AccessControlManager/AccessControlManager'
import { MockUSDe } from '@0xc/hardhat/MockUSDe/MockUSDe'
import { Tranche } from '@0xc/hardhat/Tranche/Tranche'
import { Web3Client } from 'dequanto/clients/Web3Client'
import { Deployments } from 'dequanto/contracts/deploy/Deployments'
import { TEth } from 'dequanto/models/TEth'
import { Platforms } from '../platforms/Platforms'
import { IPlatform, IPlatformAccounts } from '../platforms/IPlatform'
import { $require } from 'dequanto/utils/$require'
import { StrataCDO } from '@0xc/hardhat/StrataCDO/StrataCDO'
import { ERC20Cooldown } from '@0xc/hardhat/ERC20Cooldown/ERC20Cooldown'
import { UnstakeCooldown } from '@0xc/hardhat/UnstakeCooldown/UnstakeCooldown'
import { Accounting } from '@0xc/hardhat/Accounting/Accounting'
import { ContractsIDMapping, ContractsPrefixMapping, ICDO, TCDOKey, Tranches } from '../platforms/Tranches'
import { $address } from 'dequanto/utils/$address'
import { IERC4626 } from 'dequanto/prebuilt/openzeppelin/IERC4626'
import { $contract } from 'dequanto/utils/$contract'
import { $date } from 'dequanto/utils/$date';
import { AprPairFeed } from '@0xc/hardhat/AprPairFeed/AprPairFeed';
import { SUSDeAprPairProvider } from '@0xc/hardhat/sUSDeAprPairProvider/sUSDeAprPairProvider';
import { $erc4626 } from '../../test/tranches/utils/$erc4626';
import { TrancheDepositor } from '@0xc/hardhat/TrancheDepositor/TrancheDepositor';
import { SafeTx } from 'dequanto/safe/SafeTx';
import { InMemoryServiceTransport } from 'dequanto/safe/transport/InMemoryServiceTransport';
import { l } from 'dequanto/utils/$logger';
import { CDOLens } from '@0xc/hardhat/CDOLens/CDOLens';
import { TwoStepConfigManager } from '@0xc/hardhat/TwoStepConfigManager/TwoStepConfigManager';
import { ContractBase } from 'dequanto/contracts/ContractBase';
import { Constructor } from 'dequanto/utils/types';
import { SharesCooldown } from '@0xc/hardhat/SharesCooldown/SharesCooldown';
import { IStrategy } from '@0xc/hardhat/IStrategy/IStrategy';
import { SafeAccount } from 'dequanto/models/TAccount';
import { IBeaconProxy } from 'dequanto/contracts/deploy/proxy/ProxyDeployment';
import { $bigint } from 'dequanto/utils/$bigint';
import { $exitMode } from '@s/utils/$exitMode';
import { SUSDeStrategy } from '@0xc/hardhat/sUSDeStrategy/sUSDeStrategy';


export interface ICdoDeploymentsBase {
    Tokens
    Strategy
}

export type TDeploymentContracts<T extends ICdoDeploymentsBase = any> = {
    acm: AccessControlManager
    jrtVault: Tranche
    srtVault: Tranche
    cdo: StrataCDO
    strategy: SUSDeStrategy
    accounting: Accounting
    erc20Cooldown: ERC20Cooldown
    unstakeCooldown: UnstakeCooldown
    sharesCooldown: SharesCooldown
    feed: AprPairFeed
    provider: SUSDeAprPairProvider
    depositor: TrancheDepositor
    configManager: TwoStepConfigManager
} & T['Tokens']

export abstract class DeploymentsBase<T extends ICdoDeploymentsBase = any> {

    ds: Deployments
    platform: IPlatform
    owner: TEth.IAccount
    deployer: TEth.EoAccount
    client: Web3Client
    cdoInfo: ICDO;

    accounts: IPlatformAccounts

    protected pfx: string;

    constructor(params: {
        cdo: TCDOKey
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
        this.pfx = $require.notNull(ContractsPrefixMapping[params.cdo], `No contract prefix for ${params.cdo} found`);

        this.ds = new Deployments(params.client, params.deployer, {
            directory: './deployments/',
            whenBytecodeChanged: params.deployments ?? (this.isTestnet() ? null : 'throw'),
            fork: params.client.forked?.platform
        });

        let info = JSON.parse(JSON.stringify(Tranches[params.cdo])) as ICDO;

        if (this.platform.Tranches?.ethena) {
            info.jrt = { ...info.jrt, ...(this.platform.Tranches?.[params.cdo]?.jrt ?? {}) } as any;
            info.srt = { ...info.srt, ...(this.platform.Tranches?.[params.cdo]?.srt ?? {}) } as any;
        }
        this.cdoInfo = info;
    }

    abstract ensureFeedProvider(): Promise<{ provider: any }>;
    abstract ensureUnderlying(): Promise<{ base: MockUSDe } & T['Tokens']>
    protected abstract ensureUnstakeImplemenetations(
    ): Promise<{
        token: TEth.Address
        impl: IBeaconProxy
    }[]>

    protected abstract ensureStrategy(
        cdo: StrataCDO,
        acm: AccessControlManager,
        erc20Cooldown: ERC20Cooldown,
        unstakeCooldown: UnstakeCooldown,
    ): Promise<{
        strategy: T['Strategy']
    }>

    abstract configureCooldowns (strategy: IStrategy): Promise<void>

    abstract configureDepositor(depositor: TrancheDepositor);


    async get<T extends ContractBase>(Ctor: Constructor<T>, params?: { id?: 'jrUSDe' | 'srUSDe', cdo?: 'USDe' }) {
        if (params?.id != null) {
            const id = ContractsIDMapping[params.id] ?? params.id;
            return await this.ds.get(Ctor, { id })
        }
        let all = await this.ds.store.getDeployments();
        let byName = all.filter(d => d.name === Ctor.name);
        $require.gt(byName.length, 0, `${Ctor.name} not found in deployments`);

        if (byName.length === 1) {
            return await this.ds.get(Ctor, { id: byName[0].id });
        }
        let cdo = params?.cdo ?? this.pfx;
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

    @memd.deco.memoize({ perInstance: true })
    async ensureACM() {
        const owner = this.owner!;
        const acm = await this.ds.ensureContract(AccessControlManager, {
            id: this.getContractId('AccessControlManager'),
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
        console.log(`>> EnsureRole`, acm.address, 'Account', account, 'Role', role);
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
                l`gray<EnsureRole>: cyan<${role}> ${has ? '🟢' : '🔴'} cyan<${address}> ⌛`;
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


     async ensureTranches(cdo: StrataCDO) {
        const { base } = await this.ensureUnderlying();

        const acm = await this.ensureACM();
        const info = this.cdoInfo;
        let { contract: jrtVault } = await this.ds.ensureWithProxy(Tranche, {
            id: `${this.pfx}Jrt`,
            initialize: [
                this.owner.address,
                acm.address,
                info.jrt.name,
                info.jrt.symbol,
                base.address,
                cdo.address,
            ]
        });
        let { contract: srtVault } = await this.ds.ensureWithProxy(Tranche, {
            id: `${this.pfx}Srt`,
            initialize: [
                this.owner.address,
                acm.address,
                info.srt.name,
                info.srt.symbol,
                base.address,
                cdo.address,
            ]
        });

        return {
            jrtVault: jrtVault as Tranche & IERC4626,
            srtVault: srtVault as Tranche & IERC4626,
        };
    }

    async ensureConfigManager() {
        let { cdo, sharesCooldown } = await this.ensureCDO();
        let owner = this.accounts.timelock.admin;
        let { contract: configManager } = await this.ds.ensureWithProxy(TwoStepConfigManager, {
            id: `${this.pfx}ConfigManager`,
            arguments: [cdo.address],
            initialize: []
        });

        await this.ds.configure(cdo, {
            title: `Set CDO Two-Step Config Manager`,
            async shouldUpdate() {
                return $address.eq(await cdo.twoStepConfigManager(), configManager.address) === false
            },
            async updater() {
                await cdo.$receipt().setTwoStepConfigManager(owner, configManager.address);
            }
        });

        await this.ds.configure(sharesCooldown, {
            title: `Set SharesCooldown Two-Step Config Manager`,
            async shouldUpdate() {
                return $address.eq(await sharesCooldown.twoStepConfigManager(), configManager.address) === false
            },
            async updater() {
                await sharesCooldown.$receipt().setTwoStepConfigManager(owner, configManager.address);
            }
        });

        await this.ensureRoles({
            'PROPOSER_CONFIG_ROLE': {
                [this.accounts.safe.admin.address]: true
            },
            'UPDATER_STRAT_CONFIG_ROLE': {
                [this.accounts.timelock.config.address]: true
            }
        });

        return { configManager };
    }

    @memd.deco.memoize({ perInstance: true  })
    async ensureCooldowns(cdo?: StrataCDO) {
        const acm = await this.ensureACM();
        const { contract: erc20Cooldown } = await this.ds.ensureWithProxy(ERC20Cooldown, {
            id: this.getContractId('ERC20Cooldown'),
            initialize: [
                this.owner.address,
                acm.address
            ]
        });
        const { contract: unstakeCooldown } = await this.ds.ensureWithProxy(UnstakeCooldown, {
            id: this.getContractId('UnstakeCooldown'),
            initialize: [
                this.owner.address,
                acm.address
            ]
        });
        const { contract: sharesCooldown } = await this.ds.ensureWithProxy(SharesCooldown, {
            id: this.getContractId('SharesCooldown'),
            initialize: [
                this.owner.address,
                acm.address
            ]
        });

        let unstakeCooldownsArr = await this.ensureUnstakeImplemenetations();
        let unstakeCooldownsFiltered = await alot(unstakeCooldownsArr)
            .filterAsync(async x => $address.eq(await unstakeCooldown.implementations(x.token), x.impl.address) === false)
            .toArrayAsync();

        await this.ds.configure(unstakeCooldown, {
            shouldUpdate: unstakeCooldownsFiltered.length > 0,
            updater: async () => {
                let tokens = unstakeCooldownsFiltered.map(x => x.token);
                let impls = unstakeCooldownsFiltered.map(x => x.impl.address);
                await unstakeCooldown.$receipt().setImplementations(this.owner, tokens, impls);
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

        const { provider } = await this.ensureFeedProvider();

        const CURRENT_PROVIDER = provider.address;
        const stalePeriodAfter = $date.parseTimespan(this.platform.Feed.stalePeriodAfter, { get: 's' });
        const { contract: feed } = await this.ds.ensureWithProxy(AprPairFeed, {
            id: `${this.pfx}AprFeeds`,
            initialize: [
                this.owner.address,
                acm.address,
                provider.address,
                BigInt(stalePeriodAfter),
                this.cdoInfo.Feed.name ?? "Ethena CDO APR Pair"
            ]
        });

        await this.ds.configure(feed, {
            title: 'Update AprPair Feed Provider',
            shouldUpdate: async () => {
                let providerAddress = await feed.provider();
                return !$address.eq(providerAddress, CURRENT_PROVIDER);
            },
            updater: async () => {
                await feed.$receipt().setProvider(this.owner, CURRENT_PROVIDER)
            }
        });

        return {
            feed,
            provider,
        };
    }

    @memd.deco.memoize({ perInstance: true })
    async ensureCDO() {
        const { base, ...tokens } = await this.ensureUnderlying();

        const acm = await this.ensureACM();
        const info = this.cdoInfo;

        const { contract: cdo } = await this.ds.ensureWithProxy(StrataCDO, {
            id: `${this.pfx}CDO`,
            arguments: [],
            initialize: [
                this.owner.address,
                acm.address,
            ]
        });


        const { erc20Cooldown, unstakeCooldown, sharesCooldown } = await this.ensureCooldowns(cdo);
        const { strategy } = await this.ensureStrategy(cdo, acm, erc20Cooldown, unstakeCooldown);
        await this.ensureRole(this.ROLES.COOLDOWN_WORKER_ROLE, strategy.address);
        await this.ensureRole(this.ROLES.COOLDOWN_WORKER_ROLE, cdo.address);

        // Accounting
        const accounting = await this.ensureAccounting(cdo.address);

        // Oracle
        const { feed, provider } = await this.ensureFeeds();


        const { jrtVault, srtVault } = await this.ensureTranches(cdo);

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
            provider,
            ...tokens,
        };


        await this.setupCdo(output);
        return output;
    }

    async ensureAccounting(cdo: TEth.Address) {
        const acm = await this.ensureACM();
        const { feed } = await this.ensureFeeds();
        const { contract: accounting } = await this.ds.ensureWithProxy(Accounting, {
            id: `${this.pfx}Accounting`,
            initialize: [
                this.owner.address,
                acm.address,
                cdo,
                feed.address,
            ]
        });
        return accounting;
    }

    private async setupCdo(contracts: {
        acm: AccessControlManager,
        jrtVault: Tranche,
        srtVault: Tranche,
        cdo: StrataCDO,
        strategy: IStrategy,
        accounting: Accounting,
        feed: AprPairFeed,
        sharesCooldown: SharesCooldown
    }) {

        let {
            acm,
            jrtVault,
            srtVault,
            cdo,
            strategy,
            accounting,
            feed,
            sharesCooldown,
        } = contracts;

        await this.addRoles();
        await this.ensureRole($contract.keccak256('UPDATER_CDO_APR_ROLE'), feed.address);
        await this.configureCooldowns(strategy);

        await this.ds.configure(accounting, {
            title: `Update Performance (Accounting Reserve BPS) Fee`,
            value: $bigint.toWei(this.cdoInfo.fees?.performanceFee ?? 0, 18),
            current: accounting.reserveBps(),
            updater: async (accounting, value) => {
                await accounting.$receipt().setReserveBps(this.owner, value)
            }
        });

        if (await jrtVault.totalSupply() === 0n) {
            if (this.client.platform === 'eth') {
                await this.initialDepositAtomic({ jrtVault, srtVault, cdo });
            } else if (this.client.network === 'eth') {
                await this.initialDeposit({ jrtVault, srtVault, cdo });
            }
        }


    }

    public async configure(contracts: {
        acm: AccessControlManager,
        jrtVault: Tranche,
        srtVault: Tranche,
        cdo: StrataCDO,
        strategy: IStrategy,
        accounting: Accounting,
        feed: AprPairFeed,
        sharesCooldown: SharesCooldown,
        configManager: TwoStepConfigManager,
        depositor: TrancheDepositor,
    }) {
        let {
            acm,
            jrtVault,
            srtVault,
            cdo,
            strategy,
            accounting,
            feed,
            sharesCooldown,
        } = contracts;

        let info = this.cdoInfo;

        await this._configureFeeRetention(contracts);
        await this._configureExitBounds(contracts);

        await this.setTrancheActions(cdo, jrtVault, info, 'jrt');
        await this.setTrancheActions(cdo, srtVault, info, 'srt');

        return contracts;
    }

    async setTrancheActions(cdo: StrataCDO, tranche: Tranche, info: ICDO, type: 'srt' | 'jrt') {
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

    private async initialDeposit(tranches: { jrtVault: Tranche, srtVault: Tranche, cdo: StrataCDO }) {
        let { base } = await this.ensureUnderlying();
        let { jrtVault, srtVault, cdo } = tranches;

        if (this.owner.type === 'safe') {
            throw new Error(`Mainnet deployment not ready`);
        }
        const AMOUNT = 20n * 10n ** 18n;
        let balance = await base.balanceOf(this.owner.address);
        if (balance < AMOUNT) {
            if (this.client.network === 'hardhat' || this.client.network === 'hoodi') {
                await base.$receipt().mint(this.owner, this.owner.address, AMOUNT * 100n);
            } else {
                throw new Error(`Not enough balance for initial deposit. ${this.owner.address}`);
            }
        }

        await cdo.$receipt().setActionStates(
            this.owner,
            $address.ZERO,
            true,
            false,
        );
        await $erc4626.deposit(jrtVault as any, this.owner, AMOUNT / 2n);
        await $erc4626.deposit(srtVault as any, this.owner, AMOUNT / 2n);
        await cdo.$receipt().setActionStates(
            this.owner,
            $address.ZERO,
            false,
            false,
        );
    }
    private async initialDepositAtomic(tranches: { jrtVault: Tranche, srtVault: Tranche, cdo: StrataCDO }) {
        let { base } = await this.ensureUnderlying();
        let { jrtVault, srtVault, cdo } = tranches;


        const AMOUNT = 40n * 10n ** 18n;
        let balance = await base.balanceOf(this.owner.address);
        if (balance < AMOUNT) {
            throw new Error(`Not enough balance for initial deposit.`);
        }

        const AMOUNT_SRT = AMOUNT / 2n;
        const AMOUNT_JRT = AMOUNT / 2n;

        let actions = [
            await cdo.$data().setActionStates(this.owner, $address.ZERO, true, false),

            await base.$data().approve(this.owner, jrtVault.address, AMOUNT_JRT),
            await jrtVault.$data().deposit(this.owner, AMOUNT_JRT, this.owner.address),

            await base.$data().approve(this.owner, srtVault.address, AMOUNT_SRT),
            await srtVault.$data().deposit(this.owner, AMOUNT_SRT, this.owner.address),

            await cdo.$data().setActionStates(this.owner, $address.ZERO, false, false),

        ];

        $require.match(/safe/i, this.owner.name);
        let safeTx = new SafeTx(this.owner as SafeAccount, this.client, {
            safeTransport: new InMemoryServiceTransport(this.client, this.deployer)
        });

        l`yellow<Execute batch>`
        let tx = await safeTx.executeBatch(
            ...actions
        );
        await tx.wait();
    }

    async ensureDepositor() {
        let acm = await this.ensureACM();
        let { base } = await this.ensureUnderlying();
        let { cdo, jrtVault } = await this.ensureCDO();
        let { contract: depositor } = await this.ds.ensureWithProxy(TrancheDepositor, {
            id: 'TrancheDepositorV3',
            initialize: [
                this.owner.address,
                acm.address
            ]
        });

        await this.ensureRole($contract.keccak256('DEPOSITOR_CONFIG_ROLE'), this.owner.address);

        let status = await depositor.tranches(jrtVault.address, base.address);
        if (status == false) {
            await depositor.$receipt().addCdo(this.owner, cdo.address);
        }

        await this.configureDepositor(depositor);
        return depositor;
    }



    public isTestnet() {
        return this.client.platform !== 'eth';
    }

    async ensureLenses() {
        let { contract: cdoLens } = await this.ds.ensureWithProxy(CDOLens, {
            initialize: [
                this.owner.address
            ]
        });
    }

    private getContractId (name: keyof ICDO['Contracts']['']) {
        const Contracts = this.cdoInfo.Contracts;
        const id = Contracts?.[this.client.network]?.[name]
            ?? Contracts?.['*']?.[name]
            ?? void 0;
        return id;
    }

    private async _configureFeeRetention (contracts: {
        accounting: Accounting
    }) {
        const { accounting } = contracts;
        const FeeRetentionBps = {
            jrt: $bigint.toWei(this.cdoInfo.fees?.retention?.jrt ?? 0, 18),
            srt: $bigint.toWei(this.cdoInfo.fees?.retention?.srt ?? 0, 18),
        }
        await this.ds.configure(accounting, {
            title: `Update Fee Retention Ratios`,
            shouldUpdate: async () => {
                let jrtCurrent = await accounting.feeJrtRetentionBps();
                let srtCurrent = await accounting.feeSrtRetentionBps();
                return jrtCurrent !== FeeRetentionBps.jrt || srtCurrent !== FeeRetentionBps.srt;
            },
            updater: async (accounting, value) => {
                await accounting.$receipt().setFeeRetentionBps(this.owner, FeeRetentionBps.jrt, FeeRetentionBps.srt);
            }
        });
    }

    private async _configureExitBounds (contracts: {
        sharesCooldown: SharesCooldown,
        configManager: TwoStepConfigManager,
        jrtVault: Tranche,
        srtVault: Tranche,
        depositor: TrancheDepositor,
    }) {
        let {
            sharesCooldown,
            configManager,
            jrtVault,
            srtVault,
        } = contracts;

        const { sharesCooldown: jrtExitBounds } = this.cdoInfo.jrt;
        const { sharesCooldown: srtExitBounds } = this.cdoInfo.srt;
        if (jrtExitBounds == null || srtExitBounds == null) {
            l`No exit bounds defined for JRT AND SRT. Skipping...`;
            return;
        }

        const ExitBounds = {
            jrt: $exitMode.map(jrtExitBounds ?? []),
            srt: $exitMode.map(srtExitBounds ?? []),
        };
        await this.ds.configure(sharesCooldown, {
            title: `Update Exit Bounds`,
            shouldUpdate: async () => {
                let jrtCurrent = await sharesCooldown.vaultExitBounds(jrtVault.address);
                let srtCurrent = await sharesCooldown.vaultExitBounds(srtVault.address);
                return $exitMode.eq(jrtCurrent, ExitBounds.jrt) === false
                    || $exitMode.eq(srtCurrent, ExitBounds.srt) === false
            },
            updater: async (sharesCooldown) => {

                const owner = await sharesCooldown.owner();
                const isTest = this.client.platform === 'hardhat';
                if (!isTest) {
                    if ($address.eq(owner, this.owner.address) === false) {
                        l`Unknown owner. Can't configure at this stage`;
                        return;
                    }
                    let isInternal = /(safe\/eth\/owner)|(deployer)/.test(this.owner.name);
                    if (isInternal === false) {
                        l`Settled owner. Can't configure at this stage`;
                        return;
                    }
                }
                const prevTwoStepConfigManager = await sharesCooldown.twoStepConfigManager();
                const shouldSwitchManager = $address.eq(prevTwoStepConfigManager, this.owner.address) === false;
                if (shouldSwitchManager) {
                    await sharesCooldown.$receipt().setTwoStepConfigManager(this.owner, this.owner.address);
                }
                await sharesCooldown.$receipt().setVaultExitBounds(this.owner, jrtVault.address, ExitBounds.jrt);
                await sharesCooldown.$receipt().setVaultExitBounds(this.owner, srtVault.address, ExitBounds.srt);
                if (shouldSwitchManager) {
                    l`Return shares cooldown back`;
                    await sharesCooldown.$receipt().setTwoStepConfigManager(this.owner, prevTwoStepConfigManager);
                }
            }
        });
    }

    public async ensureDeployment (): Promise<TDeploymentContracts<T>> {
        const contracts = await this.ensureCDO();
        const depositor = await this.ensureDepositor();
        const { configManager } = await this.ensureConfigManager();
        const contractsAll = {
            ...contracts,
            depositor,
            configManager,
        };

        await this.configure(contractsAll);
        return contractsAll;
    }

    public ROLES = {
        PAUSER_ROLE: $contract.keccak256("PAUSER_ROLE"),
        UPDATER_CDO_APR_ROLE: $contract.keccak256("UPDATER_CDO_APR_ROLE"),
        UPDATER_FEED_ROLE: $contract.keccak256("UPDATER_FEED_ROLE"),
        UPDATER_STRAT_CONFIG_ROLE: $contract.keccak256("UPDATER_STRAT_CONFIG_ROLE"),
        RESERVE_MANAGER_ROLE: $contract.keccak256("RESERVE_MANAGER_ROLE"),
        COOLDOWN_WORKER_ROLE: $contract.keccak256("COOLDOWN_WORKER_ROLE"),
        PROPOSER_CONFIG_ROLE: $contract.keccak256("PROPOSER_CONFIG_ROLE"),
    };
}
