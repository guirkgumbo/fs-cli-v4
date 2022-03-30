import { getEnumArg, getNumberArg, getStringArg } from "@config/args";
import type {
  ExchangeWithSignerArgs,
  Network,
  TradeRouterWithSignerArgs,
} from "@config/common";
import {
  checkDefined,
  exchangeWithSignerArgv,
  getExchangeWithSigner,
  getNetwork,
  getTradeRouterWithSigner,
  tradeRouterWithSignerArgv,
} from "@config/common";
import type { Provider } from "@ethersproject/providers";
import { LiquidationBotApiV2__factory } from "@generated/factories/LiquidationBotApiV2__factory";
import { LiquidationBotApi__factory } from "@generated/factories/LiquidationBotApi__factory";
import type { IExchange } from "@generated/IExchange";
import type { IExchangeEvents } from "@generated/IExchangeEvents";
import type { IExchangeLedger } from "@generated/IExchangeLedger";
import { LiquidationBotApi } from "@generated/LiquidationBotApi";
import { LiquidationBotApiV2 } from "@generated/LiquidationBotApiV2";
import type { TradeRouter } from "@generated/TradeRouter";
import type { Arguments, Argv } from "yargs";
import { Deployment } from "./bot";
import * as deployments from "./deployments";

/*
 * These are the blocks containing the first transactions to the first exchange.
 *
 * TODO It would be better to read these defaults from the deployment JSON, instead of duplicating
 * the information here.
 */
const DEFAULTS: {
  [network in Network]?: {
    v4?: {
      launchBlock: {
        [exchangeAddress: string]: number;
      };
      liquidationBotApi: string;
    };
    v4_1?: {
      launchBlock: {
        [exchangeLedgerAddress: string]: number;
      };
      liquidationBotApiV2: string;
    };
    maxBlocksPerJsonRpcQuery: number;
    historyFetchIntervalSec: number;
    maxTradersPerLiquidationCheck: number;
  };
} = {
  MAINNET_ARBITRUM: {
    v4: {
      launchBlock: {
        // ETH/USDC
        "0xf7ca7384cc6619866749955065f17bedd3ed80bc": 2194550,
        // WBTC/ETH
        "0x85dde4a11cf366fb56e05cafe2579e7119d5bc2f": 4377849,
      },
      liquidationBotApi: "0x874a7Dd18653A0c69874525B802a32986D0Fedd5",
    },
    maxBlocksPerJsonRpcQuery: 50_000,
    historyFetchIntervalSec: 1,
    maxTradersPerLiquidationCheck: 300,
  },
  MAINNET_AVALANCHE: {
    maxBlocksPerJsonRpcQuery: 2_000,
    historyFetchIntervalSec: 5,
    maxTradersPerLiquidationCheck: 300,
  },
  TESTNET_ARBITRUM: {
    v4: {
      launchBlock: {
        // ETH/USDC
        "0xfcd6da3ea74309905baa5f3babdde630fccccbd1": 5280847,
        // WBTC/ETH
        "0xef68c2ae2783dc4d7eab94d15de96717155c3fb5": 7608236,
      },
      liquidationBotApi: "0x83fCf37F72a52c0bD76e18595Fa0FAEe50f33125",
    },
    maxBlocksPerJsonRpcQuery: 50_000,
    historyFetchIntervalSec: 1,
    maxTradersPerLiquidationCheck: 300,
  },
  TESTNET_AVALANCHE: {
    v4_1: {
      launchBlock: {
        // AVAX/FRAX
        "0xdf5d03bfb11b997b476fb3ad5d69564678d5bea4": 6463848,
        // JOE/AVAX
        "0x509cdb25968f50e7eb848bc2f956f6db77b0fd08": 6107561,
        // UST/USDC
        "0x4f417eb99610c9195f3d428fb3d8ccaed572e59b": 6141894,
      },
      liquidationBotApiV2: "0x3952BAb3a21a4Fd61f1EaeF3E6a63c6f50Aae1D4",
    },
    maxBlocksPerJsonRpcQuery: 2_000,
    historyFetchIntervalSec: 5,
    maxTradersPerLiquidationCheck: 300,
  },
};

