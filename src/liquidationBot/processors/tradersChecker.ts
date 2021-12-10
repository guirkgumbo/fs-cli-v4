import type { WritableOptions } from "node:stream";
import type { Trader } from "@liquidationBot/types";
import type { LiquidatableTradersCheckResult } from "@liquidationBot/services";
import { Readable, Writable, Duplex } from "node:stream";
import { EventEmitter, once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { FilterLiquidatableTraders } from "@liquidationBot/services/liquidationBot";

export type TradersCheckerProcessor = Duplex & {
  [Symbol.asyncIterator](): AsyncIterableIterator<LiquidatableTradersCheckResult>;
};

export function start(
  reCheckIntervalSec: number,
  filterLiquidatableTraders: FilterLiquidatableTraders
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
      yield* filterLiquidatableTraders(traders);
      await setTimeout(reCheckIntervalSec * 1_000);
    }
  };

  return Duplex.from({
    writable: new Writable({ write: saveActiveTraders, objectMode: true }),
    readable: Readable.from(liquidatableTradersGenerator()),
  });
}
