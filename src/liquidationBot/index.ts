import type { Signer } from "@ethersproject/abstract-signer";
import type { Provider } from "@ethersproject/providers";
import type { IExchange } from "@generated/IExchange";
import type { IExchangeEvents } from "@generated/IExchangeEvents";
import { LiquidationBotApi__factory } from "@generated/factories/LiquidationBotApi__factory";
import { getEnumArg, getNumberArg, getStringArg } from "config/args";
import { Arguments, Argv } from "yargs";
import {
  checkDefined,
  ExchangeArgs,
  GetExchangeWithSignerArgv,
  WithSignerArgs,
} from "@config/common";
import { Deployment, liquidationBot } from "./bot";
import * as deployments from "./deployments";
import * as reporting from "./reporting";

type LiquidationBotKeys<T = {}> = T & {
  "deployment-version": string | undefined;
  "liquidation-bot": string | undefined;
  "exchange-launch-block": number | undefined;
  "max-blocks-per-json-rpc-query": number | undefined;
  "refetch-interval": number | undefined;
  "recheck-interval": number | undefined;
  "liquidation-retry-interval": number | undefined;
  "liquidation-delay": number | undefined;
  "max-traders-per-liquidation-check": number | undefined;
  reporting: string | undefined;
};

export type LiquidationBotArgs<T = {}> = WithSignerArgs<
  ExchangeArgs<LiquidationBotKeys<T>>
>;

// These are the blocks containing the first transactions to the first exchange.
const FUTURESWAP_EXCHANGE_GENESIS_BLOCKS: { [network: string]: number } = {
  RINKEBY_ARBITRUM: 5280847,
  MAINNET_ARBITRUM: 2194550,
};

const DEFAULT_MAX_BLOCKS_PER_JSON_RPC_QUERY = 50_000;

export const cli = <Parent>(
  exchangeWithSignerArgv: <T>(
    yargs: Argv<T>
  ) => Argv<WithSignerArgs<ExchangeArgs<T>>>,
  yargs: Argv<Parent>
): Argv<LiquidationBotArgs<Parent>> => {
  return exchangeWithSignerArgv(yargs)
    .option("liquidation-bot", {
      describe:
        "Address of the LiquidationBotApi contract.\n" +
        ".env property: <network>_LIQUIDATION_BOT_API\n" +
        "Default depends on the chosen network.",
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
    .option("deployment-version", {
      describe:
        "Version of deployment bot should run against.  One of: 4 or 4.1\n" +
        ".env property: DEPLOYMENT_VERSION\n" +
        "Default: 4.1",
      type: "string",
    });
};

export const run = async (
  getExchangeWithSigner: <T>(argv: GetExchangeWithSignerArgv<T>) => {
    network: string;
    signer: Signer;
    exchangeAddress: string;
    exchange: IExchange;
    exchangeEvents: IExchangeEvents;
  },
  argv: Arguments<LiquidationBotArgs<{}>>
) => {
  const { network, signer, exchange, exchangeEvents, exchangeAddress } =
    getExchangeWithSigner(argv);

  const provider = checkDefined(
    signer.provider,
    "Internal error: Signer for the exchange does not have a provider"
  );

  const {
    deployment,
    fetcherRetryIntervalSec,
    checkerRetryIntervalSec,
    liquidatorRetryIntervalSec,
    liquidatorDelaySec,
    reporting: reportingType,
  } = getLiquidationBotArgs(
    network,
    provider,
    exchange,
    exchangeEvents,
    exchangeAddress,
    argv
  );

  const bot = liquidationBot.start(
    deployment,
    provider,
    fetcherRetryIntervalSec,
    checkerRetryIntervalSec,
    liquidatorRetryIntervalSec,
    liquidatorDelaySec
  );

  let reportingProcess =
    reportingType == "pm2"
      ? reporting.pm2.start(liquidationBot)
      : reporting.console.start(liquidationBot);

  await Promise.race([bot, reportingProcess]);
};

const DEFAULT_LIQUIDATION_BOT_API: { [network: string]: string } = {
  MAINNET_ARBITRUM: "0x874a7Dd18653A0c69874525B802a32986D0Fedd5",
  RINKEBY_ARBITRUM: "0x83fCf37F72a52c0bD76e18595Fa0FAEe50f33125",
};

const getLiquidationBotArgs = <T = {}>(
  network: string,
  provider: Provider,
  exchange: IExchange,
  exchangeEvents: IExchangeEvents,
  exchangeAddress: string,
  argv: Arguments<LiquidationBotArgs<T>>
): {
  deployment: Deployment;
  fetcherRetryIntervalSec: number;
  checkerRetryIntervalSec: number;
  liquidatorRetryIntervalSec: number;
  liquidatorDelaySec: number;
  reporting: "console" | "pm2";
} => {
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

  const configDeploymentVersion = getEnumArg(
    "deployment-version",
    "DEPLOYMENT_VERSION",
    ["4", "4.1"],
    argv,
    { default: "4.1" }
  ) as "4" | "4.1";
  const deploymentVersion = {
    "4": "v4" as const,
    "4.1": "v4_1" as const,
  }[configDeploymentVersion];

  const liquidationBotApiAddress = getStringArg(
    "liquidation-bot",
    `${network}_LIQUIDATION_BOT`,
    argv,
    {
      default: DEFAULT_LIQUIDATION_BOT_API[network],
    }
  );

  const liquidationBotApi = LiquidationBotApi__factory.connect(
    liquidationBotApiAddress,
    provider
  );

  const deployment = deployments[deploymentVersion].init({
    exchange,
    exchangeEvents,
    liquidationBotApi,
    exchangeAddress,
    exchangeLaunchBlock,
    maxTradersPerLiquidationCheck,
    maxBlocksPerJsonRpcQuery,
  });

  // TODO It is unfortunate that an explicit type cast is needed here.  Maybe there is a way to
  // enhance `getEnumArg`?
  const reporting = getEnumArg(
    "reporting",
    "LIQUIDATION_BOT_REPORTING",
    ["console", "pm2"],
    argv,
    {
      default: "console",
      ignoreCase: true,
    }
  ) as "console" | "pm2";

  return {
    deployment,
    fetcherRetryIntervalSec,
    checkerRetryIntervalSec,
    liquidatorRetryIntervalSec,
    liquidatorDelaySec,
    reporting,
  };
};
