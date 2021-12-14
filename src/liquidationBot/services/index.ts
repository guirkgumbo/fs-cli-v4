export type { LiquidatableTradersCheckResult } from "./liquidationBot";
export type { LiquidationsResults } from "./exchange";
import * as liquidationBot from "./liquidationBot";
import * as exchange from "./exchange";
import * as traders from "./traders";

export const liquidationBotService = liquidationBot;
export const exchangeService = exchange;
export const tradersService = traders;