export type LiquidationBotArgs<T = {}> = TradeRouterWithSignerArgs<
  ExchangeWithSignerArgs<
    T & {
      "deployment-version": string | undefined;
      "liquidation-bot": string | undefined;
      "liquidation-bot-v2": string | undefined;
      "exchange-launch-block": number | undefined;
      "history-fetch-interval": number | undefined;
      "max-blocks-per-json-rpc-query": number | undefined;
      "refetch-interval": number | undefined;
      "recheck-interval": number | undefined;
      "liquidation-retry-interval": number | undefined;
      "liquidation-delay": number | undefined;
      "max-traders-per-liquidation-check": number | undefined;
      reporting: string | undefined;
    }
  >
>;

export const liquidationBotArgv = <T = {}>(
  yargs: Argv<T>
): Argv<LiquidationBotArgs<T>> => {
  return (
    tradeRouterWithSignerArgv(exchangeWithSignerArgv(yargs))
      // todo switch default to 4.1 after the release (here, below, and in the docs)
      .option("deployment-version", {
        describe:
          "Version of deployment bot should run against.  One of: 4 or 4.1\n" +
          ".env property: DEPLOYMENT_VERSION\n" +
          "Default: 4",
        type: "string",
      })
      .option("liquidation-bot", {
        describe:
          "Address of the LiquidationBotApi contract.\n" +
          ".env property: <network>_LIQUIDATION_BOT_API\n" +
          "Must be provided when deployment-version is '4', ignored othervice" +
          "Default depends on the chosen network and deployment version.",
        type: "string",
      })
      .option("liquidation-bot-v2", {
        describe:
          "Address of the LiquidationBotApiV2 contract.\n" +
          ".env property: <network>_LIQUIDATION_BOT_API_V2\n" +
          "Must be provided when deployment-version is '4.1', ignored othervice" +
          "Default depends on the chosen network and deployment version.",
        type: "string",
      })
      .option("exchange-launch-block", {
        describe:
          "Arbitrum block to start scanning traders from for liquidation\n" +
          "Default depends on the chosen network, but generally to the first block the exchange" +
          " was created in.",
        type: "number",
      })
      .option("history-fetch-interval", {
        describe:
          "Number of seconds to wait between queries for historical position change events," +
          " necessary to reconstruct set of all open positions for the echange.\n" +
          "Use this delay to decrease the rate of JSON-RPC requests the liquidation bot will" +
          " issue during the initial startup phase.\n" +
          ".env property: HISTORY_FETCH_INTERVAL_SEC\n" +
          "Default: depends on the chosen network",
        type: "number",
      })
      .option("max-blocks-per-json-rpc-query", {
        describe:
          "Number of blocks to fetch per JSON RPC Query" +
          ".env property: MAX_BLOCKS_PER_JSON_RPC_QUERY\n" +
          `Default: network specific`,
        type: "number",
      })
      .option("refetch-interval", {
        describe:
          "Trade indexer query frequency for open trades list. In seconds.\n" +
          ".env property: TRADES_FETCHER_REFETCH_INTERVAL_SEC\n" +
          "Default: every 20 seconds",
        type: "number",
      })
      .option("recheck-interval", {
        describe:
          "Open trade checker recheck frequency. In seconds.\n" +
          ".env property: TRADES_CHECKER_RECHECK_INTERVAL_SEC\n" +
          "Default: every 5 seconds",
        type: "number",
      })
      .option("liquidation-retry-interval", {
        describe:
          "Failed liquidation recheck delay. In seconds.\n" +
          ".env property: TRADES_LIQUIDATOR_RETRY_INTERVAL_SEC\n" +
          "Default: every 1 second",
        type: "number",
      })
      .option("liquidation-delay", {
        describe:
          "Delay between finding a liquidatable trader and attempting to\n" +
          "liquidate it. In seconds.\n" +
          "Setting this parameter to a non-zero value would make your bot\n" +
          "significantly less competitive!\n" +
          "Defaults to: 0",
        type: "number",
      })
      .option("max-traders-per-liquidation-check", {
        describe:
          "Number of addresses to send in a single liquidation request.\n" +
          ".env property: MAX_TRADERS_PER_LIQUIDATION_CHECK\n" +
          "Default: 1_000",
        type: "number",
      })
      .option("reporting", {
        describe:
          'Type of reporter to use.  One of: "console", or "pm2".\n' +
          ".env property: LIQUIDATION_BOT_REPORTING\n" +
          "Default: console",
        type: "string",
      })
  );
};

