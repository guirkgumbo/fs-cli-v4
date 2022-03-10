/**
 * Commands related to Uniswap interaction.
 */

import { getEnumArg } from "@config/args";
import {
  getNetwork,
  GetNetworkArgv,
  getProvider,
  GetProviderArgv,
  Network,
  WithNetworkArgs,
  withNetworkArgv,
  withProviderArgv,
} from "@config/common";
import { Provider } from "@ethersproject/providers";
import type { FileHandle } from "fs/promises";
import { open } from "fs/promises";
import { Arguments, Argv } from "yargs";
import { PairPrices, PriceStore } from "./binance";
import {
  incentivesDistribution,
  IncentivesDistribution,
  printIncentivesDistribution,
  printIncentivesDistributionAsJson,
} from "./uniswap/incentives";
import {
  BalancesStore as LiquidityBalancesStore,
  PairBalances,
  printAllPoolLiquidityEvents,
} from "./uniswap/liquidity";

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

export enum ReportFormat {
  Text = 1,
  Json,
  Csv,
}

export enum Pair {
  ETHUSDC = "ETHUSDC",
  WBTCETH = "WBTCETH",
}

const CONFIGURATIONS: {
  [network in Network]: {
    [pair in Pair]?: Config;
  };
} = {
  TESTNET_ARBITRUM: {
    [Pair.ETHUSDC]: {
      binanceSymbol: "ETHUSDC",
      exchangeLaunchTime: new Date("2021-10-13T09:00:00-07:00"),

      exchangeAddress: "0xfcD6da3Ea74309905Baa5F3BAbDdE630FccCcBD1",
      uniswapPoolAddress: "0x8491763F3d9d6BF114dE2Ca82A65D7975590A693",

      // "Oct-05-2021 10:22:37 PM +UTC" - first interaction with the `uniswapPoolAddress` contract.
      liquidityStatsStartBlock: 5273636,
    },
    [Pair.WBTCETH]: {
      binanceSymbol: "WBTCETH",
      exchangeLaunchTime: new Date("2021-12-16T13:00:00-07:00"),

      exchangeAddress: "0xEF68C2ae2783dC4d7eab94d15dE96717155C3fB5",
      uniswapPoolAddress: "0x394D0bF914248c1AEd20Aad4F40aDf122b26De8F",

      // "Dec-14-2021 06:45:14 AM +UTC" - first interaction with the `uniswapPoolAddress` contract.
      liquidityStatsStartBlock: 7521443,
    },
  },

  MAINNET_ARBITRUM: {
    [Pair.ETHUSDC]: {
      binanceSymbol: "ETHUSDC",
      exchangeLaunchTime: new Date("2021-10-13T09:00:00-07:00"),

      exchangeAddress: "0xF7CA7384cc6619866749955065f17beDD3ED80bC",
      uniswapPoolAddress: "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443",

      // "Jul-12-2021 08:43:45 PM +UTC" - first transaction in the `uniswapPoolAddresses` pool above.
      liquidityStatsStartBlock: 100909,
    },
    [Pair.WBTCETH]: {
      binanceSymbol: "WBTCETH",
      exchangeLaunchTime: new Date("2022-01-05T09:00:00-07:00"),

      exchangeAddress: "0x85DDE4A11cF366Fb56e05cafE2579E7119D5bC2f",
      uniswapPoolAddress: "0x2f5e87C9312fa29aed5c179E456625D79015299c",

      // "Jan-05-2022 05:40:58 PM +UTC" - first transaction in the `uniswapPoolAddresses` pool above.
      liquidityStatsStartBlock: 4379074,
    },
  },

  MAINNET_AVALANCHE: {},

  TESTNET_AVALANCHE: {},
};

