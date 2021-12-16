import { setTimeout } from "node:timers/promises";
import { Readable } from "node:stream";
import type { Trader } from "@liquidationBot/types";
import { FetchError } from "@liquidationBot/errors";
import { tradersService } from "@liquidationBot/services";
import { Provider } from "@ethersproject/providers";
import { IExchangeEvents } from "@generated/IExchangeEvents";

export type TradersFetcherResult = Trader[] | FetchError;
export type TradersFetcherProcessor = Readable & {
  [Symbol.asyncIterator](): AsyncIterableIterator<TradersFetcherResult>;
};

export function start(
  provider: Provider,
  exchangeEvents: IExchangeEvents,
  startBlock: number,
  maxBlocksPerJsonRpcQuery: number,
  reFetchIntervalSec: number
): TradersFetcherProcessor {
  const tradersGenerator = async function* () {
    let activeTraders: Trader[] = [];
    let lastBlockRead = startBlock;

    while (true) {
      try {
        const { updatedActiveTraders, latestBlock } =
          await tradersService.getUpdatedActiveTraders(
            provider,
            exchangeEvents,
            maxBlocksPerJsonRpcQuery,
            activeTraders,
            lastBlockRead
          );
        activeTraders = updatedActiveTraders;
        lastBlockRead = latestBlock;

        yield activeTraders;
      } catch (error) {
        yield new FetchError(error);
      }
      await setTimeout(reFetchIntervalSec * 1_000);
    }
  };

  return Readable.from(tradersGenerator());
}