type CommonArguments = {
  provider: Provider;
  fetcherRetryIntervalSec: number;
  checkerRetryIntervalSec: number;
  liquidatorRetryIntervalSec: number;
  liquidatorDelaySec: number;
  maxTradersPerLiquidationCheck: number;
  historyFetchIntervalSec: number;
  maxBlocksPerJsonRpcQuery: number;
  exchangeLaunchBlock: number;
  reporting: "console" | "pm2";
};

type ArgumentsV4 = {
  deploymentVersion: "v4";
  exchange: IExchange;
  exchangeEvents: IExchangeEvents;
  exchangeAddress: string;
  liquidationBotApi: LiquidationBotApi;
};

type ArgumentsV4_1 = {
  deploymentVersion: "v4_1";
  tradeRouter: TradeRouter;
  exchangeLedger: IExchangeLedger;
  tradeRouterAddress: string;
  liquidationBotApi: LiquidationBotApiV2;
};

export type LiquidationBotArguments = CommonArguments &
  (ArgumentsV4 | ArgumentsV4_1);

export const getLiquidationBotArgs = <T = {}>(
  argv: Arguments<LiquidationBotArgs<T>>
): LiquidationBotArguments => {
  const deploymentVersion = getEnumArg(
    "deployment-version",
    "DEPLOYMENT_VERSION",
    ["4", "4.1"],
    argv,
    { default: "4" }
  ) as "4" | "4.1";

  const commonArgs = getLiquidationBotCommonArgs(argv);
  const versionSpecificArgs =
    deploymentVersion == "4"
      ? getLiquidationBotV4Args(argv)
      : getLiquidationBotV4_1Args(argv);

  return {
    ...commonArgs,
    ...versionSpecificArgs,
  };
};

const getLiquidationBotCommonArgs = <T = {}>(
  argv: Arguments<LiquidationBotArgs<T>>
): {
  fetcherRetryIntervalSec: number;
  checkerRetryIntervalSec: number;
  liquidatorRetryIntervalSec: number;
  liquidatorDelaySec: number;
  historyFetchIntervalSec: number;
  maxTradersPerLiquidationCheck: number;
  maxBlocksPerJsonRpcQuery: number;
  reporting: "console" | "pm2";
} => {
  const { network } = getNetwork(argv);

  const maxBlocksPerJsonRpcQuery = getNumberArg(
    "max-blocks-per-json-rpc-query",
    "MAX_BLOCKS_PER_JSON_RPC_QUERY",
    argv,
    {
      default: DEFAULTS[network]?.maxBlocksPerJsonRpcQuery,
      isInt: true,
      isPositive: true,
    }
  );

  const fetcherRetryIntervalSec = getNumberArg(
    "refetch-interval",
    "TRADES_FETCHER_REFETCH_INTERVAL_SEC",
    argv,
    { isPositive: true, default: 20 }
  );
  const checkerRetryIntervalSec = getNumberArg(
    "recheck-interval",
    "TRADES_CHECKER_RECHECK_INTERVAL_SEC",
    argv,
    { isPositive: true, default: 5 }
  );
  const liquidatorRetryIntervalSec = getNumberArg(
    "liquidation-retry-interval",
    "TRADES_LIQUIDATOR_RETRY_INTERVAL_SEC",
    argv,
    { isPositive: true, default: 1 }
  );
  const liquidatorDelaySec = getNumberArg(
    "liquidation-delay",
    "TRADERS_LIQUIDATOR_DELAY_SEC",
    argv,
    { isPositive: true, default: 0 }
  );
  const historyFetchIntervalSec = getNumberArg(
    "history-fetch-interval",
    "HISTORY_FETCH_INTERVAL_SEC",
    argv,
    {
      isPositive: true,
      default: DEFAULTS[network]?.historyFetchIntervalSec,
    }
  );

  const maxTradersPerLiquidationCheck = getNumberArg(
    "max-traders-per-liquidation-check",
    "MAX_TRADERS_PER_LIQUIDATION_CHECK",
    argv,
    {
      isInt: true,
      isPositive: true,
      default: DEFAULTS[network]?.maxTradersPerLiquidationCheck,
    }
  );

  const reporting = getEnumArg(
    "reporting",
    "LIQUIDATION_BOT_REPORTING",
    ["console", "pm2"],
    argv,
    { default: "console" }
  ) as "console" | "pm2";

  return {
    fetcherRetryIntervalSec,
    checkerRetryIntervalSec,
    liquidatorRetryIntervalSec,
    liquidatorDelaySec,
    maxTradersPerLiquidationCheck,
    historyFetchIntervalSec,
    maxBlocksPerJsonRpcQuery,
    reporting,
  };
};

