import type { Trader } from "@liquidationBot/types";
import type { LiquidationsResults } from "@liquidationBot/services";
import { WritableOptions, Duplex, Readable, Writable } from "node:stream";
import { EventEmitter, once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { config } from "@config";
import { CheckError, LiquidationError } from "@liquidationBot/errors";
import {
  exchangeService,
  liquidationBotService,
} from "@liquidationBot/services";

const processorConfig = config.processors.tradersLiquidator;

export type TradersLiquidatorResult =
  | { liquidatableChecksErrors: CheckError[] }
  | {
      liquidationsResults: LiquidationsResults;
      liquidationsErrors: LiquidationError[];
    };
export type TradersLiquidatorProcessor = Duplex & {
  [Symbol.asyncIterator](): AsyncIterableIterator<TradersLiquidatorResult>;
};

export function start(): TradersLiquidatorProcessor {
  const liquidatableTraders = new Set<Trader>();
  const tradersEvents = new EventEmitter();

  const saveLiquidatableTraders: WritableOptions["write"] = (
    newLiquidatableTraders: Trader[],
    _: never, // encoding. Irrelevant for streams in object mode
    callback: (error?: Error) => void
  ) => {
    newLiquidatableTraders.forEach((trader) => liquidatableTraders.add(trader));

    if (liquidatableTraders.size) {
      tradersEvents.emit("gotLiquidatableTraders", true);
    }

    callback();
  };

  type LiquidationGenerator = () => AsyncGenerator<TradersLiquidatorResult>;
  const liquidationsGenerator: LiquidationGenerator = async function* () {
    while (true) {
      if (!liquidatableTraders.size) {
        await once(tradersEvents, "gotLiquidatableTraders");
      }
      const { liquidationsResults, liquidationsErrors } =
        await exchangeService.liquidate([...liquidatableTraders]);

      const liquidatedTraders = Object.keys(liquidationsResults) as Trader[];
      liquidatedTraders.forEach((trader) => liquidatableTraders.delete(trader));

      yield { liquidationsResults, liquidationsErrors };

      if (liquidationsErrors.length) {
        // some liquidation errors may cost gas so
        // a timeout is added in order to reduce the chance of consequent errors
        await setTimeout(processorConfig.retryIntervalSec);
      }

      /*
       * before trying to liquidate traders again, check which of them are still
       * liquidatable (e.g. we don't want to try to liquidate a trader that has
       * already been liquidated by a competitor bot) and remove from the
       * nonLiquidatableTraders list ones that are not liquidatable anymore
       */
      const erroredTraders = liquidationsErrors.map(({ trader }) => trader);
      const { nonLiquidatableTraders, liquidatableChecksErrors } =
        await filterNonLiquidatableTraders(erroredTraders);
      nonLiquidatableTraders.forEach((nonLiquidatableTrader) => {
        liquidatableTraders.delete(nonLiquidatableTrader);
      });
      if (liquidatableChecksErrors.length) {
        yield { liquidatableChecksErrors };
      }
    }
  };

  async function filterNonLiquidatableTraders(traders: Trader[]) {
    const nonLiquidatableTraders = new Set<Trader>(traders);
    const liquidatableChecksErrors: CheckError[] = [];

    for await (const checkResult of liquidationBotService.filterLiquidatableTraders(
      traders
    )) {
      if (checkResult instanceof CheckError) {
        liquidatableChecksErrors.push(checkResult);
      } else {
        checkResult.forEach((liquidatableTrader) => {
          nonLiquidatableTraders.delete(liquidatableTrader);
        });
      }
    }

    return {
      nonLiquidatableTraders,
      liquidatableChecksErrors,
    };
  }

  return Duplex.from({
    writable: new Writable({
      write: saveLiquidatableTraders,
      objectMode: true,
    }),
    readable: Readable.from(liquidationsGenerator()),
  });
}
