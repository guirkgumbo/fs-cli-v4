/**
 * Incentives calculation and distribution, for the Uniswap liquidity.
 */

import {
  addMinutes,
  differenceInMinutes,
  differenceInMilliseconds,
  setMilliseconds,
  setSeconds,
  min,
  max,
} from "date-fns";
import { BalancesStore } from "./liquidity";
import { IntervalPrices, PriceStore } from "../binance";

export class IncentivesDistribution {
  constructor(
    /**
     * First moment in time this distribution covers.
     */
    public readonly from: Date,

    /**
     * Last moment in time this distribution covers.
     */
    public readonly to: Date,

    /**
     * Total amount of incentives that are distributed equally between `from` and `to`.
     */
    public readonly incentivesTotal: number,

    /**
     * Total amount of Uniswap liquidity that was available between `from` and `to`, in `sqrt(USDC *
     * ETH) * millisecond`.
     */
    public readonly liquidity: bigint,

    /**
     * Amounts of liquidity provided by individual liquidity providers.  Indexed by the provider
     * address.
     */
    public readonly providers: ProviderDistributions
  ) {}
}

export interface ProviderDistributions {
  [address: string]: ProviderLiquidity;
}

export class ProviderLiquidity {
  constructor(
    /**
     * Part of the incentives that this provider should receive for their liquidity.
     */
    public incentives: number = 0,

    /**
     * Total amount of Uniswap liquidity that was provided in `sqrt(USDC * ETH) * millisecond`.
     */
    public liquidity: bigint = 0n
  ) {}
}

/**
 * Computes incentives distribution for a specific time period, using historical exchange prices,
 * and liquidity balances.
 *
 * @param priceStore Holds price history.  1 minute granularity.
 * @param balances Holds liquidity balances history, block by block.
 * @param rangeStart Point in time when incentives distribution starts.
 * @param rangeEnd Point in time when incentives distribution ends.
 * @param priceRange Specifies price ranges that we want to incentivise, relative to the historical
 *            price value, provided by the `priceStore`.  `priceStore` provides minimum and maximum
 *            prices for a specific minute.  Minimum price is multiplied by `1 - priceRange`, and
 *            maximum price is multiplied by `1 + priceRange` to determine the range of prices for
 *            which incentives are issued.
 *
 *            2.5% range would be specified as `0.025`.
 * @param incentivesTotal Total number of incentives to be distributed.  Units do not matter for
 *            this computation.
 */
export const incentivesDistribution = (
  priceStore: PriceStore,
  balances: BalancesStore,
  rangeStart: Date,
  rangeEnd: Date,
  priceRange: number,
  incentivesTotal: number
): IncentivesDistribution => {
  checkTimeRanges(balances, priceStore, rangeStart, rangeEnd);

  /*
   * Binance prices are in 1 minute granularity.  `start` and `end` will iterate over each 1 minute
   * interval, starting from `rangeStart` and up to `rangeEnd`.
   *
   * As `rangeStart` and `rangeEnd` are not necessarily aligned to a minute, the first and the last
   * intervals could be shorter than one minute.
   */
  let start = rangeStart;
  /* Find the end of the minute that contains `start`. */
  let end = setSeconds(setMilliseconds(addMinutes(start, 1), 0), 0);
  /* But if `start` is already at the beginning of a minute, we want to use the next one. */
  if (start.getTime() == end.getTime()) {
    end = min([addMinutes(end, 1), rangeEnd]);
  }

  let liquidity: bigint = 0n;

  const providers: ProviderDistributions = {};
  const addRangeLiquidity = (
    providerAddress: string,
    rangeLiquidity: ProviderLiquidity
  ) => {
    let provider = providers[providerAddress];
    if (provider === undefined) {
      provider = providers[providerAddress] = new ProviderLiquidity();
    }

    provider.liquidity = provider.liquidity + rangeLiquidity.liquidity;
  };

  const priceFor = pricesForStore(priceStore);
  while (start.getTime() < rangeEnd.getTime()) {
    const { min: binancePriceMin, max: binancePriceMax } = priceFor(start);

    const priceMin = binancePriceMin * (1 - priceRange);
    const priceMax = binancePriceMax * (1 + priceRange);

    const { liquidity: rangeLiquidity, providers: rangeProviders } =
      liquidityFor(balances, start, end, priceMin, priceMax);

    liquidity = liquidity + rangeLiquidity;

    for (const address in rangeProviders) {
      addRangeLiquidity(address, rangeProviders[address]);
    }

    start = end;
    /* If `rangeEnd` is not on a minute boundary, make sure we do not go over. */
    end = min([addMinutes(start, 1), rangeEnd]);
  }

  /*
   * When converting from BigInt to Number we need to decide how many digits after the comma do we
   * want to preserve.  At the same time we need to make sure we do not overflow Number.
   * 64 bit floats have 15 significant digits, so rounding up to 14 digits after the comma seems
   * good enough.
   */
  const incentivesDecimals = 14n;

  for (const address in providers) {
    const provider = providers[address];
    const providerIncentives =
      (BigInt(incentivesTotal) *
        provider.liquidity *
        10n ** incentivesDecimals) /
      liquidity;
    provider.incentives =
      Number(providerIncentives) / 10 ** Number(incentivesDecimals);
  }

  return new IncentivesDistribution(
    rangeStart,
    rangeEnd,
    incentivesTotal,
    liquidity,
    providers
  );
};

