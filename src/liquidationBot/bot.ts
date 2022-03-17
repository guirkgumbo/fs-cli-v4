import { Provider } from "@ethersproject/providers";
import type { ContractTransaction } from "ethers";
import type { Trader } from "@liquidationBot/types";
import type { Reportable } from "@liquidationBot/reporting/types";
import type {
  TradersCheckerProcessor,
  TradersFetcherProcessor,
  TradersLiquidatorResult,
  TradersFetcherProcessorDeployment,
  TradersCheckerProcessorDeployment,
  TradersLiquidatorProcessorDeployment,
} from "@liquidationBot/processors";
import { pipeline } from "node:stream/promises";
import { EventEmitter, on } from "node:events";
import {
  FetchError,
  CheckError,
  LiquidationError,
} from "@liquidationBot/errors";
import {
  tradersFetcherProcessor,
  tradersCheckerProcessor,
  tradersLiquidatorProcessor,
} from "@liquidationBot/processors";

export type LiquidationBot = Reportable & {
  start: (
    deployment: Deployment,
    provider: Provider,
    historyFetchIntervalSec: number,
    fetcherRetryIntervalSec: number,
    checkerRetryIntervalSec: number,
    liquidatorRetryIntervalSec: number,
    liquidatorDelaySec: number
  ) => Promise<void>;
  join: () => Promise<void>;
  stop: () => Promise<void>;
};

export type Deployment = TradersFetcherProcessorDeployment &
  TradersCheckerProcessorDeployment &
  TradersLiquidatorProcessorDeployment;

type EventsIterator = AsyncIterableIterator<
  [
    | { type: "error"; error: FetchError | CheckError | LiquidationError }
    | { type: "tradersFetched"; activeTraders: Trader[] }
    | { type: "tradersChecked"; checkedTraders: Trader[] }
    | {
        type: "traderLiquidated";
        trader: Trader;
        contractTransaction: ContractTransaction;
      }
  ]
>;

const botEventEmitter = new EventEmitter({ captureRejections: true });

let isRunning = null as null | Promise<boolean | void>;
let botAbortController: AbortController;

process.on("SIGINT", async () => {
  if (isRunning) {
    await liquidationBot.stop();
  }
  process.exit();
});

export const liquidationBot: LiquidationBot = {
  start,
  join,
  stop,
  getEventsIterator: () =>
    // on() generates an AsyncIterator with events as arrays
    // This generator is just unwrapping events from single elements arrays
    (async function* () {
      const eventsIterator = on(botEventEmitter, "report") as EventsIterator;
      for await (const [events] of eventsIterator) {
        yield events;
      }
    })(),
};

function start(
  deployment: Deployment,
  provider: Provider,
  historyFetchIntervalSec: number,
  fetcherRetryIntervalSec: number,
  checkerRetryIntervalSec: number,
  liquidatorRetryIntervalSec: number,
  liquidatorDelaySec: number
) {
  if (isRunning) {
    throw Error("Cannot start liquidation bot - it is already running");
  }
  botAbortController = new AbortController();

  return (isRunning = pipeline(
    tradersFetcherProcessor.start(
      deployment,
      provider,
      historyFetchIntervalSec,
      fetcherRetryIntervalSec
    ),
    fetcherToCheckerAdapterAndReporter,
    tradersCheckerProcessor.start(deployment, checkerRetryIntervalSec),
    checkerToLiquidatorAdapterAndReporter,
    tradersLiquidatorProcessor.start(
      deployment,
      liquidatorRetryIntervalSec,
      liquidatorDelaySec
    ),
    liquidatorReporter,
    { signal: botAbortController.signal }
  ).catch((error) => {
    // https://nodejs.org/api/errors.html#abort_err
    if (error.code === "ABORT_ERR") {
      botEventEmitter.emit("report", { type: "botStopped" });
      botEventEmitter.removeAllListeners();
    } else {
      throw error;
    }
  }));
}

// Wait for the bot to stop.
async function join() {
  if (isRunning) {
    await isRunning;
    isRunning = null;
  }
}

async function stop() {
  if (!isRunning) {
    throw Error("Cannot stop liquidation bot - it is not running");
  }
  botAbortController.abort();
  await isRunning;
  isRunning = null;
}

async function* fetcherToCheckerAdapterAndReporter(
  fetcherStream: TradersFetcherProcessor
) {
  for await (const fetcherResult of fetcherStream) {
    if (fetcherResult instanceof FetchError) {
      botEventEmitter.emit("report", { type: "error", error: fetcherResult });
    } else {
      botEventEmitter.emit("report", {
        type: "tradersFetched",
        activeTraders: fetcherResult,
      });
      yield fetcherResult;
    }
  }
}

async function* checkerToLiquidatorAdapterAndReporter(
  checkerStream: TradersCheckerProcessor
) {
  for await (const checkerResult of checkerStream) {
    if (checkerResult instanceof CheckError) {
      botEventEmitter.emit("report", { type: "error", error: checkerResult });
    } else {
      botEventEmitter.emit("report", {
        type: "tradersChecked",
        checkedTraders: checkerResult,
      });
      yield checkerResult;
    }
  }
}

async function* liquidatorReporter(
  liquidatorStream: AsyncIterable<TradersLiquidatorResult>
) {
  for await (const liquidatorResult of liquidatorStream) {
    if ("liquidatableChecksErrors" in liquidatorResult) {
      liquidatorResult.liquidatableChecksErrors.forEach((error) => {
        botEventEmitter.emit("report", { type: "error", error });
      });
    } else {
      const { liquidationsErrors, liquidationsResults } = liquidatorResult;
      liquidationsErrors.forEach((error) => {
        botEventEmitter.emit("report", { type: "error", error });
      });
      Object.entries(liquidationsResults).forEach(
        ([trader, contractTransaction]) => {
          botEventEmitter.emit("report", {
            type: "traderLiquidated",
            trader,
            contractTransaction,
          });
        }
      );
    }
  }
}
