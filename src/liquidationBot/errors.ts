import type { Trader } from "@liquidationBot/types";

export class FetchError extends Error {
  constructor(url: string, cause: any) {
    // @ts-ignore - cause is a new feature that would be typed in TS 4.5 https://github.com/microsoft/TypeScript/pull/46291
    super(`Failed to fetch active traders from ${url}`, { cause });
    this.name = "FetchError";
  }
}

export class CheckError extends Error {
  constructor(traders: Trader[], from: number, total: number, cause: any) {
    const to = Math.min(from + traders.length, total);

    const prefix = `Traders from ${from} to ${to} of ${total}`;

    const message = (() => {
      switch (traders.length) {
        case 0:
          return `Internal error: ${prefix}: Got no traders in the "CheckError" exception.`;
        case 1:
          return `${prefix}: Failed to check trader ${traders[0]} for been liquidatable`;
        default:
          return `${prefix}: Failed to check ${traders.length} traders for been liquidatable`;
      }
    })();

    // @ts-ignore - cause is a new feature that would be typed in TS 4.5 https://github.com/microsoft/TypeScript/pull/46291
    super(message, { cause });
    this.name = "CheckError";
  }
}

export class LiquidationError extends Error {
  constructor(readonly trader: Trader, cause: any) {
    // @ts-ignore - cause is a new feature that would be typed in TS 4.5 https://github.com/microsoft/TypeScript/pull/46291
    super(`Failed to liquidate trader ${trader}`, { cause });
    this.name = "LiquidationError";
  }
}