const pricesForStore = (
  priceStore: PriceStore
): ((t: Date) => IntervalPrices) => {
  const { startTime, prices } = priceStore;
  return (t) => {
    const i = differenceInMinutes(t, startTime);
    return prices[i];
  };
};

class LiquidityForRange {
  constructor(
    /**
     * Total amount of Uniswap liquidity that was available between `from` and `to`, in `sqrt(USDC *
     * ETH) * millisecond`.
     */
    public readonly liquidity: bigint,

    /**
     * Information on individual liquidity providers.  Indexed by the provider address.
     */
    public readonly providers: ProviderDistributions
  ) {}
}

const liquidityFor = (
  balancesStore: BalancesStore,
  from: Date,
  to: Date,
  priceMin: number,
  priceMax: number
): LiquidityForRange => {
  let rangeLiquidity = 0n;
  const providers: ProviderDistributions = {};

  /*
   * All volumes are in `sqrt(USDC * ETH) * millisecond`.
   */
  const timeRange = differenceInMilliseconds(to, from);

  const addProviderLiquidity = (providerAddress: string, liquidity: bigint) => {
    let provider = providers[providerAddress];
    if (provider === undefined) {
      provider = providers[providerAddress] = new ProviderLiquidity();
    }

    const liquidityMs: bigint = liquidity * BigInt(timeRange);

    provider.liquidity = provider.liquidity + liquidityMs;
    rangeLiquidity = rangeLiquidity + liquidityMs;
  };

  const { balances, blocks } = balancesStore;

  /*
   * TODO An algorithm here is inefficient, as we go through all the positions for every minute.
   * Considering we are moving in time in one direction, it would have been way more efficient, for
   * example, to sort positions, and look only at a subset that matches the current time.
   *
   * Note that we have both time and price constraints.  But there are even more efficient
   * approaches.
   *
   * For now, considering there are no automated tests, I opted for the most dump implementation,
   * hoping that the runtime would still be bearable.
   */

  /*
   * How many digits of precision to use when adjusting liquidity using price and time coefficients.
   * As all the liquidity computations use BigInt, we need to do calculations using integers.
   * So we are going to multiply values by `10n ** coefficientsDigits`, before we divide them by the
   * inverse at the end of the computation.
   */
  const coefficientsDigits = 16n;

  const { providerEvents } = balances;
  for (const providerAddress in providerEvents) {
    const priceRanges = providerEvents[providerAddress];

    for (const priceRange of priceRanges) {
      const { min: rangePriceMin, max: rangePriceMax, events } = priceRange;

      const effectivePriceMin = Math.max(priceMin, rangePriceMin);
      const effectivePriceMax = Math.min(priceMax, rangePriceMax);

      if (effectivePriceMin >= effectivePriceMax) {
        /* This position is completely outside of the specified ranges. */
        continue;
      }

      const priceCoefficient = BigInt(
        Math.floor(
          ((effectivePriceMax - effectivePriceMin) / (priceMax - priceMin)) *
            10 ** Number(coefficientsDigits)
        )
      );

      for (const event of events) {
        const block = blocks[event.block];

        if (block.timestamp.getTime() >= to.getTime()) {
          continue;
        }

        const timeCoefficient = BigInt(
          Math.floor(
            (differenceInMilliseconds(to, max([block.timestamp, from])) /
              timeRange) *
              10 ** Number(coefficientsDigits)
          )
        );

        let liquidityAdjustment: bigint;

        switch (event.event) {
          case "mint":
            liquidityAdjustment = event.liquidity;
            break;

          case "burn":
            liquidityAdjustment = -event.liquidity;
            break;
        }

        liquidityAdjustment =
          (liquidityAdjustment * priceCoefficient * timeCoefficient) /
          10n ** (coefficientsDigits * 2n);

        addProviderLiquidity(providerAddress, liquidityAdjustment);
      }
    }
  }

  return new LiquidityForRange(rangeLiquidity, providers);
};

