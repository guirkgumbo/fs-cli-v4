import { Signer } from "@ethersproject/abstract-signer";
import { Provider } from "@ethersproject/providers";
import { LiquidationBotApi__factory } from "@generated/factories/LiquidationBotApi__factory";
import { IExchange } from "@generated/IExchange";
import { LiquidationBotApi } from "@generated/LiquidationBotApi";
import { getEnumArg, getNumberArg, getStringArg } from "config/args";
import { Arguments, Argv } from "yargs";
import {
  checkDefined,
  ExchangeArgs,
  GetExchangeWithSignerArgv,
  WithSignerArgs,
} from "..";
import { liquidationBot } from "./bot";
import * as reporting from "./reporting";

type LiquidationBotKeys<T = {}> = T & {
  "liquidation-bot": string | undefined;
  "trades-url-prefix": string | undefined;
  "refetch-interval": number | undefined;
  "recheck-interval": number | undefined;
  "liquidation-retry-interval": number | undefined;
  "max-traders-per-liquidation-check": number | undefined;
  reporting: string | undefined;
};

export type LiquidationBotArgs<T = {}> = WithSignerArgs<
  ExchangeArgs<LiquidationBotKeys<T>>
>;

export const DEFAULT_TRADES_URL_PREFIX =
  "https://xek9m45jkh.execute-api.us-east-1.amazonaws.com/Prod/api/v2/__hidden__trades?exchangeAddress=";

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
    .option("trades-url-prefix", {
      describe:
        "Trade indexer URL, except for the exchange address.\n" +
        ".env property: TRADES_URL_PREFIX\n" +
        `Defaults to: ${DEFAULT_TRADES_URL_PREFIX}`,
      type: "string",
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
    });
};

export const run = async (
  initConfig: () => void,
  getExchangeWithSigner: <T>(argv: GetExchangeWithSignerArgv<T>) => {
    network: string;
    signer: Signer;
    exchangeAddress: string;
    exchange: IExchange;
  },
  argv: Arguments<LiquidationBotArgs<{}>>
) => {
  initConfig();

  const { network, signer, exchange } = getExchangeWithSigner(argv);

  const provider = checkDefined(
    signer.provider,
    "Internal error: Signer for the exchange does not have a provider"
  );

  const {
    liquidationBotApi,
    tradesUrlPrefix,
    fetcherRetryIntervalSec,
    checkerRetryIntervalSec,
    liquidatorRetryIntervalSec,
    maxTradersPerLiquidationCheck,
    reporting: reportingType,
  } = getLiquidationBotArgs(network, provider, argv);

  const bot = liquidationBot.start(
    exchange,
    liquidationBotApi,
    tradesUrlPrefix + exchange.address.toLowerCase(),
    fetcherRetryIntervalSec,
    checkerRetryIntervalSec,
    liquidatorRetryIntervalSec,
    maxTradersPerLiquidationCheck
  );

  let reportingProcess =
    reportingType == "pm2"
      ? reporting.pm2.start(liquidationBot)
      : reporting.console.start(liquidationBot);

  await Promise.race([bot, reportingProcess]);
};

const DEFAULT_LIQUIDATION_BOT_API: { [network: string]: string } = {
  MAINNET_ARBITRUM: "0xbFAb47F47853a59ce68226D7ac9b58c5b402D5d0",
  RINKEBY_ARBITRUM: "0x5C317200755dD3eDa0593C6aB8EbCE1265C75786",
};

const getLiquidationBotArgs = <T = {}>(
  network: string,
  provider: Provider,
  argv: Arguments<LiquidationBotArgs<T>>
): {
  liquidationBotApi: LiquidationBotApi;
  tradesUrlPrefix: string;
  fetcherRetryIntervalSec: number;
  checkerRetryIntervalSec: number;
  liquidatorRetryIntervalSec: number;
  maxTradersPerLiquidationCheck: number;
  reporting: "console" | "pm2";
} => {
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

  const tradesUrlPrefix = getStringArg("trades-url-prefix", "TRADE_INDEXER", argv, {
    default: DEFAULT_TRADES_URL_PREFIX,
  });
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
  const maxTradersPerLiquidationCheck = getNumberArg(
    "max-traders-per-liquidation-check",
    "MAX_TRADERS_PER_LIQUIDATION_CHECK",
    argv,
    { isInt: true, isPositive: true, default: 1_000 }
  );

  // TODO It is unfortunate that an explicit type cast is needed here.  Maybe there is a way to
  // enhance `getEnumArg`?
  const reporting = getEnumArg(
    "reporting",
    "LIQUIDATION_BOT_REPORTING",
    ["console", "pm2"],
    argv,
    { default: "console" }
  ) as "console" | "pm2";

  return {
    liquidationBotApi,
    tradesUrlPrefix,
    fetcherRetryIntervalSec,
    checkerRetryIntervalSec,
    liquidatorRetryIntervalSec,
    maxTradersPerLiquidationCheck,
    reporting,
  };
};
