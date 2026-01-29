export const Tranches = {
    'ethena': {
        base: 'USDe',
        jrt: {
            symbol: 'jrUSDe',
            name: 'Strata Junior USDe',
            depositsEnabled: true,
            withdrawalsEnabled: true,
            sUSDeCooldown: '7days'
        },
        srt: {
            symbol: 'srUSDe',
            name: 'Strata Senior USDe',
            depositsEnabled: true,
            withdrawalsEnabled: true,
            sUSDeCooldown: 0
        }
    },
    'neutrl': {
        base: 'NUSD',
        jrt: {
            symbol: 'jrNUSD',
            name: 'Neutrl Junior NUSD',
            depositsEnabled: true,
            withdrawalsEnabled: true,
            sUSDeCooldown: '7days'
        },
        srt: {
            symbol: 'srNUSD',
            name: 'Neutrl Senior NUSD',
            depositsEnabled: true,
            withdrawalsEnabled: true,
            sUSDeCooldown: 0
        }
    }
}
