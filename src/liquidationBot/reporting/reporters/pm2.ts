import type { ReportEvent } from "@liquidationBot/reporting/types";
// @ts-ignore - package doesn't have types
import tx2 from "tx2";
import { logError } from "@liquidationBot/reporting/utils";

/*
 * Error from any subsystem.
 */
let lastErrorTime: number | undefined;

const errorsCounter = tx2.counter({ name: "Errors" });
tx2.metric({
  name: "Since error",
  value: () => getDurationStr(lastErrorTime),
});

/*
 * Liquidations.
 */

let lastLiquidationTime: number | undefined;

const liquidationsCounter = tx2.counter({ name: "Liquidations" });
tx2.metric({
  name: "Since liquidation",
  value: () => getDurationStr(lastLiquidationTime),
});

/*
 * Trader information retrieval.
 */

let numberOfActiveTraders = 0;
let lastFetchTime: number | undefined;
let beforeLastFetchTime: number | undefined;
let tradingHistoryLoadingState: "loading" | number | "done" = "loading";

tx2.metric({
  name: "Active traders",
  value: () => numberOfActiveTraders,
});
tx2.metric({
  name: "Since traders fetch",
  value: () => getDurationStr(lastFetchTime),
});
tx2.metric({
  name: "Previous fetch",
  value: () => getDurationStr(beforeLastFetchTime, lastFetchTime),
});
tx2.metric({
  name: "Trading history",
  value: () => {
    switch (tradingHistoryLoadingState) {
      case "loading":
        return "loading";

      case "done":
        return "done";

      default:
        return `loading, ${tradingHistoryLoadingState} blocks to go`;
    }
  },
});

/*
 * Liquidatable checks.
 */
let lastCheckTime: number | undefined;
let beforeLastCheckTime: number | undefined;

tx2.metric({
  name: "Since liquidatable check",
  value: () => getDurationStr(lastCheckTime),
});
tx2.metric({
  name: "Previous check",
  value: () => getDurationStr(beforeLastCheckTime, lastCheckTime),
});

const fetchCycleCounter = tx2.counter({ name: "Successful fetch cycles" });
const checkCycleCounter = tx2.counter({ name: "Successful check cycles" });

export const reportEvent: ReportEvent = async (event) => {
  switch (event.type) {
    case "error": {
      errorsCounter.inc();
      lastErrorTime = Date.now();

      logError(event.error);
      break;
    }
    case "tradersFetched": {
      fetchCycleCounter.inc();
      beforeLastFetchTime = lastFetchTime;
      lastFetchTime = Date.now();

      const { activeTraders, historyIsComplete, historyBlocksLeft } = event;

      numberOfActiveTraders = activeTraders.length;
      if (historyIsComplete) {
        tradingHistoryLoadingState = "done";
      } else {
        tradingHistoryLoadingState =
          historyBlocksLeft == 0 ? "loading" : historyBlocksLeft;
      }
      break;
    }
    case "tradersChecked": {
      checkCycleCounter.inc();
      beforeLastCheckTime = lastCheckTime;
      lastCheckTime = Date.now();

      const { checkedTraders } = event;
      if (checkedTraders.length) {
        const traderS = checkedTraders.length == 1 ? "trader" : "traders";
        console.log(
          `Identified ${checkedTraders.length} liquidatable ${traderS}:\n  `,
          checkedTraders.join("\n  ")
        );
      }
      break;
    }
    case "traderLiquidated": {
      liquidationsCounter.inc();
      lastLiquidationTime = Date.now();

      const { transactionHash: hash } = await event.contractTransaction.wait();
      console.log(`Trader ${event.trader} liquidated in transaction ${hash}`);
      break;
    }
    case "botStopped": {
      console.log("Liquidation bot has been stopped");
      break;
    }
    default: {
      // compiler would give an error here if some case would be missing
      ((_exhaustiveSwitchCheck: never) => {})(event);
    }
  }
};

// e.g. 30s, 1m 30s, 1h, 1h 59m, 17d 15h
function getDurationStr(from: number | undefined, to = Date.now()) {
  if (from === undefined) {
    return "-";
  }

  const secDiff = ((to - from) / 1_000) | 0;
  const minDiff = (secDiff / 60) | 0;
  const hourDiff = (minDiff / 60) | 0;
  const dayDiff = (hourDiff / 24) | 0;
  const secPartDiff = secDiff % 60;
  const minPartDiff = minDiff % 60;
  const hourPartDiff = hourDiff % 24;

  const diffs = [
    [dayDiff, "d"],
    [hourPartDiff, "h"],
    [minPartDiff, "m"],
    [secPartDiff, "s"],
  ];

  let durationStr = "";

  for (const [diff, unit] of diffs) {
    if (durationStr) {
      if (diff) {
        durationStr += ` ${diff}${unit}`;
      }
      break;
    }
    if (diff) {
      durationStr += `${diff}${unit}`;
    }
  }

  return durationStr || "0s";
}
