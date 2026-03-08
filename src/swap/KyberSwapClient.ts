import { IAccount } from "dequanto/models/TAccount";
import { AggregatorDomain, ChainName, NUSD, Token, USDC } from "./libs/constants";

export interface SwapRoute {
  routeSummary: any;
}

export interface SwapCalldata {
  routerAddress: string;
  encodedData: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  sender: string;
  recipient: string;
  routeSummary: any;
}

export interface SwapParams {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  slippageTolerance: number;
  sender?: string;
  recipient?: string;
}

export interface BuildSwapCalldataParams {
  routeSummary: any;
  slippageTolerance: number;
  sender?: string;
  recipient?: string;
}

/**
 * Client for the KyberSwap Aggregator API.
 * Builds swap routes and encodes calldata that can be passed directly
 * to KyberSwapAdapter / Strategy.executeSwap on-chain.
 */
export class KyberSwapClient {
  private readonly chain: ChainName;
  private readonly account?: IAccount;

  constructor(chain: ChainName, account?: IAccount) {
    this.chain = chain;
    this.account = account;
  }

  async getRoute(tokenIn: Token, tokenOut: Token, amountIn: bigint): Promise<SwapRoute> {
    const path = `/${this.chain}/api/v1/routes`;
    const url = new URL(path, AggregatorDomain);
    url.searchParams.set("tokenIn", tokenIn.address);
    url.searchParams.set("tokenOut", tokenOut.address);
    url.searchParams.set("amountIn", amountIn.toString());

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Kyber route request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as { data: SwapRoute };
    return body.data;
  }

  async buildSwapCalldata(params: BuildSwapCalldataParams): Promise<SwapCalldata> {
    const path = `/${this.chain}/api/v1/route/build`;
    const sender = await this.resolveAddress(params.sender);
    const recipient = params.recipient ?? sender;

    const response = await fetch(new URL(path, AggregatorDomain).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeSummary: params.routeSummary,
        sender,
        recipient,
        slippageTolerance: params.slippageTolerance,
      }),
    });
    if (!response.ok) {
      throw new Error(`Kyber build request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as { data: { routerAddress: string; data: string } };

    return {
      routerAddress: body.data.routerAddress,
      encodedData: body.data.data,
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
  async getSwapCalldata(params: SwapParams): Promise<SwapCalldata> {
    const route = await this.getRoute(params.tokenIn, params.tokenOut, params.amountIn);
    return this.buildSwapCalldata({
      routeSummary: route.routeSummary,
      slippageTolerance: params.slippageTolerance,
      sender: params.sender,
      recipient: params.recipient,
    });
  }

  private async resolveAddress(address?: string): Promise<string> {
    if (address) {
      return address;
    }

    if (!this.account?.address) {
      throw new Error("sender is required when no dequanto account is configured");
    }

    return this.account.address;
  }
}

async function main() {
  const sender = "0xD6cC5015F816575C606D972C4A4aD0b3E0E50440";
  const client = new KyberSwapClient(ChainName.MAINNET);

  const result = await client.getSwapCalldata({
    tokenIn: NUSD,
    tokenOut: USDC,
    amountIn: 25n * 10n ** 18n,
    slippageTolerance: 10,
    sender,
    recipient: sender,
  });

  console.log(result);
}

main().catch(console.error);

