import type { Provider } from "@ethersproject/providers";
import { LiquidationBotApiV2__factory } from "@generated/factories/LiquidationBotApiV2__factory";
import { LiquidationBotApi__factory } from "@generated/factories/LiquidationBotApi__factory";
import type { IExchange } from "@generated/IExchange";
import type { IExchangeEvents } from "@generated/IExchangeEvents";
import type { IExchangeLedger } from "@generated/IExchangeLedger";
import type { TradeRouter } from "@generated/TradeRouter";
import type { Deployment } from "./bot";
import { liquidationBot } from "./bot";
import * as deployments from "./deployments";
import * as reporting from "./reporting";

export { cli, parseCli } from "./cli";

type CommonArguments = {
  provider: Provider;
  fetcherRetryIntervalSec: number;
  checkerRetryIntervalSec: number;
  liquidatorRetryIntervalSec: number;
  liquidatorDelaySec: number;
  reporting: "console" | "pm2";
  maxTradersPerLiquidationCheck: number;
  maxBlocksPerJsonRpcQuery: number;
  exchangeLaunchBlock: number;
  liquidationBotApiAddress: string;
};

type ArgumentsV4 = CommonArguments & {
  deploymentVersion: "v4";
  exchange: IExchange;
  exchangeEvents: IExchangeEvents;
  exchangeAddress: string;
};

type ArgumentsV4_1 = CommonArguments & {
  deploymentVersion: "v4_1";
  tradeRouter: TradeRouter;
  exchangeLedger: IExchangeLedger;
  tradeRouterAddress: string;
};

export type LiquidationBotArguments = ArgumentsV4 | ArgumentsV4_1;

export const run = async (args: LiquidationBotArguments) => {
  const bot = liquidationBot.start(
    getDeployment(args),
    args.provider,
    args.fetcherRetryIntervalSec,
    args.checkerRetryIntervalSec,
    args.liquidatorRetryIntervalSec,
    args.liquidatorDelaySec
  );

  let reportingProcess =
    args.reporting == "pm2"
      ? reporting.pm2.start(liquidationBot)
      : reporting.console.start(liquidationBot);

  await Promise.race([bot, reportingProcess]);
};

function getDeployment(args: LiquidationBotArguments): Deployment {
  const {
    exchangeLaunchBlock,
    maxTradersPerLiquidationCheck,
    maxBlocksPerJsonRpcQuery,
  } = args;

  switch (args.deploymentVersion) {
    case "v4": {
      const { exchange, exchangeEvents, exchangeAddress } = args;
      const liquidationBotApi = LiquidationBotApi__factory.connect(
        args.liquidationBotApiAddress,
        args.provider
      );
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
      const { tradeRouter, exchangeLedger, tradeRouterAddress } = args;
      const liquidationBotApi = LiquidationBotApiV2__factory.connect(
        args.liquidationBotApiAddress,
        args.provider
      );
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
}
