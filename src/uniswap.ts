/**
 * Commands related to Uniswap interaction.
 */

import { Provider } from "@ethersproject/providers";

import {
  BalancesStore as LiquidityBalancesStore,
  printAllPoolLiquidityEvents,
} from "./uniswap/liquidity";
import { PriceStore } from "./binance";

export interface Config {
  binanceSymbol: string;
  exchangeLaunchTime: Date;

  /*
   * TODO Read `swapPool` slot of the exchange to determine the pool to query.  At the moment this
   * field is ignored and `uniswapPoolAddresses` is used.
   */
  exchangeAddress: string | undefined;
  uniswapPoolAddress: string;
  liquidityStatsStartBlock: number;
}

const CONFIGURATIONS: {
  [network: string]: Config;
} = {
  rinkeby: {
    binanceSymbol: "ETHUSDC",
    exchangeLaunchTime: new Date("2021-10-13T09:00:00-07:00"),

    exchangeAddress: undefined,
    // uniswapPoolAddress: "0xfbDc20aEFB98a2dD3842023f21D17004eAefbe68",
    uniswapPoolAddress: "0x7e7269696356Efd9d8a94F5B0aD967Dad752e50d",

    // "Jun-04-2021 12:19:14 PM +UTC" - first interaction with the `uniswapPoolAddress` contract.
    liquidityStatsStartBlock: 8704879,
  },

  arbitrum_rinkeby: {
    binanceSymbol: "ETHUSDC",
    exchangeLaunchTime: new Date("2021-10-13T09:00:00-07:00"),

    exchangeAddress: "0xfcD6da3Ea74309905Baa5F3BAbDdE630FccCcBD1",
    uniswapPoolAddress: "0x8491763F3d9d6BF114dE2Ca82A65D7975590A693",

    // "Oct-05-2021 10:22:37 PM +UTC" - first interaction with the `uniswapPoolAddress` contract.
    liquidityStatsStartBlock: 5273636,
  },

  arbitrum_mainnet: {
    binanceSymbol: "ETHUSDC",
    exchangeLaunchTime: new Date("2021-10-13T09:00:00-07:00"),

    exchangeAddress: "0xF7CA7384cc6619866749955065f17beDD3ED80bC",
    uniswapPoolAddress: "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443",

    // "Jul-12-2021 08:43:45 PM +UTC" - first transaction in the `uniswapPoolAddresses` pool above.
    liquidityStatsStartBlock: 100909,
  },
};

export const configForNetwork = (network: string): Config => {
  const lcNetwork = network.toLowerCase();
  const config = CONFIGURATIONS[lcNetwork];

  if (lcNetwork === "mainnet") {
    throw new Error(
      "Mainnet is not supported at the moment." +
        "  There is no mainnet deployment and the Uniswap pool address is not defined."
    );
  }

  if (config !== undefined) {
    return config;
  } else {
    throw new Error(
      'Supported networks: "' +
        Object.keys(CONFIGURATIONS).join('", "') +
        '".\n' +
        `  Got: ${network}`
    );
  }
};

export const updateBinancePrices = async (
  config: Config,
  storePath: string
) => {
  const { binanceSymbol, exchangeLaunchTime } = config;

  const store = await PriceStore.load(storePath, exchangeLaunchTime);

  await store.update(binanceSymbol, exchangeLaunchTime);
  await store.save(storePath);
};

export const updateLiquidityBalances = async (
  provider: Provider,
  config: Config,
  storePath: string
) => {
  const { uniswapPoolAddress, liquidityStatsStartBlock } = config;

  const store = await LiquidityBalancesStore.load(
    storePath,
    liquidityStatsStartBlock,
    uniswapPoolAddress
  );

  await store.update(provider, liquidityStatsStartBlock, uniswapPoolAddress);
  await store.save(storePath);
};

export const printPoolLiquidityEvents = async (
  provider: Provider,
  config: Config,
  firstBlock: number | null,
  lastBlock: number | null
) => {
  const { uniswapPoolAddress, liquidityStatsStartBlock } = config;

  await printAllPoolLiquidityEvents(
    provider,
    firstBlock === null ? liquidityStatsStartBlock : firstBlock,
    lastBlock,
    uniswapPoolAddress
  );
};
