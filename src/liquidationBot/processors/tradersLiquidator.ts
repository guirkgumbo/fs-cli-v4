import type { Trader } from "@liquidationBot/types";
import type { CheckError, LiquidationError } from "@liquidationBot/errors";
import { WritableOptions, Duplex, Readable, Writable } from "node:stream";
import { EventEmitter, once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { ContractTransaction } from "ethers";

export type TradersLiquidatorProcessor = Duplex & {
  [Symbol.asyncIterator](): AsyncIterableIterator<TradersLiquidatorResult>;
};

export type TradersLiquidatorResult =
  | { liquidatableChecksErrors: CheckError[] }
  | {
      liquidationsResults: LiquidationsResults;
      liquidationsErrors: LiquidationError[];
    };

export type LiquidationsResults = { [k in Trader]: ContractTransaction };

export type Deployment = {
  liquidate: (traders: Set<Trader>) => Promise<{
    liquidationsResults: LiquidationsResults;
    liquidationsErrors: LiquidationError[];
  }>;
  filterLiquidatableTraders: (traders: Trader[]) => Promise<{
    liquidatableTraders: Trader[];
    liquidatableChecksErrors: CheckError[];
  }>;
};

export function start(
  deployment: Deployment,
  retryIntervalSec: number,
  delaySec: number
): TradersLiquidatorProcessor {
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
      if (delaySec) {
        await setTimeout(delaySec * 1_000);
      }
      const { liquidationsResults, liquidationsErrors } =
        await deployment.liquidate(liquidatableTraders);

      const liquidatedTraders = Object.keys(liquidationsResults) as Trader[];
      liquidatedTraders.forEach((trader) => liquidatableTraders.delete(trader));

      yield { liquidationsResults, liquidationsErrors };

      if (liquidationsErrors.length) {
        // some liquidation errors may cost gas so
        // a timeout is added in order to reduce the chance of consequent errors
        await setTimeout(retryIntervalSec * 1_000);
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
    const nonLiquidatable = new Set<Trader>(traders);

    const { liquidatableTraders, liquidatableChecksErrors } =
      await deployment.filterLiquidatableTraders(traders);

    liquidatableTraders.forEach((trader) => nonLiquidatable.delete(trader));

    return {
      nonLiquidatableTraders: nonLiquidatable,
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
