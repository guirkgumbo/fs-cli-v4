export type {
  TradersFetcherProcessor,
  TradersFetcherResult,
} from "./tradersFetcher";
export type { TradersCheckerProcessor } from "./tradersChecker";
export type {
  TradersLiquidatorProcessor,
  TradersLiquidatorResult,
} from "./tradersLiquidator";

import * as tradersFetcher from "./tradersFetcher";
import * as tradersChecker from "./tradersChecker";
import * as tradersLiquidator from "./tradersLiquidator";

export const tradersFetcherProcessor = tradersFetcher;
export const tradersCheckerProcessor = tradersChecker;
export const tradersLiquidatorProcessor = tradersLiquidator;
