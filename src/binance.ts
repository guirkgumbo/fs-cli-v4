import {
  addMinutes,
  differenceInMinutes,
  setMilliseconds,
  setSeconds,
} from "date-fns";
import { access, readFile, writeFile } from "fs/promises";
import { default as axios } from "axios";
import { Validator } from "node-input-validator";

/**
 * Binance API interaction
 */

/**
 * Binance supports a number of price intervals.
 *
 * See
 *
 *     https://binance-docs.github.io/apidocs/spot/en/#public-api-definitions
 *
 * subsection "Kline/Candlestick chart intervals"
 *
 *  - 1m
 *  - 3m
 *  - 5m
 *  - 15m
 *  - 30m
 *  - 1h
 *  - 2h
 *  - 4h
 *  - 6h
 *  - 8h
 *  - 12h
 *  - 1d
 *  - 3d
 *  - 1w
 *  - 1M
 */

export class IntervalPrices {
  constructor(
    /**
     * Minimum price observed during this price interval.
     */
    public readonly min: number,
    /**
     * Maximum price observed during this price interval.
     */
    public readonly max: number
  ) {}
}

export class PriceStore {
  constructor(
    /**
     * Time of the oldest entry in the `prices` array.
     *
     * All the entries need to be consecutive and have the same length - 1 minute.  So the time of
     * the last entry should be `addMinutes(startTime, prices.length)`.
     */
    public startTime: Date,
    /**
     * Prices starting from the oldest, to the newest.  Each interval covers the same amount of time
     * - 1 minute at the moment.  Interval with index 0 has a start time of `startTime`, interval
     * with index 1 has a start time of `addMinutes(startTime, 1)` and so on.
     */
    public readonly prices: IntervalPrices[] = []
  ) {}

  public static async load(path: string, startTime: Date): Promise<PriceStore> {
    try {
      await access(path);
    } catch {
      // If storage file does not exist, which is the default check that `access()` performs, we
      // just construct an empty store.
      return new PriceStore(startTime);
    }

    try {
      const data = JSON.parse(await readFile(path, { encoding: "utf8" }));

      const validator = new Validator(data, {
        startTime: "required|dateiso",
        prices: "required|array",
        "prices.*.min": "required|numeric",
        "prices.*.max": "required|numeric",
      });

      if (!(await validator.check())) {
        console.log(validator.errors);
        throw new Error(`Failed to read prices from: ${path}`);
      }

      const fileStartTime = new Date(data.startTime);
      if (fileStartTime.getTime() != startTime.getTime()) {
        throw new Error(
          `"startTime" loaded from the store is different from the expected.
           Store path: ${path}
           Store "startTime": ${fileStartTime}
           Expected "startTime": ${startTime}`
        );
      }

      const prices = data.prices.map(
        ({ min, max }: { min: string; max: string }) =>
          new IntervalPrices(Number(min), Number(max))
      );
      return new PriceStore(startTime, prices);
    } catch (err) {
      throw new Error(`Failed to read prices from: ${path}\n` + err);
    }
  }

  public async update(symbol: string, oldestPrice: Date) {
    await updatePrices(symbol, this, oldestPrice);
  }

  public async save(path: string) {
    try {
      /*
       * Store pretty printed version.  It is not that much longer, but as we are going to store it
       * in GitHub, it would work much better for diffs.
       */
      const data = JSON.stringify(this, null, 2);
      await writeFile(path, data);
    } catch (err) {
      throw new Error(`Failed to write prices into: ${path}\n` + err);
    }
  }
}

const BINANCE_ENDPOINT = "https://www.binance.com/api/v3";

const fetchRange = async (
  symbol: string,
  startTime: Date,
  intervalId: string,
  nextIntervalStart: (current: Date) => Date,
  count: number
): Promise<IntervalPrices[]> => {
  const params = {
    symbol,
    interval: intervalId,
    startTime: startTime.getTime(),
    limit: count,
  };
  const response = await axios.get(`${BINANCE_ENDPOINT}/klines`, { params });

  const result: IntervalPrices[] = [];

  let intervalStart = startTime;
  const checkAndAppendInterval = ([
    openTimeMs,
    openStr,
    highStr,
    lowStr,
    closeStr,
    _volumeStr,
    _closeTimeMs,
  ]: [number, string, string, string, string, string, number]) => {
    const intervalStartTime = new Date(openTimeMs);
    const open = Number(openStr);
    const high = Number(highStr);
    const low = Number(lowStr);
    const close = Number(closeStr);

    if (intervalStartTime.getTime() != intervalStart.getTime()) {
      throw new Error(
        `Binance returned unexpected interval start time.
         Expected: ${intervalStart}
         Observed: ${intervalStartTime}
         Request URL: ${BINANCE_ENDPOINT}/klines
         Request params: ${JSON.stringify(params)}`
      );
    }

    intervalStart = nextIntervalStart(intervalStart);

    result.push(
      new IntervalPrices(
        Math.min(open, low, close),
        Math.max(open, high, close)
      )
    );
  };

  for (const intervalInfo of response.data) {
    checkAndAppendInterval(intervalInfo);
  }

  return result;
};

const appendPrices = async (
  symbol: string,
  prices: IntervalPrices[],
  startTime: Date,
  upTo: Date
) => {
  // Defined by the Binance API.
  // See https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data.
  const maxChunkSize = 1000;

  const total = differenceInMinutes(upTo, startTime);

  if (total <= 0) {
    return;
  }

  let nextBatchTime = startTime;

  while (nextBatchTime.getTime() < upTo.getTime()) {
    const chunkSize = Math.min(
      maxChunkSize,
      differenceInMinutes(upTo, nextBatchTime)
    );

    const addOneMinute = (current: Date): Date => addMinutes(current, 1);
    prices.push(
      ...(await fetchRange(
        symbol,
        nextBatchTime,
        "1m",
        addOneMinute,
        chunkSize
      ))
    );

    nextBatchTime = addMinutes(nextBatchTime, chunkSize);

    const left = differenceInMinutes(upTo, nextBatchTime);
    const done = total - left;
    const percentage = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.floor((done * 100) / total));
    console.log(`[${done}/${total}] - ${percentage}%`);
  }
};

const updatePrices = async (
  symbol: string,
  store: PriceStore,
  oldestPrice: Date
) => {
  const response = await axios.get(`${BINANCE_ENDPOINT}/time`);
  /*
   * We are going to fetch prices up to the current server time, rounded down to the nearest minute.
   */
  let serverTime = new Date(response.data.serverTime);
  serverTime = setSeconds(setMilliseconds(serverTime, 0), 0);

  let { startTime, prices } = store;
  let appendStartTime;
  if (prices.length != 0 && startTime.getTime() != oldestPrice.getTime()) {
    console.log(
      "Warning: Reqest to get prices older than the oldest already in the cache.\n" +
        "Current implementation is dumb and discards the cache in this case."
    );
    prices.length = 0;
    appendStartTime = oldestPrice;
  } else {
    appendStartTime = addMinutes(startTime, prices.length);
  }

  await appendPrices(symbol, store.prices, appendStartTime, serverTime);
};