const getLiquidationBotV4Args = <T = {}>(
  argv: Arguments<LiquidationBotArgs<T>>
): {
  provider: Provider;
  exchangeLaunchBlock: number;
} & ArgumentsV4 => {
  const { network, signer, exchange, exchangeEvents, exchangeAddress } =
    getExchangeWithSigner(argv);

  const exchangeLaunchBlock = getNumberArg(
    "exchange-launch-block",
    "EXCHANGE_LAUNCH_BLOCK",
    argv,
    {
      default:
        DEFAULTS[network]?.["v4"]?.launchBlock[exchangeAddress.toLowerCase()],
      isInt: true,
      isPositive: true,
    }
  );

  const provider = checkDefined(
    signer.provider,
    "Internal error: Signer for the exchange does not have a provider"
  );

  const liquidationBotApiAddress = getStringArg(
    "liquidation-bot",
    `${network}_LIQUIDATION_BOT_API`,
    argv,
    {
      default: DEFAULTS[network]?.["v4"]?.liquidationBotApi,
    }
  );

  const liquidationBotApi = LiquidationBotApi__factory.connect(
    liquidationBotApiAddress,
    provider
  );

  return {
    provider,
    exchangeLaunchBlock,
    deploymentVersion: "v4",
    exchange,
    exchangeEvents,
    exchangeAddress,
    liquidationBotApi,
  };
};

const getLiquidationBotV4_1Args = <T = {}>(
  argv: Arguments<LiquidationBotArgs<T>>
): {
  provider: Provider;
  exchangeLaunchBlock: number;
} & ArgumentsV4_1 => {
  const { network, signer, tradeRouter, exchangeLedger, tradeRouterAddress } =
    getTradeRouterWithSigner(argv);

  const exchangeLaunchBlock = getNumberArg(
    "exchange-launch-block",
    "EXCHANGE_LAUNCH_BLOCK",
    argv,
    {
      default:
        DEFAULTS[network]?.["v4_1"]?.launchBlock[
          exchangeLedger.address.toLowerCase()
        ],
      isInt: true,
      isPositive: true,
    }
  );

  const provider = checkDefined(
    signer.provider,
    "Internal error: Signer for the exchange does not have a provider"
  );

  const liquidationBotApiAddress = getStringArg(
    "liquidation-bot-v2",
    `${network}_LIQUIDATION_BOT_API_V2`,
    argv,
    {
      default: DEFAULTS[network]?.["v4_1"]?.liquidationBotApiV2,
    }
  );
  const liquidationBotApi = LiquidationBotApiV2__factory.connect(
    liquidationBotApiAddress,
    provider
  );

  return {
    provider,
    exchangeLaunchBlock,
    deploymentVersion: "v4_1",
    tradeRouter,
    exchangeLedger,
    tradeRouterAddress,
    liquidationBotApi,
  };
};

export const getDeployment = (args: LiquidationBotArguments): Deployment => {
  const {
    exchangeLaunchBlock,
    maxTradersPerLiquidationCheck,
    maxBlocksPerJsonRpcQuery,
  } = args;

  switch (args.deploymentVersion) {
    case "v4": {
      const { exchange, exchangeEvents, exchangeAddress, liquidationBotApi } =
        args;
      return deployments.v4.init({
        exchange,
        exchangeEvents,
        liquidationBotApi,
        exchangeAddress,
        exchangeLaunchBlock,
        maxTradersPerLiquidationCheck,
        maxBlocksPerJsonRpcQuery,
      });
    }
    case "v4_1": {
      const {
        tradeRouter,
        exchangeLedger,
        tradeRouterAddress,
        liquidationBotApi,
      } = args;
      return deployments.v4_1.init({
        tradeRouter,
        exchangeLedger,
        liquidationBotApi,
        tradeRouterAddress,
        exchangeLaunchBlock,
        maxTradersPerLiquidationCheck,
        maxBlocksPerJsonRpcQuery,
      });
    }
  }
};
