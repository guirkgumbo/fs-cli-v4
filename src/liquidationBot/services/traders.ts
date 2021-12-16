import type { Trader } from "@liquidationBot/types";
import { TraderAction } from "@liquidationBot/types";
import { exchangeService } from "@liquidationBot/services";
import { Provider } from "@ethersproject/providers";
import { IExchangeEvents } from "@generated/IExchangeEvents";

type ActiveTradersResults = {
  updatedActiveTraders: Trader[];
  latestBlock: number;
};

export const getUpdatedActiveTraders = async (
  provider: Provider,
  exchangeEvents: IExchangeEvents,
  maxBlocksPerJsonRpcQuery: number,
  currActiveTraders: Trader[],
  lastBlockRead: number
): Promise<ActiveTradersResults> => {
  const { lastTraderActions, latestBlock } =
    await exchangeService.getLastTraderActionsSince(
      provider,
      exchangeEvents,
      lastBlockRead,
      maxBlocksPerJsonRpcQuery
    );

  // Remove traders who recently closed and add those who recent opened positions.
  const updatedActiveTraders = currActiveTraders.filter(
    (trader) => lastTraderActions[trader] != TraderAction.ClosePosition
  );
  for (const trader in lastTraderActions) {
    const castTrader = trader as Trader;
    if (lastTraderActions[trader as Trader] == TraderAction.OpenPosition) {
      updatedActiveTraders.push(castTrader);
    }
  }

  return {
    updatedActiveTraders,
    latestBlock,
  };
};
