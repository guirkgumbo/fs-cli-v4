import type { Provider } from "@ethersproject/providers";
import type { IExchangeLedger } from "@generated/IExchangeLedger";
import type { TradeRouter } from "@generated/TradeRouter";
import type { LiquidationBotApiV2 } from "@generated/LiquidationBotApiV2";
import type { Trader } from "@liquidationBot/types";
import type { Deployment } from "@liquidationBot/bot";
import type { LiquidationsResults } from "@liquidationBot/processors/tradersLiquidator";
import { chunk } from "lodash";
import {
  CheckError,
  FetchError,
  LiquidationError,
} from "@liquidationBot/errors";

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
  let lastBlockRead = exchangeLaunchBlock;
  let activeTraders: Trader[] = [];

  return {
    getActiveTraders,
    liquidatableTradersGenerator,
    filterLiquidatableTraders,
    liquidate,
  };

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

  async function getActiveTraders(provider: Provider) {
    try {
      const currentBlockNumber = await provider.getBlockNumber();
      const { openedTraders, closedTraders } = await getOpenedAndClosedTraders(
        lastBlockRead,
        currentBlockNumber
      );

      activeTraders = [...activeTraders, ...openedTraders].filter(
        (trader) => !closedTraders.has(trader)
      );
      lastBlockRead = currentBlockNumber;

      return activeTraders;
    } catch (error) {
      return new FetchError(error);
    }
  }

  async function getOpenedAndClosedTraders(
    startBlock: number,
    endBlock: number
  ): Promise<{ closedTraders: Set<Trader>; openedTraders: Set<Trader> }> {
    const eventFilter = exchangeLedger.filters.PositionChanged(null);

    const openedTraders: Set<Trader> = new Set();
    const closedTraders: Set<Trader> = new Set();
    // Process blocks in smaller batches to avoid hitting the provider's limit.
    for (
      let rangeStart = startBlock;
      rangeStart < endBlock;
      rangeStart += maxBlocksPerJsonRpcQuery + 1
    ) {
      // Only fetch up to the current block when the last block range is smaller
      // than max number of blocks we can fetch.
      const rangeEnd = Math.min(
        rangeStart + maxBlocksPerJsonRpcQuery,
        endBlock
      );
      const changePositionsEvents = await exchangeLedger.queryFilter(
        eventFilter,
        rangeStart,
        rangeEnd
      );
      for (const { args } of changePositionsEvents) {
        const { startAsset, startStable, totalAsset, totalStable } = args.cpd;
        const trader = args.cpd.trader as Trader;

        if (startAsset.isZero() && startStable.isZero()) {
          openedTraders.add(trader);
        } else if (totalAsset.isZero() && totalStable.isZero()) {
          closedTraders.add(trader);
        }
      }
    }

    return { openedTraders, closedTraders };
  }
};
