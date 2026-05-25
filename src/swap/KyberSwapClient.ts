import { IAccount } from "dequanto/models/TAccount";
import { AggregatorDomain, ChainName, Token } from "./libs/constants";
import { TEth } from 'dequanto/models/TEth';
import { $require } from 'dequanto/utils/$require';

interface ISwapCalldata {
    routerAddress: TEth.Address;
    encodedData: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    sender: string;
    recipient: string;
    routeSummary: any;
}

interface ISwapParams {
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    sender?: string;
    recipient?: string;

    routeOptions?: IKyberSwapRouteOptions
    swapOptions?: IKyberSwapCalldataOptions
}

interface IKyberSwapRoute {
    routeSummary: any;
}
interface IKyberSwapRouteOptions {
    onlySinglePath: boolean
    includedSources: string
}
interface IKyberSwapCalldataOptions {
    slippageTolerance: number;
}

/**
 * Client for the KyberSwap Aggregator API.
 * Builds swap routes and encodes calldata that can be passed directly
 * to KyberSwapAdapter / Strategy.executeSwap on-chain.
 *
 * https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification/evm-swaps
 */
export class KyberSwapClient {

    constructor(
        public chain: ChainName = ChainName.MAINNET,
        public account?: IAccount
    ) {

    }

    private async getRoutes(params: {
        tokenIn: Token
        tokenOut: Token
        amountIn: bigint
    }, options: IKyberSwapRouteOptions) {
        type TResponse = {
            routeSummary: any
        }
        const resp = await this.fetch<TResponse>('GET', `routes`, {
            tokenIn: params.tokenIn.address,
            tokenOut: params.tokenOut.address,
            amountIn: params.amountIn.toString(),
            ...(options ?? {})
        });
        return resp;
    }

    private async buildSwapCalldata(params: {
        routeSummary: any;
        sender?: string;
        recipient?: string;
    }, options: IKyberSwapCalldataOptions) {
        const sender = await this.resolveAddress(params.sender);
        const recipient = params.recipient ?? this.account?.address ?? params.sender;

        type TResponse = {
            routerAddress: TEth.Address
            data: string
        };
        const resp = await this.fetch<TResponse>('POST', 'route/build', {
            routeSummary: params.routeSummary,
            sender,
            recipient,
            ...(options ?? {})
        });

        return {
            routerAddress: resp.routerAddress,
            encodedData: resp.data,
            tokenIn: params.routeSummary.tokenIn,
            tokenOut: params.routeSummary.tokenOut,
            amountIn: params.routeSummary.amountIn,
            sender,
            recipient,
            routeSummary: params.routeSummary,
        };
    }

    /**
     * End-to-end helper: fetches the optimal route then encodes the swap
     * calldata ready for on-chain execution.
     */
    async getSwapCalldata(params: ISwapParams): Promise<ISwapCalldata> {
        const route = await this.getRoutes({
                ...params
            },
            params.routeOptions,
        );
        return this.buildSwapCalldata({
            routeSummary: route.routeSummary,
            sender: params.sender,
            recipient: params.recipient,
        }, params.swapOptions);
    }

    private async resolveAddress(address?: string): Promise<string> {
        return $require.Address(
            address ?? this.account.address,
            'Invalid sender address'
        );
    }

    private async fetch<T>(method: 'GET' | 'POST', path: string, params: any) {
        let url = `${AggregatorDomain}/${this.chain}/api/v1/${path}`;
        let body: string | undefined;
        if (method === 'GET') {
            const q = new URLSearchParams(params);
            url += `?${q}`;
        } else if (method === 'POST') {
            body = JSON.stringify(params);
        }

        const response = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "X-Client-Id": "strata"
            },
            body,
        });
        if (!response.ok) {
            throw new Error(`Kyber route request failed: ${response.status} ${response.statusText}`);
        }

        const resp = await response.json() as { data: T };
        return resp.data;
    }
}


