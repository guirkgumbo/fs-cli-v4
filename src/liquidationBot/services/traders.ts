import axios from "axios";
import { config } from "@config";
import type { Trader } from "@liquidationBot/types";

const { tradesUrl } = config;

export const getOpen = async (): Promise<Trader[]> => {
  const { data } = await axios.get<{ trades: { trader: Trader }[] }>(tradesUrl);
  return data.trades.map(({ trader }) => trader);
};
