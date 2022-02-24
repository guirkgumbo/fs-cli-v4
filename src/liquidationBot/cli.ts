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
import { LiquidationBotArguments } from "@liquidationBot/index";
import type { Arguments, Argv } from "yargs";

type DeploymentVersion = "v4" | "v4_1";

// These are the blocks containing the first transactions to the first exchange.
const FUTURESWAP_EXCHANGE_GENESIS_BLOCKS: { [network: string]: number } = {
  RINKEBY_ARBITRUM: 5280847,
  MAINNET_ARBITRUM: 2194550,
};

const DEFAULT_MAX_BLOCKS_PER_JSON_RPC_QUERY = 50_000;

const DEFAULT_LIQUIDATION_BOT_API: {
  [network in Network]: { [version in DeploymentVersion]: string };
} = {
  MAINNET_ARBITRUM: {
    v4: "0x874a7Dd18653A0c69874525B802a32986D0Fedd5",
    v4_1: "", // todo add address after the contract would be deployed
  },
  RINKEBY_ARBITRUM: {
    v4: "0x83fCf37F72a52c0bD76e18595Fa0FAEe50f33125",
    v4_1: "0x3952BAb3a21a4Fd61f1EaeF3E6a63c6f50Aae1D4",
  },
};

export type LiquidationBotArgs<T = {}> = TradeRouterWithSignerArgs<
  ExchangeWithSignerArgs<
    T & {
      "deployment-version": string | undefined;
      "liquidation-bot": string | undefined;
      "liquidation-bot-v2": string | undefined;
      "exchange-launch-block": number | undefined;
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

export const cli = <T = {}>(yargs: Argv<T>): Argv<LiquidationBotArgs<T>> => {
  return (
    tradeRouterWithSignerArgv(exchangeWithSignerArgv(yargs))
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
      .option("max-blocks-per-json-rpc-query", {
        describe:
          "Number of blocks to fetch per JSON RPC Query" +
          `Defaults to: ${DEFAULT_MAX_BLOCKS_PER_JSON_RPC_QUERY}`,
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
      // todo switch default to 4.1 after the release (here, below, and in the docs)
      .option("deployment-version", {
        describe:
          "Version of deployment bot should run against.  One of: 4 or 4.1\n" +
          ".env property: DEPLOYMENT_VERSION\n" +
          "Default: 4",
        type: "string",
      })
  );
};

export const parseCli = <T = {}>(
  argv: Arguments<LiquidationBotArgs<T>>
): LiquidationBotArguments => {
  const { network } = getNetwork(argv);
  const exchangeLaunchBlock = getNumberArg(
    "exchange-launch-block",
    "EXCHANGE_LAUNCH_BLOCK",
    argv,
    {
      default: FUTURESWAP_EXCHANGE_GENESIS_BLOCKS[network],
      isInt: true,
      isPositive: true,
    }
  );

  const maxBlocksPerJsonRpcQuery = getNumberArg(
    "max-blocks-per-json-rpc-query",
    "MAX_BLOCKS_PER_JSON_RPC_QUERY",
    argv,
    {
      default: DEFAULT_MAX_BLOCKS_PER_JSON_RPC_QUERY,
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
  const maxTradersPerLiquidationCheck = getNumberArg(
    "max-traders-per-liquidation-check",
    "MAX_TRADERS_PER_LIQUIDATION_CHECK",
    argv,
    { isInt: true, isPositive: true, default: 1_000 }
  );

  const reporting = getEnumArg(
    "reporting",
    "LIQUIDATION_BOT_REPORTING",
    ["console", "pm2"],
    argv,
    { default: "console" }
  ) as "console" | "pm2";

  const cliDeploymentVersion = getEnumArg(
    "deployment-version",
    "DEPLOYMENT_VERSION",
    ["4", "4.1"],
    argv,
    { default: "4" }
  ) as "4" | "4.1";

  const deploymentSpecific =
    cliDeploymentVersion == "4"
      ? {
          deploymentVersion: "v4" as const,
          ...getExchangeWithSigner(argv),
        }
      : {
          deploymentVersion: "v4_1" as const,
          ...getTradeRouterWithSigner(argv),
        };

  const provider = checkDefined(
    deploymentSpecific.signer.provider,
    "Internal error: Signer for the exchange does not have a provider"
  );

  const liquidationBotApiAddress = getStringArg(
    "liquidation-bot",
    `${network}_LIQUIDATION_BOT`,
    argv,
    {
      default:
        DEFAULT_LIQUIDATION_BOT_API[network][
          deploymentSpecific.deploymentVersion
        ],
    }
  );

  return {
    fetcherRetryIntervalSec,
    checkerRetryIntervalSec,
    liquidatorRetryIntervalSec,
    liquidatorDelaySec,
    reporting,
    maxTradersPerLiquidationCheck,
    maxBlocksPerJsonRpcQuery,
    exchangeLaunchBlock,
    liquidationBotApiAddress,
    provider,
    ...deploymentSpecific,
  };
};
