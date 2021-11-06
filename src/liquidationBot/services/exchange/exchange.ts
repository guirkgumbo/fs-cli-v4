import type { ContractTransaction } from "ethers";
import type { Trader } from "@liquidationBot/types";
import { LiquidationError } from "@liquidationBot/errors";
import exchangeApi from "./setupApi";

export type LiquidationsResults = { [k in Trader]: ContractTransaction };

type Liquidate = (traders: Trader[]) => Promise<{
  liquidationsResults: LiquidationsResults;
  liquidationsErrors: LiquidationError[];
}>;

export const liquidate: Liquidate = async (traders) => {
  const liquidationsResults: LiquidationsResults = {};
  const liquidationsErrors: LiquidationError[] = [];

  for (const trader of traders) {
    try {
      liquidationsResults[trader] = await exchangeApi.liquidate(trader);
    } catch (error) {
      liquidationsErrors.push(new LiquidationError(trader, error));
    }
  }

  return { liquidationsResults, liquidationsErrors };
};
