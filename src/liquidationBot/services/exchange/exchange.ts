import type { ContractTransaction } from "ethers";
import type { LastTraderActions, Trader } from "@liquidationBot/types";
import { TraderAction } from "@liquidationBot/types";
import { LiquidationError } from "@liquidationBot/errors";
import { IExchange } from "@generated/IExchange";
import { IExchangeEvents } from "@generated/IExchangeEvents";
import { Provider } from "@ethersproject/providers";

export type LiquidationsResults = { [k in Trader]: ContractTransaction };

type Liquidate = (
  exchange: IExchange,
  traders: Trader[]
) => Promise<{
  liquidationsResults: LiquidationsResults;
  liquidationsErrors: LiquidationError[];
}>;

type ActiveTradersResults = {
  lastTraderActions: LastTraderActions;
  latestBlock: number;
};

export const getLastTraderActionsSince = async (
  provider: Provider,
  exchangeEvents: IExchangeEvents,
  startBlock: number,
  maxBlocksPerJsonRpcQuery: number
): Promise<ActiveTradersResults> => {
  const eventFilter = exchangeEvents.filters.PositionChanged(
    null,
    null,
    null,
    null,
    null,
    null,
    null
  );
  const currentBlockNumber = await provider.getBlockNumber();

  const lastTraderActions: LastTraderActions = {};
  // Process blocks in smaller batches to avoid hitting the provider's limit.
  for (
    let rangeStart = startBlock;
    rangeStart < currentBlockNumber;
    rangeStart += maxBlocksPerJsonRpcQuery + 1
  ) {
    // Only fetch up to the current block when the last block range is smaller
    // than max number of blocks we can fetch.
    const rangeEnd = Math.min(
      rangeStart + maxBlocksPerJsonRpcQuery,
      currentBlockNumber
    );
    const changePositionsEvents = await exchangeEvents.queryFilter(
      eventFilter,
      rangeStart,
      rangeEnd
    );
    for (const event of changePositionsEvents) {
      const previousAsset = event.args.previousAsset;
      const previousStable = event.args.previousStable;
      const newAsset = event.args.newAsset;
      const newStable = event.args.newStable;
      const trader = event.args.trader as Trader;

      // Override the previous last action of this trader.
      if (previousAsset.isZero() && previousStable.isZero()) {
        lastTraderActions[trader] = TraderAction.OpenPosition;
      } else if (newAsset.isZero() && newStable.isZero()) {
        lastTraderActions[trader] = TraderAction.ClosePosition;
      }
    }
  }

  return { lastTraderActions, latestBlock: currentBlockNumber };
};

export const liquidate: Liquidate = async (exchange, traders) => {
  const liquidationsResults: LiquidationsResults = {};
  const liquidationsErrors: LiquidationError[] = [];

  for (const trader of traders) {
    try {
      liquidationsResults[trader] = await exchange.liquidate(trader);
    } catch (error) {
      liquidationsErrors.push(new LiquidationError(trader, error));
    }
  }

  return { liquidationsResults, liquidationsErrors };
};
