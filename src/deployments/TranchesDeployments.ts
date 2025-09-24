import memd from 'memd';
import { AccessControlManager } from '@0xc/hardhat/AccessControlManager/AccessControlManager'
import { MockStakedUSDe } from '@0xc/hardhat/MockStakedUSDe/MockStakedUSDe'
import { MockUSDe } from '@0xc/hardhat/MockUSDe/MockUSDe'
import { Tranche } from '@0xc/hardhat/Tranche/Tranche'
import { Web3Client } from 'dequanto/clients/Web3Client'
import { Deployments } from 'dequanto/contracts/deploy/Deployments'
import { TEth } from 'dequanto/models/TEth'
import { Platforms } from '../platforms/Platforms'
import { IPlatform } from '../platforms/IPlatform'
import { $require } from 'dequanto/utils/$require'
import { SUSDeStrategy } from '@0xc/hardhat/sUSDeStrategy/sUSDeStrategy'
import { StrataCDO } from '@0xc/hardhat/StrataCDO/StrataCDO'
import { ERC20Cooldown } from '@0xc/hardhat/ERC20Cooldown/ERC20Cooldown'
import { UnstakeCooldown } from '@0xc/hardhat/UnstakeCooldown/UnstakeCooldown'
import { Accounting } from '@0xc/hardhat/Accounting/Accounting'
import { Tranches } from '../platforms/Tranches'
import { $address } from 'dequanto/utils/$address'
import { IERC4626 } from 'dequanto/prebuilt/openzeppelin/IERC4626'
import { $contract } from 'dequanto/utils/$contract'
import { SUSDeCooldownRequestImpl } from '@0xc/hardhat/sUSDeCooldownRequestImpl/sUSDeCooldownRequestImpl';
import { $date } from 'dequanto/utils/$date';
import { AprPairFeed } from '@0xc/hardhat/AprPairFeed/AprPairFeed';
import { SUSDeAprPairProvider } from '@0xc/hardhat/sUSDeAprPairProvider/sUSDeAprPairProvider';
import { MockStakedUSDS } from '@0xc/hardhat/MockStakedUSDS/MockStakedUSDS';


export class TranchesDeployments {

    ds: Deployments
    platform: IPlatform
    owner: TEth.EoAccount
    deployer: TEth.EoAccount

    constructor (params: {
        client: Web3Client
        deployer: TEth.EoAccount
    }) {
        this.deployer = params.deployer;
        this.ds = new Deployments(params.client, params.deployer, {});
        this.platform = Platforms[params.client.platform];
        this.owner = params.deployer;
    }

    @memd.deco.memoize()
    async ensureEthena () {
        let platform = this.ds.client.platform;;
        if (platform === 'hardhat') {
            let USDe = await this.ds.ensureContract(MockUSDe);
            let sUSDe = await this.ds.ensureContract(MockStakedUSDe, {
                arguments: [
                    USDe.address,
                    this.owner.address,
                    this.owner.address
                ]
            });
            let sUSDs = await this.ds.ensureContract(MockStakedUSDS, {
                arguments: [
                    USDe.address,
                ]
            });
            await sUSDe.$receipt().setCooldownDuration(this.owner, $date.parseTimespan('1week', { get: 's' }));

            return { USDe, sUSDe, sUSDs };
        }

        let USDeAddress = $require.Address(this.platform.Tokens['USDe'].address);
        let sUSDeAddress = $require.Address(this.platform.Tokens['sUSDe'].address);
        let sUSDsAddress = $require.Address(this.platform.Tokens['sUSDs'].address);
        return {
            USDe: new MockUSDe (USDeAddress, this.ds.client),
            sUSDe: new MockStakedUSDe(sUSDeAddress, this.ds.client),
            sUSDs: new MockStakedUSDS(sUSDsAddress, this.ds.client)
        };
    }

    @memd.deco.memoize()
    async ensureACM () {
        const owner = this.ds.deployer.address!;
        return this.ds.ensureContract(AccessControlManager, {
            arguments: [ owner ]
        });
    }

    async addRoles () {
        const acm = await this.ensureACM();
        let roles = {
            [this.owner.address]: [
                $contract.keccak256('PAUSER_ROLE'),
                $contract.keccak256('UPDATER_STRAT_CONFIG_ROLE'),
                $contract.keccak256('UPDATER_FEED_ROLE'),
                $contract.keccak256('RESERVE_MANAGER_ROLE'),
            ]
        };
        for (let account in roles) {
            for (let role of roles[account]) {
                await acm.$receipt().grantRole(this.owner, role, account as TEth.Address);
            }
        }
    }

