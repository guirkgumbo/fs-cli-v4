import axios from "axios";
import type { Trader } from "@liquidationBot/types";

export const getOpen = async (tradesUrl: string): Promise<Trader[]> => {
  const { data } = await axios.get<{ trades: { trader: Trader }[] }>(tradesUrl);
  return data.trades.map(({ trader }) => trader);
};
