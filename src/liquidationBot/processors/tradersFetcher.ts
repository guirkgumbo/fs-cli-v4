import type { Provider } from "@ethersproject/providers";
import type { Trader } from "@liquidationBot/types";
import { setTimeout } from "node:timers/promises";
import { Readable } from "node:stream";
import { FetchError } from "@liquidationBot/errors";

export type TradersFetcherProcessor = Readable & {
  [Symbol.asyncIterator](): AsyncIterableIterator<TradersFetcherResult>;
};

export type Deployment = {
  getActiveTraders: (provider: Provider) => Promise<TradersFetcherResult>;
};

export type TradersFetcherResult = Trader[] | FetchError;

export function start(
  deployment: Deployment,
  provider: Provider,
  reFetchIntervalSec: number
): TradersFetcherProcessor {
  const tradersGenerator = async function* () {
    while (true) {
      yield await deployment.getActiveTraders(provider);
      await setTimeout(reFetchIntervalSec * 1_000);
    }
  };

  return Readable.from(tradersGenerator());
}
