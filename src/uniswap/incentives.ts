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
import { default as _ } from "lodash";

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

/*
 * We are going to distribute this many "incentive tokens" every minute.  After we compute the
 * totals for every provider, we will convert into actual incentive numbers, making sure that we
 * distribute `incentivesTotal` incentives at the end.
 * This proxy "incentive tokens" help make sure the end result is not affected by rounding errors
 * too much.
 */
const incentiveTokensPerMinute = 10n ** 18n;

export class ProviderLiquidity {
  constructor(
    /**
     * Part of the incentives that this provider should receive for their liquidity.
     */
    public incentives: number = 0,

    /**
     * This is a temporary proxy used to accumulate incentives for every minute.  Every minute we
     * will distribute `incentiveTokensPerMinute` among the providers.  And then we will convert
     * these proxy token into incentive amount based the on amount of incentives that is
     * distributed.
     */
    public incentiveTokens: bigint = 0n,

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
  let incentiveTokensTotal: bigint = 0n;

  const rangeTokens = (start: Date, end: Date): bigint => {
    return (
      (BigInt(differenceInMilliseconds(end, start)) *
        incentiveTokensPerMinute) /
      60000n
    );
  };

  const providers: ProviderDistributions = {};
  const addRangeLiquidity = (
    start: Date,
    end: Date,
    providerAddress: string,
    rangeLiquidityTotal: bigint,
    rangeLiquidity: ProviderLiquidity
  ) => {
    let provider = providers[providerAddress];
    if (provider === undefined) {
      provider = providers[providerAddress] = new ProviderLiquidity();
    }

    const share =
      (rangeLiquidity.liquidity * rangeTokens(start, end)) /
      rangeLiquidityTotal;
    provider.incentiveTokens += share;
    provider.liquidity += rangeLiquidity.liquidity;
  };

  const priceFor = pricesForStore(priceStore);
  while (start.getTime() < rangeEnd.getTime()) {
    const { min: binancePriceMin, max: binancePriceMax } = priceFor(start);

    const priceMin = binancePriceMin * (1 - priceRange);
    const priceMax = binancePriceMax * (1 + priceRange);

    const { liquidity: rangeLiquidity, providers: rangeProviders } =
      liquidityFor(balances, start, end, priceMin, priceMax);

    liquidity = liquidity + rangeLiquidity;
    incentiveTokensTotal += rangeTokens(start, end);

    for (const address in rangeProviders) {
      addRangeLiquidity(
        start,
        end,
        address,
        rangeLiquidity,
        rangeProviders[address]
      );
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
        provider.incentiveTokens *
        10n ** incentivesDecimals) /
      incentiveTokensTotal;
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
   * For now, considering there are no automated tests, I opted for the most dumb implementation,
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

      /*
       * For small price ranges, liquidity changes linearly with the price.  As we expect `priceMax
       * - priceMin` to be around 5% of the price value, we can just multiply the liquidity value by
       * the ratio of the covered price range over the desired price range and have a fair share of
       * liquidity accounted for.
       *
       * TODO Add formulas that show that the above is indeed the case.
       */
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

  // TODO Unfortunately, there are a few cases where liquidity is added is such a way that we do not
  // account for it correctly.  See events, for example, for
  // 0xE618050F1adb1F6bb7d03A3484346AC42F3E71EE:
  //
  //    "0xE618050F1adb1F6bb7d03A3484346AC42F3E71EE": [
  //      {
  //        "min": 2995.9072928363953,
  //        "max": 4846.336569968437,
  //        "events": [
  //          {
  //            "l": "0",
  //            "usdc": 0,
  //            "weth": 0,
  //            "block": 2390975,
  //            "e": "burn"
  //          }
  //        ]
  //      },
  //
  // Looking at block `2390975` (https://arbiscan.io/block/2390975), I see a transaction that
  // generates some unusual NFT instead of the Uniswap NFT tokens.  But this transaction looks like
  // addition of liquidity.  Transaction log contains events for the ETH/USDC 0.05% Uniswap v3 pool
  // that we are tracking.  See
  //
  //   https://arbiscan.io/tx/0x04298048331a83b2c59287cb3bfa969307281f83380e7b79f90aa862edc543b3#eventlog
  //
  // Pool address is 0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443.
  //
  // Seems like we do not parse these log entries correctly.
  //
  // For now, the workaround is to remove negative liquidity.  Effectively ignoring liquidity
  // provider via an intermediate contracts(?).

  const removeProviders = Object.entries(providers)
    .filter(([_address, { liquidity }]) => liquidity <= 0n)
    .map(([providerAddress]) => providerAddress);

  for (const providerAddress of removeProviders) {
    // `liqudity` is actually negative, so we are increasing the `rangeLiquidity` value here.
    rangeLiquidity -= providers[providerAddress].liquidity;
    delete providers[providerAddress];
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

export interface IncentivesDistributionReportAsJson {
  from: Date;
  to: Date;
  dustLevel: number;
  incentives: Array<[string, number]>;
  incentivesTotal: number;
}

export const printIncentivesDistributionAsJson = (
  out: Console,
  distribution: IncentivesDistribution,
  incentivesDustLevel: number
) => {
  const { from, to, incentivesTotal, providers } = distribution;

  const incentives = _(providers)
    .pickBy(({ incentives }) => incentives > incentivesDustLevel)
    .map(({ incentives }, address): [string, number] => [address, incentives])
    .sortBy(([address, _incentives]) => address.toLowerCase())
    .value();

  const asJson: IncentivesDistributionReportAsJson = {
    from,
    to,
    dustLevel: incentivesDustLevel,
    incentives,
    incentivesTotal,
  };

  out.log(JSON.stringify(asJson, null, 2));
};

export const printIncentivesDistribution = (
  out: Console,
  distribution: IncentivesDistribution,
  incentivesDustLevel: number
) => {
  const { from, to, incentivesTotal, liquidity, providers } = distribution;

  const timeRange = BigInt(differenceInMilliseconds(to, from));

  const { format } = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 10,
  });

  out.log(`Report start time: ${from}`);
  out.log(`Report end time  : ${to}`);
  out.log(`Total incentives: ${format(incentivesTotal)}`);
  out.log(
    `Total liquidity: ${format(
      Number(liquidity / 60000n)
    )} sqrt(USDC * ETH) * minute`
  );
  out.log(
    `Liquidity average: ${format(
      Number(liquidity / timeRange)
    )} sqrt(USDC * ETH)`
  );

  let dustIncentives = 0;

  out.log(" === Individual provider details ===");
  const providerAddresses = Object.keys(providers);

  providerAddresses.sort((addr1, addr2) => {
    const lcAddr1 = addr1.toLowerCase();
    const lcAddr2 = addr2.toLowerCase();

    if (lcAddr1 < lcAddr2) {
      return -1;
    } else if (lcAddr1 > lcAddr2) {
      return 1;
    } else {
      return 0;
    }
  });

  for (const address of providerAddresses) {
    const { incentives, liquidity } = providers[address];

    if (incentives <= incentivesDustLevel) {
      if (incentives > 0) {
        dustIncentives += incentives;
      }
      continue;
    }

    out.log(`  ${address}`);
    out.log(`    Incentives: ${format(incentives)}`);
    out.log(
      `    Liquidity: ${format(
        Number(liquidity / 60000n)
      )} sqrt(USDC * ETH) * minute`
    );
    out.log(
      `    Liquidity average: ${format(
        Number(liquidity / timeRange)
      )} sqrt(USDC * ETH)`
    );
  }

  /*
   * Not using `format` here, as we expect the number to be very small and it is better shown in the
   * scientific notation.
   */
  out.log(
    "Sum of incentives beyond dust level: " +
      (dustIncentives == 0 ? "none" : dustIncentives)
  );
};
