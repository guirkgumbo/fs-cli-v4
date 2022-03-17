import type { Provider } from "@ethersproject/providers";
import type { IExchangeLedger } from "@generated/IExchangeLedger";
import type { LiquidationBotApiV2 } from "@generated/LiquidationBotApiV2";
import type { TradeRouter } from "@generated/TradeRouter";
import type { Deployment } from "@liquidationBot/bot";
import {
  CheckError,
  FetchError,
  LiquidationError,
} from "@liquidationBot/errors";
import type { LiquidationsResults } from "@liquidationBot/processors/tradersLiquidator";
import type { Trader } from "@liquidationBot/types";
import { chunk } from "lodash";
import type { GetTypedEventTypeFromFilter } from "./common";
import { GetEvents, Positions, PositionState, UnpackEvent } from "./positions";

type DeploymentConfig = {
  tradeRouter: TradeRouter;
  exchangeLedger: IExchangeLedger;
  liquidationBotApi: LiquidationBotApiV2;
  tradeRouterAddress: string;
  exchangeLaunchBlock: number;
  maxTradersPerLiquidationCheck: number;
  maxBlocksPerJsonRpcQuery: number;
};

export const init = ({
  tradeRouter,
  exchangeLedger,
  liquidationBotApi,
  tradeRouterAddress,
  exchangeLaunchBlock,
  maxTradersPerLiquidationCheck,
  maxBlocksPerJsonRpcQuery,
}: DeploymentConfig): Deployment => {
  /*
   * === TradersFetcherProcessorDeployment ===
   */

  let positions: Positions = new Positions(exchangeLaunchBlock);

  const positionHistoryIsComplete = (): boolean =>
    positions.historyIsComplete();

  type Event = GetTypedEventTypeFromFilter<
    IExchangeLedger["filters"]["PositionChanged"]
  >;

  const getEvents: GetEvents<Event> = async (
    fromBlock: number,
    toBlock: number
  ): Promise<Event[]> => {
    const eventFilter = exchangeLedger.filters.PositionChanged();
    return exchangeLedger.queryFilter(eventFilter, fromBlock, toBlock);
  };

  const unpackEvent: UnpackEvent<Event> = (
    event: Event
  ): [string, number, number, PositionState] | undefined => {
    const { args, blockNumber: block, transactionIndex: transaction } = event;
    const {
      trader: address,
      startAsset,
      startStable,
      totalAsset,
      totalStable,
    } = args.cpd;

    if (startAsset.isZero() && startStable.isZero()) {
      return [address, block, transaction, PositionState.Open];
    } else if (totalAsset.isZero() && totalStable.isZero()) {
      return [address, block, transaction, PositionState.Closed];
    } else {
      return undefined;
    }
  };

  const fetchPositionHistory = async (
    provider: Provider
  ): Promise<void | FetchError> => {
    const getCurrentBlock = () => provider.getBlockNumber();
    try {
      positions.fetchHistory(
        maxBlocksPerJsonRpcQuery,
        getCurrentBlock,
        getEvents,
        unpackEvent
      );
    } catch (error: any) {
      return new FetchError(error);
    }
  };

  const fetchNewPositions = async (
    provider: Provider
  ): Promise<void | FetchError> => {
    const getCurrentBlock = () => provider.getBlockNumber();
    try {
      positions.fetchNew(
        maxBlocksPerJsonRpcQuery,
        getCurrentBlock,
        getEvents,
        unpackEvent
      );
    } catch (error: any) {
      return new FetchError(error);
    }
  };

  const getOpenPositions = (): Trader[] => positions.getOpen() as Trader[];

  const historyBlocksLeft = (): number => positions.historyBlocksLeft();

  /*
   * === TradersCheckerProcessorDeployment ===
   */

  async function* liquidatableTradersGenerator(traders: Trader[]) {
    const chunksOfTraders = chunk(traders, maxTradersPerLiquidationCheck);
    for (const [chunkIndex, chunkOfTraders] of chunksOfTraders.entries()) {
      try {
        const areLiquidatable =
          await liquidationBotApi.callStatic.isLiquidatable(
            tradeRouterAddress,
            chunkOfTraders
          );

        const liquidatableTraders = areLiquidatable.flatMap(
          (isLiquidatable, i) => {
            const traderIndex = chunkIndex * maxTradersPerLiquidationCheck + i;
            return isLiquidatable ? traders[traderIndex] : [];
          }
        );

        yield liquidatableTraders;
      } catch (error) {
        const from = chunkIndex * maxTradersPerLiquidationCheck;
        yield new CheckError(chunkOfTraders, from, traders.length, error);
      }
    }
  }

  /*
   * === TradersLiquidatorProcessorDeployment ===
   */

  async function filterLiquidatableTraders(traders: Trader[]) {
    const liquidatableTraders = [];
    const liquidatableChecksErrors = [];

    for await (const checkResult of liquidatableTradersGenerator(traders)) {
      checkResult instanceof CheckError
        ? liquidatableChecksErrors.push(checkResult)
        : liquidatableTraders.push(...checkResult);
    }

    return {
      liquidatableTraders,
      liquidatableChecksErrors,
    };
  }

  async function liquidate(traders: Set<Trader>) {
    const liquidationsResults: LiquidationsResults = {};
    const liquidationsErrors: LiquidationError[] = [];

    for (const trader of traders) {
      try {
        liquidationsResults[trader] = await tradeRouter.liquidate(trader);
      } catch (error) {
        liquidationsErrors.push(new LiquidationError(trader, error));
      }
    }

    return { liquidationsResults, liquidationsErrors };
  }

  return {
    positionHistoryIsComplete,
    historyBlocksLeft,
    fetchPositionHistory,
    fetchNewPositions,
    getOpenPositions,
    liquidatableTradersGenerator,
    filterLiquidatableTraders,
    liquidate,
  };
};
