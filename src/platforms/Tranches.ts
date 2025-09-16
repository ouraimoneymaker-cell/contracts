export const Tranches = {
    'ethena': {
        base: 'USDe',
        jrt: {
            name: 'JRT',
            description: 'Junior Tranch',
            depositsEnabled: true,
            withdrawalsEnabled: true,
            sUSDeCooldown: '7days'
        },
        srt: {
            name: 'SRT',
            description: 'Senior Tranch',
            depositsEnabled: true,
            withdrawalsEnabled: true,
            sUSDeCooldown: 0
        }
    }
}
