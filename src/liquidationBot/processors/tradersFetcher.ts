import { setTimeout } from "node:timers/promises";
import { Readable } from "node:stream";
import type { Trader } from "@liquidationBot/types";
import { FetchError } from "@liquidationBot/errors";
import { tradersService } from "@liquidationBot/services";

export type TradersFetcherResult = Trader[] | FetchError;
export type TradersFetcherProcessor = Readable & {
  [Symbol.asyncIterator](): AsyncIterableIterator<TradersFetcherResult>;
};

export function start(
  tradesUrl: string,
  reFetchIntervalSec: number
): TradersFetcherProcessor {
  const tradersGenerator = async function* () {
    while (true) {
      try {
        const traders = await tradersService.getOpen(tradesUrl);
        yield traders;
      } catch (error) {
        yield new FetchError(tradesUrl, error);
      }
      await setTimeout(reFetchIntervalSec * 1_000);
    }
  };

  return Readable.from(tradersGenerator());
}