export const cli = (yargs: Argv): Argv => {
  return yargs
    .command(
      "update-prices",
      "Fetches prices from Binance and saves them into a local file.",
      (yargs) =>
        networkAndPairArgv(withNetworkArgv, yargs).option("price-store", {
          describe: "File that holds a local cache of Binance prices.",
          type: "string",
          default: "binancePrices.json",
        }),
      async (argv) => {
        const { network, pair } = getNetworkAndPair(getNetwork, argv);
        const { "price-store": priceStore } = argv;

        const config = configForNetworkAndPair(network, pair);

        await updateBinancePrices(config, priceStore, pair);
      }
    )
    .command(
      "print-liquidity-events",
      "Shows `Mint` and `Burn` events for a Uniswap pool.",
      (yargs) =>
        networkAndPairArgv(withProviderArgv, yargs)
          .option("from", {
            describe:
              "First block to print events for." +
              "  Defaults to some value before the exchange launch.",
            type: "number",
          })
          .option("to", {
            describe:
              "Last block to print events for." +
              "  Defaults to the last confirmed block on the chain.",
            type: "number",
          }),
      async (argv) => {
        const { from: fromBlock, to: toBlock } = argv;

        const { network, provider, pair } = getNetworkProviderAndPair(
          getProvider,
          argv
        );
        const config = configForNetworkAndPair(network, pair);

        await printPoolLiquidityEvents(
          provider,
          config,
          fromBlock ?? null,
          toBlock ?? null
        );
      }
    )
    .command(
      "update-liquidity-balances",
      "Fetches balances from a Uniswap pool and saves them into a local file.",
      (yargs) =>
        networkAndPairArgv(withProviderArgv, yargs)
          .option("liquidity-balance-store", {
            alias: "l",
            describe: "File that holds a local cache of the uniswap balances",
            type: "string",
            default: "uniswapLiquidityBalances.json",
          })
          .option("verbose", {
            describe:
              "Show detailed progess for JSON-RPC provider interactions.\n" +
              "When there are a lot of events, it helps see that the scripot is not stuck.",
            type: "boolean",
            default: false,
          }),
      async (argv) => {
        const { "liquidity-balance-store": liquidityBalanceStore, verbose } =
          argv;

        const { network, provider, pair } = getNetworkProviderAndPair(
          getProvider,
          argv
        );
        const config = configForNetworkAndPair(network, pair);

        await updateLiquidityBalances(
          verbose,
          provider,
          config,
          pair,
          liquidityBalanceStore
        );
      }
    )
    .command(
      "liquidity-incentives-report",
      "Computes incentives distribution for the specified range based on the Binance prices" +
        " and Uniswap liquidity balances.",
      (yargs) =>
        reportFormatArgv(
          reportCommandOptions(
            outputPathArgv(networkAndPairArgv(withNetworkArgv, yargs))
          )
        ),
      async (argv) => {
        const { network, pair } = getNetworkAndPair(getNetwork, argv);
        const {
          priceStore,
          liquidityBalanceStore,
          rangeStart,
          rangeEnd,
          priceRange,
          incentives,
          dustLevel,
        } = getReportOptions(argv);
        const { format } = getReportFormat(argv);
        const { output: outputPath } = argv;

        const config = configForNetworkAndPair(network, pair);

        await incentivesDistributionReport(
          config,
          pair,
          format,
          outputPath,
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
};

export type NetworkAndPairArgs<T = {}> = WithNetworkArgs<T> & {
  pair: string | undefined;
};
export const networkAndPairArgv = <T = {}>(
  withNetworkArgv: <T>(yargs: Argv<T>) => Argv<WithNetworkArgs<T>>,
  yargs: Argv<T>
): Argv<NetworkAndPairArgs<T>> => {
  return withNetworkArgv(yargs).option("pair", {
    describe:
      "Selects a certain exchange on the network chosen using the 'network' argument.\n" +
      `Allowed value(s): "${Object.keys(Pair).join('", "')}"\n` +
      ".env property: <network>_PAIR" +
      "Required",
    type: "string",
  });
};

export const getNetworkAndPair = <T = {}>(
  getNetwork: <T>(argv: GetNetworkArgv<T>) => { network: Network },
  argv: Arguments<NetworkAndPairArgs<T>>
): {
  network: Network;
  pair: Pair;
} => {
  const { network } = getNetwork(argv);
  const pair = getEnumArg(
    "pair",
    `${network}_PAIR`,
    Object.values(Pair),
    argv,
    { ignoreCase: true }
  );

  return { network, pair };
};

const getNetworkProviderAndPair = <T = {}>(
  getProvider: <T>(argv: GetProviderArgv<T>) => {
    network: Network;
    provider: Provider;
  },
  argv: Arguments<NetworkAndPairArgs<T>>
): {
  network: Network;
  provider: Provider;
  pair: Pair;
} => {
  const { network, provider } = getProvider(argv);
  const pair = getEnumArg(
    "pair",
    `${network}_PAIR`,
    Object.values(Pair),
    argv,
    { ignoreCase: true }
  ) as Pair;

  return { network, pair, provider };
};

type OutputPathArgs<T = {}> = T & { output: string };
const outputPathArgv = <T = {}>(yargs: Argv<T>): Argv<OutputPathArgs<T>> => {
  return yargs.option("output", {
    describe: 'Output file path.  "-" means stdout.  Default: "-"',
    type: "string",
    default: "-",
  });
};

type ReportFormatArgs<T = {}> = T & { format: string };
const reportFormatArgv = <T = {}>(
  yargs: Argv<T>
): Argv<ReportFormatArgs<T>> => {
  return yargs.option("format", {
    describe: "Selects report output format. Supported values: text, json, csv",
    type: "string",
    default: "text",
  });
};

const getReportFormat = <T = {}>(
  argv: Arguments<ReportFormatArgs<T>>
): {
  format: ReportFormat;
} => {
  const { format } = argv;

  switch (format.toLowerCase()) {
    case "text":
      return { format: ReportFormat.Text };

    case "json":
      return { format: ReportFormat.Json };

    case "csv":
      return { format: ReportFormat.Csv };

    default:
      throw new Error(
        `Unexpected "format" value: "${format}".\n` +
          'Supported values: "text", "json", and "cvs"'
      );
  }
};

export type ReportCommandArgs<T = {}> = T & {
  "price-store": string;
  "liquidity-balance-store": string;
  "range-start": string;
  "range-end": string;
  "price-range": number;
  incentives: number;
  "dust-level": number;
};
export const reportCommandOptions = <T = {}>(
  yargs: Argv<T>
): Argv<ReportCommandArgs<T>> => {
  return yargs
    .option("price-store", {
      alias: "p",
      describe: "File that holds a local cache of Binance prices",
      type: "string",
      default: "binancePrices.json",
    })
    .option("liquidity-balance-store", {
      alias: "l",
      describe: "File that holds a local cache of the uniswap balances",
      type: "string",
      default: "uniswapLiquidityBalances.json",
    })
    .option("range-start", {
      alias: "f",
      describe: "Start time for the report",
      type: "string",
      require: true,
    })
    .option("range-end", {
      alias: "t",
      describe: "End time for the report",
      type: "string",
      require: true,
    })
    .option("price-range", {
      alias: "r",
      describe:
        "Specifies price range for liquidity incentives." +
        "  Incentives are distributed for liquidity in the range between" +
        " `1 - price-range` and `1 + price-range`. ",
      type: "number",
      default: 0.025,
    })
    .option("incentives", {
      alias: "i",
      describe:
        "Total number of incentives to be distributed in the specified range.",
      type: "number",
      require: true,
    })
    .option("dust-level", {
      alias: "d",
      describe:
        "If an account did not accumulate more incentives than this much, it is not" +
        " included in the report.",
      type: "number",
      default: 0.01,
    });
};

export const getReportOptions = <T = {}>(
  argv: Arguments<ReportCommandArgs<T>>
): {
  priceStore: string;
  liquidityBalanceStore: string;
  rangeStart: Date;
  rangeEnd: Date;
  priceRange: number;
  incentives: number;
  dustLevel: number;
} => {
  const {
    "price-store": priceStore,
    "liquidity-balance-store": liquidityBalanceStore,
    "range-start": rangeStartStr,
    "range-end": rangeEndStr,
    "price-range": priceRangeStr,
    incentives,
    "dust-level": dustLevelStr,
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
      throw new Error(`Failed to parse "rangeEnd" as a date: ${rangeEndStr}`);
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
      throw new Error(`"priceRange" should not be negative: ${priceRangeStr}`);
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

  return {
    priceStore,
    liquidityBalanceStore,
    rangeStart,
    rangeEnd,
    priceRange,
    incentives,
    dustLevel,
  };
};

export const configForNetworkAndPair = (
  network: Network,
  pair: Pair
): Config => {
  const networkConfig = CONFIGURATIONS[network];

  if (networkConfig === undefined) {
    throw new Error(
      'Supported networks: "' +
        Object.keys(CONFIGURATIONS).join('", "') +
        '".\n' +
        `  Got: ${network}`
    );
  }

  const config = networkConfig[pair];

  if (config === undefined) {
    throw new Error(
      `Supported pairs on "${network}" are: "` +
        Object.keys(Pair).join('", "') +
        '".\n' +
        `  Got: "${pair.toString()}"`
    );
  }

  return config;
};

const updateBinancePrices = async (
  config: Config,
  storePath: string,
  pair: Pair
) => {
  const { binanceSymbol, exchangeLaunchTime } = config;

  const store = await PriceStore.load(storePath);
  const pairPrices = store.getOrCreatePair(pair.toString(), exchangeLaunchTime);
  pairPrices.checkStartTime(storePath, pair, exchangeLaunchTime);

  await pairPrices.update(binanceSymbol, exchangeLaunchTime);
  await store.save(storePath);
};

const updateLiquidityBalances = async (
  verbose: boolean,
  provider: Provider,
  config: Config,
  pair: Pair,
  storePath: string
) => {
  const { uniswapPoolAddress, liquidityStatsStartBlock } = config;

  const store = await LiquidityBalancesStore.load(storePath);
  const pairBalances = store.getOrCreatePair(
    pair.toString(),
    liquidityStatsStartBlock,
    uniswapPoolAddress
  );

  await pairBalances.update(
    verbose,
    provider,
    liquidityStatsStartBlock,
    uniswapPoolAddress
  );
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
  pair: Pair,
  format: ReportFormat,
  outputPath: string,
  priceStorePath: string,
  balanceStorePath: string,
  rangeStart: Date,
  rangeEnd: Date,
  priceRange: number,
  incentivesTotal: number,
  dustLevel: number
) => {
  const { pairPrices, pairBalances } = await loadPricesAndBalances(
    config,
    pair,
    priceStorePath,
    balanceStorePath
  );

  const distribution = incentivesDistribution(
    pairPrices,
    pairBalances,
    rangeStart,
    rangeEnd,
    priceRange,
    incentivesTotal
  );

  let outFd: FileHandle | undefined;
  const out = await (async (): Promise<Console> => {
    if (outputPath == "-" || outputPath == "") {
      return console;
    } else {
      outFd = await open(outputPath, "w");
      return new console.Console(outFd.createWriteStream(), process.stderr);
    }
  })();

  switch (format) {
    case ReportFormat.Text:
      printIncentivesDistribution(out, distribution, dustLevel);
      break;

    case ReportFormat.Json:
      printIncentivesDistributionAsJson(out, distribution, dustLevel);
      break;

    case ReportFormat.Csv:
      throw new Error("TODO: CSV reporting is not implemented yet");

    default:
      throw new Error(`ERROR: Unexpected "ReportFormat" value: ${format}`);
  }

  if (outFd != undefined) {
    await outFd.close();
    outFd = undefined;
  }
};

export const getIncentiveBalances = async (
  config: Config,
  pair: Pair,
  priceStorePath: string,
  balanceStorePath: string,
  rangeStart: Date,
  rangeEnd: Date,
  priceRange: number,
  incentivesTotal: number
): Promise<IncentivesDistribution> => {
  const { pairPrices, pairBalances } = await loadPricesAndBalances(
    config,
    pair,
    priceStorePath,
    balanceStorePath
  );

  return incentivesDistribution(
    pairPrices,
    pairBalances,
    rangeStart,
    rangeEnd,
    priceRange,
    incentivesTotal
  );
};

const loadPricesAndBalances = async (
  config: Config,
  pair: Pair,
  priceStorePath: string,
  balanceStorePath: string
): Promise<{
  pairPrices: PairPrices;
  pairBalances: PairBalances;
}> => {
  const { exchangeLaunchTime, uniswapPoolAddress, liquidityStatsStartBlock } =
    config;

  const priceStore = await PriceStore.load(priceStorePath);
  const pairPrices = priceStore.getPair(priceStorePath, pair.toString());
  pairPrices.checkStartTime(priceStorePath, pair, exchangeLaunchTime);

  const balanceStore = await LiquidityBalancesStore.load(balanceStorePath);
  const pairBalances = balanceStore.getPair(balanceStorePath, pair.toString());
  pairBalances.checkPairParameters(
    liquidityStatsStartBlock,
    uniswapPoolAddress
  );

  return { pairPrices, pairBalances };
};
