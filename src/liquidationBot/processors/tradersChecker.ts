import type { WritableOptions } from "node:stream";
import type { Trader } from "@liquidationBot/types";
import type { LiquidatableTradersCheckResult } from "@liquidationBot/services";
import { Readable, Writable, Duplex } from "node:stream";
import { EventEmitter, once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { config } from "@config";
import { liquidationBotService } from "@liquidationBot/services";

const processorConfig = config.processors.tradersChecker;
const RECHECK_INTERVAL = processorConfig.recheckIntervalSec * 1_000;

export type TradersCheckerProcessor = Duplex & {
  [Symbol.asyncIterator](): AsyncIterableIterator<LiquidatableTradersCheckResult>;
};

export function start(): TradersCheckerProcessor {
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
      yield* liquidationBotService.filterLiquidatableTraders(traders);
      await setTimeout(RECHECK_INTERVAL);
    }
  };

  return Duplex.from({
    writable: new Writable({ write: saveActiveTraders, objectMode: true }),
    readable: Readable.from(liquidatableTradersGenerator()),
  });
}
