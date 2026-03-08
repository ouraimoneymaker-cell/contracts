export const AggregatorDomain = `https://aggregator-api.kyberswap.com`;

export enum ChainName {
    MAINNET = `ethereum`,
    BSC = `bsc`,
    ARBITRUM = `arbitrum`,
    MATIC = `polygon`,
    OPTIMISM = `optimism`,
    AVAX = `avalanche`,
    BASE = `base`,
    CRONOS = `cronos`,
    ZKSYNC = `zksync`,
    FANTOM = `fantom`,
    LINEA = `linea`,
    POLYGONZKEVM = `polygon-zkevm`,
    AURORA = `aurora`,
    BTTC = `bittorrent`,
    SCROLL = `scroll`,    
}

export enum ChainId {
    MAINNET = 1,
    BSC = 56,
    ARBITRUM = 42161,
    MATIC = 137,
    OPTIMISM = 10,
    AVAX = 43114,
    BASE = 8453,
    CRONOS = 25,
    ZKSYNC = 324,
    FANTOM = 250,
    LINEA = 59144,
    POLYGONZKEVM = 1101,
    AURORA = 1313161554,
    BTTC = 199,
    ZKEVM = 1101,
    SCROLL = 534352,
  };

export interface Token {
    address: string;
    decimals: number;
    symbol?: string;
    name?: string;
}

export const NUSD: Token = {
  address: '0xE556ABa6fe6036275Ec1f87eda296BE72C811BCE',
  decimals: 18,
  symbol: 'NUSD',
  name: 'Neutrl USD',
};

export const USDC: Token = {
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
  symbol: 'USDC',
  name: 'USD Coin',
};