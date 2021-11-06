import type { Trader } from "@liquidationBot/types";
import _ from "lodash";
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

  const chunks = _(traders).chunk(chunkSize).entries().value();
  for (const [chunkNumberStr, chunkOfTraders] of chunks) {
    const chunkNumber = +chunkNumberStr;

    try {
      const areLiquidatable = await botApi.callStatic.isLiquidatable(
        exchangeAddress,
        chunkOfTraders
      );

      const liquidatableTraders = areLiquidatable.flatMap((isLiquidatable, i) =>
        isLiquidatable ? traders[chunkNumber * chunkSize + i] : []
      );

      yield liquidatableTraders;
    } catch (error) {
      yield new CheckError(
        chunkOfTraders,
        chunkNumber,
        chunkSize,
        traders.length,
        error
      );
    }
  }
};