const checkTimeRanges = (
  balances: BalancesStore,
  priceStore: PriceStore,
  from: Date,
  to: Date
) => {
  const blockStart = (blockNumber: number): Date => {
    return balances.blocks[blockNumber].timestamp;
  };

  if (balances.firstBlock >= balances.lastBlock) {
    throw new Error("Uniswap balances store is empty.");
  }

  const { startTime: pricesStartTime, prices } = priceStore;
  if (prices.length == 0) {
    throw new Error("Binance prices store is empty.");
  }

  /*
   * Make sure we have date for the beginning of the very first minute.
   */
  from = new Date(from);
  from.setSeconds(0);
  from.setMilliseconds(0);

  if (from.getTime() < blockStart(balances.firstBlock).getTime()) {
    throw new Error(
      'Requested "from" date is before the first block recorded in the Uniswap balances store.\n'
    );
  }

  if (from.getTime() < pricesStartTime.getTime()) {
    throw new Error(
      'Requested "from" date is before the first price recorded in the Binance price store.\n'
    );
  }

  if (to.getTime() >= blockStart(balances.lastBlock).getTime()) {
    throw new Error(
      'Requested "to" date is after the last block recorded in the Uniswap balances store.\n'
    );
  }

  const pricesEndTime = (() => {
    const startTime = priceStore.startTime;
    const count = prices.length;
    let res = new Date(startTime);
    res.setMinutes(startTime.getMinutes() + count);
    return res;
  })();

  if (to.getTime() >= pricesEndTime.getTime()) {
    throw new Error(
      'Requested "to" date is aftee the last price recorded in the Binance price store.\n'
    );
  }
};

export const printIncentivesDistribution = (
  distributions: IncentivesDistribution,
  incentivesDustLevel: number
) => {
  const { from, to, incentivesTotal, liquidity, providers } = distributions;

  const timeRange = BigInt(differenceInMilliseconds(to, from));

  const numberFormat = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 10,
  });
  const formatter = (value: number) => numberFormat.format(value);

  console.log(`Report start time: ${from}`);
  console.log(`Report end time  : ${to}`);
  console.log(`Total incentives: ${formatter(incentivesTotal)}`);
  console.log(
    `Total liquidity: ${formatter(
      Number(liquidity / 60000n)
    )} sqrt(USDC * ETH) * minute`
  );
  console.log(
    `Liquidity average: ${formatter(
      Number(liquidity / timeRange)
    )} sqrt(USDC * ETH)`
  );

  let dustIncentives = 0;

  console.log(" === Individual provider details ===");
  const providerAddresses = Object.keys(providers);
  providerAddresses.sort();
  for (const address of providerAddresses) {
    const { incentives, liquidity } = providers[address];

    if (incentives <= incentivesDustLevel) {
      if (incentives > 0) {
        dustIncentives += incentives;
      }
      continue;
    }

    console.log(`  ${address}`);
    console.log(`    Incentives: ${formatter(incentives)}`);
    console.log(
      `    Liquidity: ${formatter(
        Number(liquidity / 60000n)
      )} sqrt(USDC * ETH) * minute`
    );
    console.log(
      `    Liquidity average: ${formatter(
        Number(liquidity / timeRange)
      )} sqrt(USDC * ETH)`
    );
  }

  /*
   * Not using a `formatter` here, as we expect the number to be very small and it is better shown
   * in the scientific notation.
   */
  console.log(
    "Sum of incentives beyond dust level: " +
      (dustIncentives == 0 ? "none" : dustIncentives)
  );
};
