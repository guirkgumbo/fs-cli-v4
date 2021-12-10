import type { ContractTransaction } from "ethers";
import type { Trader } from "@liquidationBot/types";
import { LiquidationError } from "@liquidationBot/errors";
import { IExchange } from "@generated/IExchange";

export type LiquidationsResults = { [k in Trader]: ContractTransaction };

type Liquidate = (
  exchange: IExchange,
  traders: Trader[]
) => Promise<{
  liquidationsResults: LiquidationsResults;
  liquidationsErrors: LiquidationError[];
}>;

export const liquidate: Liquidate = async (exchange, traders) => {
  const liquidationsResults: LiquidationsResults = {};
  const liquidationsErrors: LiquidationError[] = [];

  for (const trader of traders) {
    try {
      liquidationsResults[trader] = await exchange.liquidate(trader);
    } catch (error) {
      liquidationsErrors.push(new LiquidationError(trader, error));
    }
  }

  return { liquidationsResults, liquidationsErrors };
};
