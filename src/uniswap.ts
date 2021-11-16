/**
 * Commands related to Uniswap interaction.
 */

import { Argv } from "yargs";
import { Provider } from "@ethersproject/providers";

import {
  BalancesStore as LiquidityBalancesStore,
  printAllPoolLiquidityEvents,
} from "./uniswap/liquidity";
import { PriceStore } from "./binance";

import {
  incentivesDistribution,
  printIncentivesDistribution,
} from "./uniswap/incentives";

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

export const cli = (
  yargs: Argv,
  initConfig: () => void,
  getProvider: (networkId: string) => Provider
): Argv =>
  yargs
    .command(
      "updatePrices",
      "Fetches prices from Binance and saves them into a local file.",
      (yargs) => {
        return yargs.option("priceStore", {
          alias: "p",
          describe: "File that holds a local cache of Binance prices.",
          type: "string",
          default: "binancePrices.json",
        });
      },
      async (argv) => {
        const { networkId, priceStore } = argv;

        initConfig();
        // TODO For some reason, the compiler does not understand that `argv` here must also
        // have a `networkId` property.  Even though it works in the commands above.  And it
        // works with exactly the same code in a different project.  It would be nice to figure
        // out what is the problem and remove `as string`.
        const config = configForNetwork(networkId as string);

        await updateBinancePrices(config, priceStore);
      }
    )
    .command(
      "printLiquidityEvents",
      "Shows `Mint` and `Burn` events for a Uniswap pool.",
      (yargs) => {
        return yargs
          .option("fromBlock", {
            alias: "f",
            describe:
              "First block to print events for." +
              "  Defaults to some value before the exchange launch.",
            type: "number",
          })
          .option("toBlock", {
            alias: "t",
            describe:
              "Last block to print events for." +
              "  Defaults to the last confirmed block on the chain.",
            type: "number",
          });
      },
      async (argv) => {
        const { networkId, fromBlock, toBlock } = argv;

        initConfig();
        // TODO See comment in the command above as to why `as string` is needed here.
        const provider = getProvider(networkId as string);
        // TODO See comment in the command above as to why `as string` is needed here.
        const config = configForNetwork(networkId as string);

        await printPoolLiquidityEvents(
          provider,
          config,
          fromBlock ?? null,
          toBlock ?? null
        );
      }
    )
    .command(
      "updateLiquidityBalances",
      "Fetches balances from a Uniswap pool and saves them into a local file.",
      (yargs) => {
        return yargs.option("liquidityBalanceStore", {
          alias: "l",
          describe: "File that holds a local cache of the uniswap balances",
          type: "string",
          default: "uniswapLiquidityBalances.json",
        });
      },
      async (argv) => {
        const { networkId, liquidityBalanceStore } = argv;

        initConfig();
        // TODO See comment in the command above as to why `as string` is needed here.
        const provider = getProvider(networkId as string);
        // TODO See comment in the command above as to why `as string` is needed here.
        const config = configForNetwork(networkId as string);

        await updateLiquidityBalances(provider, config, liquidityBalanceStore);
      }
    )
    .command(
      "liquidityIncentivesReport",
      "Computes incentives distribution for the specified range based on the Binance prices" +
        " and Uniswap liquidity balances.",
      (yargs) => {
        return yargs
          .option("priceStore", {
            alias: "p",
            describe: "File that holds a local cache of Binance prices",
            type: "string",
            default: "binancePrices.json",
          })
          .option("liquidityBalanceStore", {
            alias: "l",
            describe: "File that holds a local cache of the uniswap balances",
            type: "string",
            default: "uniswapLiquidityBalances.json",
          })
          .option("rangeStart", {
            alias: "f",
            describe: "Start time for the report",
            type: "string",
          })
          .option("rangeEnd", {
            alias: "t",
            describe: "End time for the report",
            type: "string",
          })
          .option("priceRange", {
            alias: "r",
            describe:
              "Specifies price range for liquidity incentives." +
              "  Incentives are distributed for liquidity in the range between" +
              " `1 - priceRange` and `1 + priceRange`. ",
            type: "number",
            default: "0.025",
          })
          .option("incentives", {
            alias: "i",
            describe:
              "Total number of incentives to be distributed in the specified range.",
            type: "number",
          })
          .option("dustLevel", {
            alias: "d",
            describe:
              "If an account did not accumulate more incentives than this much, it is not" +
              " included in the report.",
            type: "number",
            default: "0.01",
          })
          .demandOption(["rangeStart", "rangeEnd", "incentives"]);
      },
      async (argv) => {
        const {
          networkId,
          priceStore,
          liquidityBalanceStore,
          rangeStart: rangeStartStr,
          rangeEnd: rangeEndStr,
          priceRange: priceRangeStr,
          incentives,
          dustLevel: dustLevelStr,
        } = argv;
        const rangeStart = (() => {
          const ms = Date.parse(rangeStartStr);
          if (isNaN(ms)) {
            throw new Error(
              `Failed to parse "rangeStart" as a date: ${rangeStartStr}`
            );
          }
          return new Date(ms);
        })();
        const rangeEnd = (() => {
          const ms = Date.parse(rangeEndStr);
          if (isNaN(ms)) {
            throw new Error(
              `Failed to parse "rangeEnd" as a date: ${rangeEndStr}`
            );
          }
          return new Date(ms);
        })();

        const priceRange = (() => {
          const v = Number(priceRangeStr);

          if (Number.isNaN(v)) {
            throw new Error(
              `Failed to parse "priceRange" as a number: ${priceRangeStr}`
            );
          }

          if (v < 0) {
            throw new Error(
              `"priceRange" should not be negative: ${priceRangeStr}`
            );
          }

          if (v > 1) {
            throw new Error(
              `"priceRange" is a fraction of the price.  A value of 0.5 means 50% price"` +
                ` variation.  Values above 1 are most likely a mistake.  Got: ${priceRangeStr}`
            );
          }

          return v;
        })();

        const dustLevel = (() => {
          const v = Number(dustLevelStr);
          if (Number.isNaN(v)) {
            throw new Error(
              `Failed to parse "dustLevel" as a number: ${dustLevelStr}`
            );
          }

          return v;
        })();

        initConfig();

        // TODO See comment in the command above as to why `as string` is needed here.
        const config = configForNetwork(networkId as string);

        await incentivesDistributionReport(
          config,
          priceStore,
          liquidityBalanceStore,
          rangeStart,
          rangeEnd,
          priceRange,
          incentives,
          dustLevel
        );
      }
    )
    .help("help")
    .demandCommand();