    async ensureEthenaTranches (cdo: StrataCDO) {
        const { USDe, sUSDe } = await this.ensureEthena();

        const acm = await this.ensureACM();
        const info = Tranches.ethena;
        let { contract: jrtVault } = await this.ds.ensureWithProxy(Tranche, {
            id: 'USDeJrt',
            initialize: [
                this.owner.address,
                acm.address,
                info.jrt.name,
                info.jrt.description,
                USDe.address,
                cdo.address,
            ]
        });
        let { contract: srtVault } = await this.ds.ensureWithProxy(Tranche, {
            id: 'USDeSrt',
            initialize: [
                this.owner.address,
                acm.address,
                info.srt.name,
                info.srt.description,
                USDe.address,
                cdo.address,
            ]
        });

        return {
            jrtVault: jrtVault as Tranche & IERC4626,
            srtVault: srtVault as Tranche & IERC4626,
        };
    }

    @memd.deco.memoize()
    async ensureCooldowns () {
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

        let { sUSDe } = await this.ensureEthena();
        const { contract: sUSDeCooldownRequestImpl } = await this.ds.ensure(SUSDeCooldownRequestImpl, {
            arguments: [ sUSDe.address ]
        });

        await this.ds.configure(unstakeCooldown, {
            shouldUpdate: async () => {
                let impl = await unstakeCooldown.implementations(sUSDe.address);
                return $address.eq(impl, sUSDeCooldownRequestImpl.address) === false
            },
            updater: async () => {
                await unstakeCooldown.$receipt().setImplementations(this.owner, [sUSDe.address], [sUSDeCooldownRequestImpl.address]);
            }
        });

        return {
            erc20Cooldown,
            unstakeCooldown,
            acm,
        };
    }

    async ensureFeeds () {
        const acm  = await this.ensureACM();
        const { sUSDe, USDe, sUSDs } = await this.ensureEthena();
        const { contract: sUSDeAprPairProvider } = await this.ds.ensure(SUSDeAprPairProvider, {
            arguments: [
                sUSDs.address,
                sUSDe.address,
            ]
        });
        const stalePeriodAfter =  $date.parseTimespan(this.platform.Feed.stalePeriodAfter, { get: 's' });
        const { contract: feed } = await this.ds.ensureWithProxy(AprPairFeed, {
            id: 'sUSDeAprFeeds',
            initialize: [
                this.owner.address,
                acm.address,
                sUSDeAprPairProvider.address,
                BigInt(stalePeriodAfter),
                "Ethena CDO APR Pair"
            ]
        });
        return {
            feed,
            sUSDeAprPairProvider,
        };
    }

    @memd.deco.memoize()
    async ensureEthenaCDO () {
        const { USDe, sUSDe } = await this.ensureEthena();

        const acm = await this.ensureACM();
        const info = Tranches.ethena;

        const { contract: cdo } = await this.ds.ensureWithProxy(StrataCDO, {
            id: 'USDeCDO',
            arguments: [ ],
            initialize: [
                this.owner.address,
                acm.address,
            ]
        });

        // Strategy
        const { erc20Cooldown, unstakeCooldown } = await this.ensureCooldowns();

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
        await acm.grantRole(this.owner, await erc20Cooldown.COOLDOWN_WORKER_ROLE(), strategy.address);

        // Accounting
        const accounting = await this.ensureAccounting(cdo.address);

        // Oracle
        const { feed } = await this.ensureFeeds();


        const { jrtVault, srtVault } = await this.ensureEthenaTranches(cdo);

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
            feed,
            USDe,
            sUSDe
        };

        await this.configure(info, output);
        return output;
    }

    async ensureAccounting (cdo: TEth.Address) {
        const acm = await this.ensureACM();
        const { feed } = await this.ensureFeeds();
        const { contract: accounting } = await this.ds.ensureWithProxy(Accounting, {
            id: `USDeAccounting`,
            initialize: [
                this.owner.address,
                acm.address,
                cdo,
                feed.address,
            ]
        });
        return accounting;
    }

    async configure (info: typeof Tranches['ethena'], contracts: {
        acm: AccessControlManager,
        jrtVault: Tranche,
        srtVault: Tranche,
        cdo: StrataCDO,
        strategy: SUSDeStrategy,
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

        $require.eq(this.ds.client.platform, 'hardhat', 'Mainnet configuration must be set atomic via multisig');

        await this.addRoles();

        await acm.$receipt().grantRole(this.owner, $contract.keccak256('UPDATER_CDO_APR_ROLE'), feed.address);

        await this.setCooldown(strategy, info);
        await this.setTrancheActions(cdo, jrtVault, info, 'jrt');
        await this.setTrancheActions(cdo, srtVault, info, 'srt');
    }

    async setTrancheActions (cdo: StrataCDO, tranche: Tranche, info: typeof Tranches['ethena'], type: 'srt' | 'jrt') {
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

    async setCooldown (strategy: SUSDeStrategy, info: typeof Tranches['ethena']) {
        let cooldowns = [ info.jrt.sUSDeCooldown, info.srt.sUSDeCooldown]
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
}
