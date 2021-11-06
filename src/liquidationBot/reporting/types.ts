import type {
  CheckError,
  FetchError,
  LiquidationError,
} from "@liquidationBot/errors";
import type { Trader } from "@liquidationBot/types";
import type { ContractTransaction } from "ethers";

export type LiquidationBotEvents =
  | {
      type: "error";
      error: FetchError | CheckError | LiquidationError;
    }
  | { type: "tradersFetched"; activeTraders: Trader[] }
  | { type: "tradersChecked"; checkedTraders: Trader[] }
  | {
      type: "traderLiquidated";
      trader: Trader;
      contractTransaction: ContractTransaction;
    }
  | { type: "botStopped" };

export type Reportable = {
  getEventsIterator: () => LiquidationBotEventsIterator;
};

export type Reporter = {
  reportEvent: ReportEvent;
};

type LiquidationBotEventsIterator = AsyncIterableIterator<LiquidationBotEvents>;

export type ReportEvent = (event: LiquidationBotEvents) => Promise<void>;