const configForNetwork = (network: string): Config => {
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

const updateBinancePrices = async (config: Config, storePath: string) => {
  const { binanceSymbol, exchangeLaunchTime } = config;

  const store = await PriceStore.load(storePath, exchangeLaunchTime);

  await store.update(binanceSymbol, exchangeLaunchTime);
  await store.save(storePath);
};

const updateLiquidityBalances = async (
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

const printPoolLiquidityEvents = async (
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

const incentivesDistributionReport = async (
  config: Config,
  priceStorePath: string,
  balanceStorePath: string,
  rangeStart: Date,
  rangeEnd: Date,
  priceRange: number,
  incentivesTotal: number,
  dustLevel: number
) => {
  const { exchangeLaunchTime, uniswapPoolAddress, liquidityStatsStartBlock } =
    config;

  const priceStore = await PriceStore.load(priceStorePath, exchangeLaunchTime);
  const balanceStore = await LiquidityBalancesStore.load(
    balanceStorePath,
    liquidityStatsStartBlock,
    uniswapPoolAddress
  );

  const distributions = incentivesDistribution(
    priceStore,
    balanceStore,
    rangeStart,
    rangeEnd,
    priceRange,
    incentivesTotal
  );

  printIncentivesDistribution(distributions, dustLevel);
};
