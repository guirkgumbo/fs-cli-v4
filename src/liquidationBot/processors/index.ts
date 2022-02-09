export type {
  TradersFetcherProcessor,
  TradersFetcherResult,
  Deployment as TradersFetcherProcessorDeployment,
} from "./tradersFetcher";
export type {
  TradersCheckerProcessor,
  Deployment as TradersCheckerProcessorDeployment,
} from "./tradersChecker";
export type {
  TradersLiquidatorProcessor,
  TradersLiquidatorResult,
  Deployment as TradersLiquidatorProcessorDeployment,
} from "./tradersLiquidator";

import * as tradersFetcher from "./tradersFetcher";
import * as tradersChecker from "./tradersChecker";
import * as tradersLiquidator from "./tradersLiquidator";

export const tradersFetcherProcessor = tradersFetcher;
export const tradersCheckerProcessor = tradersChecker;
export const tradersLiquidatorProcessor = tradersLiquidator;
