import type { ReportEvent } from "@liquidationBot/reporting/types";
import { logError } from "@liquidationBot/reporting/utils";

export const reportEvent: ReportEvent = async (event) => {
  switch (event.type) {
    case "error": {
      logError(event.error);
      break;
    }
    case "tradersFetched": {
      const { activeTraders } = event;
      const traderS = activeTraders.length == 1 ? "trader" : "traders";
      console.log(`Fetched ${activeTraders.length} active ${traderS}`);
      break;
    }
    case "tradersChecked": {
      const { checkedTraders } = event;
      if (checkedTraders.length) {
        const traderS = checkedTraders.length == 1 ? "trader" : "traders";
        console.log(
          `Identified ${checkedTraders.length} liquidatable ${traderS}:\n  `,
          checkedTraders.join("\n  ")
        );
      } else {
        console.log("Identified no liquidatable traders");
      }
      break;
    }
    case "traderLiquidated": {
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
      ((exhaustiveSwitchCheck: never) => {})(event);
    }
  }
};
