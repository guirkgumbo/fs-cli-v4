import type { Trader } from "@liquidationBot/types";
import { chunk } from "lodash";
import { config } from "@config";
import { CheckError } from "@liquidationBot/errors";
import botApi from "./setupApi";

export type LiquidatableTradersCheckResult = Trader[] | CheckError;

type Filter = (
  traders: Trader[]
) => AsyncGenerator<LiquidatableTradersCheckResult>;

export const filterLiquidatableTraders: Filter = async function* (traders) {
  const { exchangeAddress } = config;
  const { maxTradersPerLiquidatableCheck: chunkSize } =
    config.liquidationBotApi;

  for (const [chunkIndex, chunkOfTraders] of chunk(
    traders,
    chunkSize
  ).entries()) {
    try {
      const areLiquidatable = await botApi.callStatic.isLiquidatable(
        exchangeAddress,
        chunkOfTraders
      );

      const liquidatableTraders = areLiquidatable.flatMap((isLiquidatable, i) =>
        isLiquidatable ? traders[chunkIndex * chunkSize + i] : []
      );

      yield liquidatableTraders;
    } catch (error) {
      yield new CheckError(
        chunkOfTraders,
        chunkIndex * chunkSize,
        traders.length,
        error
      );
    }
  }
};
