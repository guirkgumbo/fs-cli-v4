import type { WritableOptions } from "node:stream";
import type { Trader } from "@liquidationBot/types";
import type { CheckError } from "@liquidationBot/errors";
import { Readable, Writable, Duplex } from "node:stream";
import { EventEmitter, once } from "node:events";
import { setTimeout } from "node:timers/promises";

export type TradersCheckerProcessor = Duplex & {
  [Symbol.asyncIterator](): AsyncIterableIterator<LiquidatableTradersCheckResult>;
};

export type Deployment = {
  liquidatableTradersGenerator: (
    traders: Trader[]
  ) => AsyncGenerator<LiquidatableTradersCheckResult>;
};

export type LiquidatableTradersCheckResult = Trader[] | CheckError;

export function start(
  deployment: Deployment,
  reCheckIntervalSec: number
): TradersCheckerProcessor {
  let traders: Trader[] = [];
  const tradersEvents = new EventEmitter();

  const saveActiveTraders: WritableOptions["write"] = (
    activeTraders: Trader[],
    _: never, // encoding. Irrelevant for streams in object mode
    callback: (error?: Error) => void
  ) => {
    traders = activeTraders;

    if (traders.length) {
      tradersEvents.emit("gotActiveTraders", true);
    }

    callback();
  };

  const liquidatableTradersGenerator = async function* () {
    while (true) {
      if (!traders.length) {
        await once(tradersEvents, "gotActiveTraders");
      }
      yield* deployment.liquidatableTradersGenerator(traders);
      await setTimeout(reCheckIntervalSec * 1_000);
    }
  };

  return Duplex.from({
    writable: new Writable({ write: saveActiveTraders, objectMode: true }),
    readable: Readable.from(liquidatableTradersGenerator()),
  });
}
