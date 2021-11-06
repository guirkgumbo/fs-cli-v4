import type { Trader } from "@liquidationBot/types";

export class FetchError extends Error {
  constructor(cause: any) {
    // @ts-ignore - cause is a new feature that would be typed in TS 4.5 https://github.com/microsoft/TypeScript/pull/46291
    super("Failed to fetch active traders", { cause });
    this.name = "FetchError";
  }
}

export class CheckError extends Error {
  constructor(
    traders: Trader[],
    chunkNumber: number,
    chunkSize: number,
    total: number,
    cause: any
  ) {
    const from = chunkNumber * chunkSize;
    const to = Math.min((chunkNumber + 1) * chunkSize, total);

    const tradersStr =
      total == 1 ? `trader "${traders[0]}"` : `${traders.length} traders`;
    const rangeStr =
      chunkSize < total ? `from ${from} to ${to} of ${total} ` : "";
    const message = `Failed to check ${tradersStr} ${rangeStr}for been liquidatable`;

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
