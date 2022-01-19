/**
 * Commands related to Uniswap interaction.
 */

import { Arguments, Argv } from "yargs";
import { Provider } from "@ethersproject/providers";
import type { FileHandle } from "fs/promises";
import { open } from "fs/promises";

import {
  WithProviderArgs,
  GetProviderArgv,
  GetNetworkArgv,
  WithNetworkArgs,
  Network,
} from "@config/common";

import {
  BalancesStore as LiquidityBalancesStore,
  printAllPoolLiquidityEvents,
} from "./uniswap/liquidity";
import { PriceStore } from "./binance";

import {
  incentivesDistribution,
  IncentivesDistribution,
  printIncentivesDistribution,
  printIncentivesDistributionAsJson,
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

export enum ReportFormat {
  Text = 1,
  Json,
  Csv,
}

const CONFIGURATIONS: {
  [network in Network]: Config;
} = {
  [Network.RINKEBY]: {
    binanceSymbol: "ETHUSDC",
    exchangeLaunchTime: new Date("2021-10-13T09:00:00-07:00"),

    exchangeAddress: undefined,
    // uniswapPoolAddress: "0xfbDc20aEFB98a2dD3842023f21D17004eAefbe68",
    uniswapPoolAddress: "0x7e7269696356Efd9d8a94F5B0aD967Dad752e50d",

    // "Jun-04-2021 12:19:14 PM +UTC" - first interaction with the `uniswapPoolAddress` contract.
    liquidityStatsStartBlock: 8704879,
  },

  [Network.RINKEBY_ARBITRUM]: {
    binanceSymbol: "ETHUSDC",
    exchangeLaunchTime: new Date("2021-10-13T09:00:00-07:00"),

    exchangeAddress: "0xfcD6da3Ea74309905Baa5F3BAbDdE630FccCcBD1",
    uniswapPoolAddress: "0x8491763F3d9d6BF114dE2Ca82A65D7975590A693",

    // "Oct-05-2021 10:22:37 PM +UTC" - first interaction with the `uniswapPoolAddress` contract.
    liquidityStatsStartBlock: 5273636,
  },

  [Network.MAINNET_ARBITRUM]: {
    binanceSymbol: "ETHUSDC",
    exchangeLaunchTime: new Date("2021-10-13T09:00:00-07:00"),

    exchangeAddress: "0xF7CA7384cc6619866749955065f17beDD3ED80bC",
    uniswapPoolAddress: "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443",

    // "Jul-12-2021 08:43:45 PM +UTC" - first transaction in the `uniswapPoolAddresses` pool above.
    liquidityStatsStartBlock: 100909,
  },
};

export const cli = (
  withNetworkArgv: <T>(yargs: Argv<T>) => Argv<WithNetworkArgs<T>>,
  withProviderArgv: <T>(yargs: Argv<T>) => Argv<WithProviderArgs<T>>,
  yargs: Argv,
  getNetwork: <T>(argv: GetNetworkArgv<T>) => { network: Network },
  getProvider: <T>(argv: GetProviderArgv<T>) => {
    network: Network;
    provider: Provider;
  }
): Argv => {
  return yargs
    .command(
      "update-prices",
      "Fetches prices from Binance and saves them into a local file.",
      (yargs) =>
        withNetworkArgv(yargs).option("price-store", {
          describe: "File that holds a local cache of Binance prices.",
          type: "string",
          default: "binancePrices.json",
        }),
      async (argv) => {
        const { network } = getNetwork(argv);
        const { "price-store": priceStore } = argv;

        const config = configForNetwork(network);

        await updateBinancePrices(config, priceStore);
      }
    )
    .command(
      "print-liquidity-events",
      "Shows `Mint` and `Burn` events for a Uniswap pool.",
      (yargs) =>
        withProviderArgv(yargs)
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

        const { network, provider } = getProvider(argv);
        const config = configForNetwork(network);

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
        withProviderArgv(yargs).option("liquidity-balance-store", {
          alias: "l",
          describe: "File that holds a local cache of the uniswap balances",
          type: "string",
          default: "uniswapLiquidityBalances.json",
        }),
      async (argv) => {
        const { "liquidity-balance-store": liquidityBalanceStore } = argv;

        const { network, provider } = getProvider(argv);
        const config = configForNetwork(network);

        await updateLiquidityBalances(provider, config, liquidityBalanceStore);
      }
    )
    .command(
      "liquidity-incentives-report",
      "Computes incentives distribution for the specified range based on the Binance prices" +
        " and Uniswap liquidity balances.",
      (yargs) =>
        reportFormatArgv(
          reportCommandOptions(withNetworkArgv(outputPathArgv(yargs)))
        ),
      async (argv) => {
        const { network } = getNetwork(argv);
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

        const config = configForNetwork(network);

        await incentivesDistributionReport(
          config,
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

export const configForNetwork = (network: Network): Config => {
  const config = CONFIGURATIONS[network];

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
      printIncentivesDistribution(out, distributions, dustLevel);
      break;

    case ReportFormat.Json:
      printIncentivesDistributionAsJson(out, distributions, dustLevel);
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
  priceStorePath: string,
  balanceStorePath: string,
  rangeStart: Date,
  rangeEnd: Date,
  priceRange: number,
  incentivesTotal: number
): Promise<IncentivesDistribution> => {
  const { exchangeLaunchTime, uniswapPoolAddress, liquidityStatsStartBlock } =
    config;

  const priceStore = await PriceStore.load(priceStorePath, exchangeLaunchTime);
  const balanceStore = await LiquidityBalancesStore.load(
    balanceStorePath,
    liquidityStatsStartBlock,
    uniswapPoolAddress
  );

  return incentivesDistribution(
    priceStore,
    balanceStore,
    rangeStart,
    rangeEnd,
    priceRange,
    incentivesTotal
  );
};
