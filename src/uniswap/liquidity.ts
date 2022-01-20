/**
 * Collection of Uniswap liquidity statistics.
 */

import { fromUnixTime } from "date-fns";
import { access, readFile, writeFile } from "fs/promises";
import { Validator, setStrNotationRepetition } from "node-input-validator";
import { Interface } from "@ethersproject/abi";
import { Log } from "@ethersproject/abstract-provider";
import { Contract, EventFilter } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { formatUnits } from "@ethersproject/units";
import IERC20Metadata from "@openzeppelin/contracts/build/contracts/IERC20Metadata.json";

import { abi as UNISWAP_V3_POOL_ABI } from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";

/**
 * A single Uniswap `Mint` or `Burn` event for a particular price range.
 *
 * Unlike the Uniswap counterpart, these events do not store the price range.
 */
export type LiquidityEvent = MintEvent | BurnEvent;

/**
 * Uniswap `Mint` event that is generated when liquidity is added to a pool.
 */
export class MintEvent {
  public readonly event = "mint";

  constructor(
    /**
     * Amount of liquidity that was added in this event.
     *
     * Uniswap formula for computing liquidity is a bit tricky.
     * More details in the whitepapers:
     *
     *     https://uniswap.org/whitepaper-v3.pdf
     *
     *     https://atiselsts.github.io/pdfs/uniswap-v3-liquidity-math.pdf
     *
     * We are assuming that the `amount` field present in the `Mint` event is the Uniswap liquidity
     * value already precomputed for us.  So we can use it.
     *
     * Maybe we should validate it against the token values also present in the event at some point.
     */
    public readonly liquidity: bigint,

    /**
     * Amount of token0 provided in this event.
     *
     * It is not used in the liquidity calculations, as Uniswap already gave us the computed value.
     * So it is just for accounting purposes.
     */
    public readonly amount0: bigint,

    /**
     * Amount of token1 provided in this event.
     *
     * It is not used in the liquidity calculations, as Uniswap already gave us the computed value.
     * So it is just for accounting purposes.
     */
    public readonly amount1: bigint,

    /**
     * Block number where this liquidity was added.
     *
     * We assume that this liquidity is available starting at this block number.  So the liquidity
     * range is inclusive at the start.
     */
    public readonly block: number
  ) {}

  public toJSON(_key: any): MintAsJson {
    return new MintAsJson(
      this.liquidity.toString(),
      this.amount0.toString(),
      this.amount1.toString(),
      this.block
    );
  }
}

export class MintAsJson {
  public readonly e = "mint";

  constructor(
    public readonly l: string,
    public readonly a0: string,
    public readonly a1: string,
    public readonly block: number
  ) {}
}

/**
 * Uniswap `Burn` event that is generated when liquidity is removed from a pool.
 */
export class BurnEvent {
  public readonly event = "burn";

  constructor(
    /**
     * Amount of liquidity that was removed in this event.
     *
     * Uniswap formula for computing liquidity is a bit tricky.
     * More details in the whitepapers:
     *
     *     https://uniswap.org/whitepaper-v3.pdf
     *
     *     https://atiselsts.github.io/pdfs/uniswap-v3-liquidity-math.pdf
     *
     * We are assuming that the `amount` field present in the `Burn` event is the Uniswap liquidity
     * value already precomputed for us.  So we can use it.
     *
     * Maybe we should validate it against the token values also present in the event at some point.
     */
    public readonly liquidity: bigint,

    /**
     * Amount of token0 removed in this event.
     *
     * It is not used in the liquidity calculations, as Uniswap already gave us the computed value.
     * So it is just for accounting purposes.
     */
    public readonly amount0: bigint,

    /**
     * Amount of token1 removed in this event.
     *
     * It is not used in the liquidity calculations, as Uniswap already gave us the computed value.
     * So it is just for accounting purposes.
     */
    public readonly amount1: bigint,

    /**
     * Block number where this liquidity was removed.
     *
     * We assume that this liquidity is no longer available in this block.  So the liquidity range
     * is exclusive on the end.
     */
    public readonly block: number
  ) {}

  public toJSON(_key: any): BurnAsJson {
    return new BurnAsJson(
      this.liquidity.toString(),
      this.amount0.toString(),
      this.amount1.toString(),
      this.block
    );
  }
}

export class BurnAsJson {
  public readonly e = "burn";

  constructor(
    public readonly l: string,
    public readonly a0: string,
    public readonly a1: string,
    public readonly block: number
  ) {}
}

export type LiquidityEventAsJson = MintAsJson | BurnAsJson;

async function liquidityEventFromJson(
  context: string,
  raw: LiquidityEventAsJson
): Promise<LiquidityEvent> {
  /*
   * TODO node-input-validator is a bad choice for validating JSON.
   * It seems to be designed to work with human input and the validators it provides, do
   * not cover JavaScript types correctly.  For example, there is no validator that would
   * actually verify that a value is a Number.  "numeric" converts values into a string
   * and then applies a regex match, failing if the number is in a scientific notation.
   *
   * Sames goes for "integer".
   *
   * Maybe it would be better to use something like
   *
   *     https://github.com/GillianPerard/typescript-json-serializer
   *
   * It seems to be the right solution for the JSON serialization problem.
   */
  const validator = new Validator(raw, {
    e: "required|in:mint,burn",
    l: "required|string",
    a0: "required|string",
    a1: "required|string",
    block: "required|integer",
  });

  if (!(await validator.check())) {
    console.log(validator.errors);
    throw new Error(context);
  }

  const liquidity = ensureIsBigint(context, "l", raw.l);
  const amount0 = ensureIsBigint(context, "a0", raw.a0);
  const amount1 = ensureIsBigint(context, "a1", raw.a1);
  const block = Number(raw.block);

  // TODO Validate that `block` is present in `blocks`.

  switch (raw.e) {
    case "mint":
      return new MintEvent(liquidity, amount0, amount1, block);
    case "burn":
      return new BurnEvent(liquidity, amount0, amount1, block);
  }
}

/**
 * Liquidity events that happened for a single liquidity provider, for the specified price range.
 *
 * TODO For now, all the prices use a predetermined "stable" defined for each pair in the config.
 * Going forward we may want to consider a more general approach.  Maybe based the Uniswap model of
 * `token0` over `token1.
 */
export class ProviderPriceRangeEvents {
  constructor(
    /**
     * Minimum price between the tokens using on of them as a base.
     *
     * TODO See the class doc detail.
     */
    public readonly min: number,
    /**
     * Maximum price between the tokens using on of them as a base.
     *
     * TODO See the class doc detail.
     */
    public readonly max: number,

    /**
     * Liquidity adjustment events that occurred in this price range for a single provider.
     */
    public readonly events: LiquidityEvent[] = []
  ) {}

  public isFor(min: number, max: number): boolean {
    return this.min == min && this.max == max;
  }

  public toJSON(_key: any): ProviderPriceRangeEventsAsJson {
    const { min, max, events } = this;
    return {
      min,
      max,
      events: events.map((v, i) => v.toJSON(i)),
    };
  }

  public static async fromJSON(
    context: string,
    raw: ProviderPriceRangeEventsAsJson
  ): Promise<ProviderPriceRangeEvents> {
    /*
     * TODO node-input-validator is a bad choice for validating JSON.
     * See comment inside `liquidityEventFromJson` for details.
     */
    const priceRangeValidator = new Validator(raw, {
      min: "required",
      max: "required",
      events: "required|array",
    });

    if (!(await priceRangeValidator.check())) {
      console.log(priceRangeValidator.errors);
      throw new Error(context);
    }

    const min = ensureIsNumber(context, "min", raw.min);
    const max = ensureIsNumber(context, "max", raw.max);
    const events = await Promise.all(
      raw.events.map((v, i) =>
        liquidityEventFromJson(
          `${context}, min: "${min}", max: "${max}", event ${i}`,
          v
        )
      )
    );

    return new ProviderPriceRangeEvents(min, max, events);
  }

  public add(event: LiquidityEvent) {
    this.events.push(event);
  }
}

export class ProviderPriceRangeEventsAsJson {
  constructor(
    public readonly min: number,
    public readonly max: number,
    public readonly events: LiquidityEventAsJson[] = []
  ) {}
}

export class BlockInfo {
  constructor(
    /**
     * `timestamp` field from the block header.
     *
     * For the purposes of liquidity balances, we assume that the block timestamp and Binance times
     * use the same clock.
     */
    public readonly timestamp: Date
  ) {}

  public toJSON(_key: any): BlockInfoAsJson {
    return new BlockInfoAsJson(this.timestamp.toISOString());
  }

  public static async fromJSON(
    context: string,
    raw: BlockInfoAsJson
  ): Promise<BlockInfo> {
    const validator = new Validator(raw, {
      timestamp: "required|dateiso",
    });

    if (!(await validator.check())) {
      console.log(validator.errors);
      throw new Error(context);
    }

    return new BlockInfo(new Date(raw.timestamp));
  }
}

export class BlockInfoAsJson {
  constructor(public readonly timestamp: string) {}
}

export class PoolBalances {
  constructor(
    /**
     * All the liquidity positions we have observed, for a single pool.
     *
     * Provider address is a key.
     */
    public readonly providerEvents: {
      [lpAddress: string]: ProviderPriceRangeEvents[];
    } = {}
  ) {}

  public toJSON(_key: any): PoolBalancesAsJson {
    return Object.fromEntries(
      Object.entries(this.providerEvents).map(([lpAddress, priceRange]) => [
        lpAddress,
        priceRange.map((range, i) => range.toJSON(i)),
      ])
    );
  }

  public static async fromJSON(raw: PoolBalancesAsJson): Promise<PoolBalances> {
    const providerEvents: {
      [lpAddress: string]: ProviderPriceRangeEvents[];
    } = {};
    for (const lpAddress in raw) {
      const providerEventsRaw = raw[lpAddress];
      const singleProviderEvents = await Promise.all(
        providerEventsRaw.map((priceRange, i) =>
          ProviderPriceRangeEvents.fromJSON(
            `lpAddress: "${lpAddress}, priceRange: ${i}`,
            priceRange
          )
        )
      );

      providerEvents[lpAddress] = singleProviderEvents;
    }

    return new PoolBalances(providerEvents);
  }

  public addMint(
    sender: string,
    liquidity: bigint,
    amount0: bigint,
    amount1: bigint,
    priceMin: number,
    priceMax: number,
    block: number
  ) {
    const { providerEvents } = this;

    const range = PoolBalances.findOrInsertRange(
      providerEvents,
      sender,
      priceMin,
      priceMax
    );

    range.add(new MintEvent(liquidity, amount0, amount1, block));
  }

  public addBurn(
    sender: string,
    liquidity: bigint,
    amount0: bigint,
    amount1: bigint,
    priceMin: number,
    priceMax: number,
    block: number
  ) {
    const { providerEvents } = this;

    const range = PoolBalances.findOrInsertRange(
      providerEvents,
      sender,
      priceMin,
      priceMax
    );

    range.add(new BurnEvent(liquidity, amount0, amount1, block));
  }

  static findOrInsertRange(
    providerEvents: {
      [lpAddress: string]: ProviderPriceRangeEvents[];
    },
    sender: string,
    min: number,
    max: number
  ): ProviderPriceRangeEvents {
    let priceRanges = providerEvents[sender];
    if (priceRanges === undefined) {
      priceRanges = providerEvents[sender] = [];
    }

    for (const range of priceRanges) {
      if (range.isFor(min, max)) {
        return range;
      }
    }

    const newOne = new ProviderPriceRangeEvents(min, max);
    priceRanges.push(newOne);
    return newOne;
  }
}

export class PoolBalancesAsJson {
  [lpAddress: string]: ProviderPriceRangeEventsAsJson[];
}

export class BalancesStore {
  constructor(
    public pairs: {
      [pair: string]: PairBalances;
    }
  ) {}

  public static async load(path: string): Promise<BalancesStore> {
    try {
      await access(path);
    } catch {
      // If storage file does not exist, which is the default check that `access()` performs, we
      // just construct an empty store.
      return new BalancesStore({});
    }

    try {
      const data = JSON.parse(await readFile(path, { encoding: "utf8" }));

      if (data === null || typeof data != "object") {
        throw new Error(`Top level value is not an object in: ${path}`);
      }

      const pairs: {
        [pair: string]: PairBalances;
      } = {};
      for (const [pair, pairData] of Object.entries(data)) {
        try {
          pairs[pair] = await PairBalances.parse(pairData);
        } catch (err) {
          throw new Error(`Failed to read balances for: ${pair}\n` + err);
        }
      }

      return new BalancesStore(pairs);
    } catch (err) {
      throw new Error(`Failed to read balances from: ${path}\n` + err);
    }
  }

  public getPair(path: string, pair: string): PairBalances {
    const pairPrices = this.pairs[pair];
    if (pairPrices !== undefined) {
      return pairPrices;
    }

    throw new Error(`Failed to find balances for pair "${pair}" in: ${path}`);
  }

  public getOrCreatePair(
    pair: string,
    firstBlock: number,
    poolAddress: string
  ): PairBalances {
    let pairPrices = this.pairs[pair];
    if (pairPrices !== undefined) {
      return pairPrices;
    }

    pairPrices = new PairBalances(firstBlock, firstBlock, poolAddress);

    this.pairs[pair] = pairPrices;

    return pairPrices;
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

  public toJSON(_key: any): BalancesStoreAsJson {
    return this.pairs;
  }
}

export interface BalancesStoreAsJson {
  [pair: string]: PairBalances;
}

export class PairBalances {
  constructor(
    /**
     * First block that we care about.
     */
    public firstBlock: number,

    /**
     * Latest block for which store does not contain any information.
     *
     * `lastBlock` in `Position` is exclusive, so I want to keep this exclusive as well for
     * consistency.  Though, maybe it would be better to make it inclusive here?
     */
    public lastBlock: number,

    /**
     * Address of the Uniswap pool, that this balances store is for.
     */
    public poolAddress: string,

    /**
     * Liquidity movement events observed for a single uniswap pool.
     *
     * Our exchange only supports one pool, so we support balances in one pool only, for now.
     *
     * Uniswap allows up to 3 pools to exist for every token pair, with different fees.  But it is
     * unclear if we would need to support it in the future.
     */
    public balances: PoolBalances = new PoolBalances(),

    /**
     * A cache of information about the blocks where liquidity positions have started or ended.
     */
    public blocks: {
      [block: number]: BlockInfo;
    } = {}
  ) {}

  public static async parse(data: any): Promise<PairBalances> {
    /*
     * Node input validator limits the amount of repetition it goes through when it is validating
     * an object.  It is strange that we hit it, but we do.
     *
     * TODO We should look into an alternative way of JSON serialization/deserialization.  Current
     * approach is both fragile and very verbose.
     */
    setStrNotationRepetition(100_000);

    const validator = new Validator(data, {
      firstBlock: "required|integer",
      lastBlock: "required|integer",
      poolAddress: "required|string",
      balances: "required|object",
      blocks: "required|object",
    });

    if (!(await validator.check())) {
      throw new Error(validator.errors);
    }

    const firstBlock = Number(data.firstBlock);
    const lastBlock = Number(data.lastBlock);
    const balances = await PoolBalances.fromJSON(data.balances);
    const { poolAddress, blocks: blocksJson } = data;

    const blocks: {
      [block: number]: BlockInfo;
    } = {};

    for (const blockNumberStr in blocksJson) {
      const blockNumber = Number(blockNumberStr);
      if (blockNumberStr === null || !Number.isInteger(blockNumber)) {
        throw new Error(
          `Block JSON key is not an integer.  Got: "${blockNumberStr}"`
        );
      }

      const blockInfoJson = blocksJson[blockNumber];
      blocks[blockNumber] = await BlockInfo.fromJSON(
        `block "${blockNumberStr}"`,
        blockInfoJson
      );
    }

    return new PairBalances(
      firstBlock,
      lastBlock,
      poolAddress,
      balances,
      blocks
    );
  }

  public checkPairParameters(
    expectedFirstBlock: number,
    expectedPoolAddress: string
  ) {
    if (expectedFirstBlock != this.firstBlock) {
      throw new Error(
        '"firstBlock" loaded from the store is different from the expected.\n' +
          `Store "firstBlock": ${this.firstBlock}\n` +
          `Expected "firstBlock": ${expectedFirstBlock}`
      );
    }

    if (expectedPoolAddress.toLowerCase() != this.poolAddress.toLowerCase()) {
      throw new Error(
        '"poolAddress" loaded from the store is different from the expected.\n' +
          `Store "poolAddress": ${this.poolAddress}\n` +
          `Expected "poolAddress": ${expectedPoolAddress}`
      );
    }
  }

  public async update(
    provider: Provider,
    firstBlock: number,
    poolAddress: string
  ) {
    await updatePairBalances(provider, this, poolAddress, firstBlock);
  }

  public addMint(
    sender: string,
    liquidity: bigint,
    amount0: bigint,
    amount1: bigint,
    priceMin: number,
    priceMax: number,
    block: number
  ) {
    this.balances.addMint(
      sender,
      liquidity,
      amount0,
      amount1,
      priceMin,
      priceMax,
      block
    );
  }

  public addBurn(
    sender: string,
    liquidity: bigint,
    amount0: bigint,
    amount1: bigint,
    priceMin: number,
    priceMax: number,
    block: number
  ) {
    this.balances.addBurn(
      sender,
      liquidity,
      amount0,
      amount1,
      priceMin,
      priceMax,
      block
    );
  }
}

type TokenDetails = {
  name: string;
  symbol: string;
  decimals: number;
};

const getTokenDetails = async (token: Contract): Promise<TokenDetails> => {
  const name = token.name();
  const symbol = token.symbol();
  const decimals = token.decimals();

  return { name: await name, symbol: await symbol, decimals: await decimals };
};

const showTokenDetails = (
  prefix: string,
  { name, symbol, decimals }: TokenDetails
) => {
  console.log(`${prefix}: ${symbol} / ${name} - ${decimals} decimals`);
};

type TokenValueFormatter = (value: number) => string;
type TokenFormatter = (details: TokenDetails) => TokenValueFormatter;
const tokenFormatter: TokenFormatter = ({ symbol, decimals }) => {
  return (value: number) => {
    return `${formatUnits(value, decimals)} ${symbol}`;
  };
};

const tickToPrice = (
  tick: number,
  token0Decimals: number,
  token1Decimals: number
) => {
  return Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);
};

/**
 * Checks if the tick value is below the minimum valid price.  Effectively representing no
 * restriction on the minimum price.
 */
const isMinTick = (tick: number): boolean => {
  /*
   * Taken from
   *
   *   uniswap/v3-core/contracts/libraries/TickMath.sol
   *
   * Uniswap uses this value to represent "unbounded".  But in practice I've seen `-887270` to have
   * the same meaning.
   */
  // const MIN_TICK = -887272;
  const MIN_TICK = -887270;
  return tick <= MIN_TICK;
};

/**
 * Checks if the tick value is above the minimum valid price.  Effectively representing no
 * restriction on the maximum price.
 */
const isMaxTick = (tick: number): boolean => {
  /*
   * Taken from
   *
   *   uniswap/v3-core/contracts/libraries/TickMath.sol
   *
   * Uniswap uses this value to represent "unbounded".  But in practice I've seen `887270` to have
   * the same meaning.
   */
  // const MAX_TICK = 887272;
  const MAX_TICK = 887270;
  return tick >= MAX_TICK;
};

type NumberFormatter = (n: number) => string;
type TickFormatter = (tick: number) => string;

const tickPriceFormatter = (
  token0: TokenDetails,
  token1: TokenDetails,
  inv: boolean,
  numberFormatter: NumberFormatter
): TickFormatter => {
  const units = inv
    ? `${token0.symbol} per ${token1.symbol}`
    : `${token1.symbol} per ${token0.symbol}`;
  return (tick: number): string => {
    if (isMinTick(tick) || isMaxTick(tick)) {
      return "unbounded";
    } else {
      const price = inv
        ? tickToPrice(-tick, token1.decimals, token0.decimals)
        : tickToPrice(tick, token0.decimals, token1.decimals);
      return `${numberFormatter(price)} ${units}`;
    }
  };
};

const getEventFilterTopic0 = (
  eventFilterConstructor: () => EventFilter
): string => {
  const eventFilter = eventFilterConstructor();
  const { topics } = eventFilter;
  if (topics === undefined || topics.length < 1) {
    throw new Error(
      `Filter is expected to contain at least 1 topic: ${JSON.stringify(
        eventFilter
      )}`
    );
  }

  const topic0 = topics[0];
  if (typeof topic0 == "string") {
    return topic0;
  } else {
    throw new Error(
      `Topic 0 should contain only 1 matcher: ${JSON.stringify(eventFilter)}`
    );
  }
};

/*
 * NOTE Documentation for `getTransaction` says it returns a `TransactionResponse`[1], and
 * documentation for `TransactionResponse` says that it should contain a `timestamp` for minted
 * transactions.  But in practice it does not.
 *
 * Otherwise, it would be faster to get both the sender and the timestamp in the same call.
 *
 * [1] https://docs.ethers.io/v5/api/providers/types/#providers-TransactionResponse
 */
const getTransactionSender = async (
  provider: Provider,
  transactionHash: string
): Promise<string> => {
  const response = await tryNTimes(3, async () => {
    return await provider.getTransaction(transactionHash);
  });
  return response.from;
};

const getBlockTimestamp = async (
  provider: Provider,
  block: number
): Promise<Date> => {
  let response = await tryNTimes(3, async () => {
    return provider.getBlock(block);
  });
  /* Node timestamps are in seconds, while `Date` operates on milliseconds. */
  return fromUnixTime(response.timestamp);
};

const updatePairBalances = async (
  provider: Provider,
  pairBalances: PairBalances,
  poolAddress: string,
  firstBlock: number
) => {
  const lastChainBlock = await tryNTimes(3, async () => {
    return provider.getBlockNumber();
  });

  const numberFormat = new Intl.NumberFormat();
  const numberFormatter = (value: number) => numberFormat.format(value);

  console.log(`Last chain block: ${numberFormatter(lastChainBlock)}`);
  console.log(`Last store block: ${numberFormatter(pairBalances.lastBlock)}`);

  /* We add 1 as `lastBlock` is exclusive. */
  if (pairBalances.lastBlock == lastChainBlock + 1) {
    return;
  }

  if (pairBalances.lastBlock > lastChainBlock + 1) {
    console.log(
      `Warning: Store cache was updated up to block ${pairBalances.lastBlock}, but the chain` +
        ` says the last existing block is ${lastChainBlock}`
    );
    return;
  }

  if (pairBalances.firstBlock != firstBlock) {
    console.log(
      "Warning: Reqest to get blocks older than the oldest block already in the cache.\n" +
        "Current implementation is dumb and discards the cache in this case."
    );
    pairBalances.balances = new PoolBalances();
    pairBalances.blocks = {};
  } else {
    firstBlock = pairBalances.lastBlock;
  }

  console.log(`Updating for pool: ${poolAddress}`);

  await updateSinglePool(
    provider,
    pairBalances,
    poolAddress,
    firstBlock,
    lastChainBlock + 1,
    numberFormatter
  );

  await maybeGetBlockInfo(provider, pairBalances, pairBalances.firstBlock);
  await maybeGetBlockInfo(provider, pairBalances, pairBalances.lastBlock);
};

const maybeGetBlockInfo = async (
  provider: Provider,
  pairBalances: PairBalances,
  blockNumber: number
) => {
  if (pairBalances.blocks[blockNumber]) {
    return;
  }

  let timestamp = await getBlockTimestamp(provider, blockNumber);
  pairBalances.blocks[blockNumber] = new BlockInfo(timestamp);
};

const updateSinglePool = async (
  provider: Provider,
  pairBalances: PairBalances,
  poolAddress: string,
  firstBlock: number,
  lastBlock: number,
  numberFormatter: (v: number) => string
) => {
  if (firstBlock + 1 >= lastBlock) {
    return;
  }

  const pool = new Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);

  const { token0Details, token1Details, fee } = await poolTokenDetails(
    provider,
    pool
  );
  const tickToStablePrice = getTickToStablePrice(token0Details, token1Details);

  showTokenDetails("token0", token0Details);
  showTokenDetails("token1", token1Details);
  console.log(`fee: ${fee}`);

  const mintTopic0 = getEventFilterTopic0(pool.filters.Mint);
  const burnTopic0 = getEventFilterTopic0(pool.filters.Burn);

  /*
   * Infura actually supports up to 100,000 blocks per request, but it responds faster if we ask for
   * less at a time.
   *
   * As this is an interactive tool, response time is somewhat important here.
   */
  const maxChunkSize = 100000;

  const total = lastBlock - firstBlock - 1;
  let fromBlock = firstBlock;

  while (fromBlock + 1 < lastBlock) {
    const chunkSize = Math.min(lastBlock - fromBlock, maxChunkSize);
    // We subtract 1 as `lastBlock` is exclusive.
    const toBlock = fromBlock + chunkSize - 1;

    const allEventsFilter = {
      address: poolAddress,
      topics: [[mintTopic0, burnTopic0]],
      fromBlock,
      toBlock,
    };

    const fromBlockStr = numberFormatter(fromBlock);
    const toBlockStr = numberFormatter(toBlock);
    const left = lastBlock - fromBlock - 1;
    const done = total - left;
    const percentage = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.floor((done * 100) / total));
    const blockRangeStr = `blocks from ${fromBlockStr} to ${toBlockStr}`;
    console.log(`[${done}/${total}] - ${percentage}% - ${blockRangeStr}`);

    const entries = await tryNTimes(3, async () => {
      return provider.getLogs(allEventsFilter);
    });
    for (const entry of entries) {
      await includeEvent(
        provider,
        pool.interface,
        pairBalances,
        entry,
        tickToStablePrice
      );
    }

    fromBlock += chunkSize;

    if (pairBalances.lastBlock <= toBlock) {
      pairBalances.lastBlock = toBlock;
    }
  }
};

const includeEvent = async (
  provider: Provider,
  iface: Interface,
  pairBalances: PairBalances,
  entry: Log,
  tickToStablePrice: (tick: number) => number
) => {
  const sender = await getTransactionSender(provider, entry.transactionHash);

  const { blockNumber } = entry;

  await maybeGetBlockInfo(provider, pairBalances, blockNumber);

  const { name, args } = iface.parseLog(entry);

  const { tickLower, tickUpper, amount: liquidity, amount0, amount1 } = args;

  // Due to the way prices are stored in Uniswap, lower and upper ticks do not necessarily
  // correspond to lower and upper prices.  It depends on the token order and, I think, ratios
  // between the tokens as well.
  const lowerTickPrice = tickToStablePrice(tickLower);
  const upperTickPrice = tickToStablePrice(tickUpper);
  const priceMin = Math.min(lowerTickPrice, upperTickPrice);
  const priceMax = Math.max(lowerTickPrice, upperTickPrice);

  if (name == "Mint") {
    pairBalances.addMint(
      sender,
      liquidity,
      amount0,
      amount1,
      priceMin,
      priceMax,
      blockNumber
    );
  } else if (name == "Burn") {
    pairBalances.addBurn(
      sender,
      liquidity,
      amount0,
      amount1,
      priceMin,
      priceMax,
      blockNumber
    );
  } else {
    throw new Error(`Unexpected log entry entry name: ${name}`);
  }
};

export const printAllPoolLiquidityEvents = async (
  provider: Provider,
  firstBlock: number,
  lastBlock: number | null,
  poolAddress: string
) => {
  if (lastBlock === null) {
    lastBlock = await tryNTimes(3, async () => {
      return provider.getBlockNumber();
    });
  }

  console.log(`Events for pool: ${poolAddress}`);

  const pool = new Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);

  const [token0Address, token1Address, fee] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.fee(),
  ]);
  const token0 = new Contract(token0Address, IERC20Metadata.abi, provider);
  const token1 = new Contract(token1Address, IERC20Metadata.abi, provider);

  const [token0Details, token1Details] = await Promise.all([
    getTokenDetails(token0),
    getTokenDetails(token1),
  ]);

  const token0Formatter = tokenFormatter(token0Details);
  const token1Formatter = tokenFormatter(token1Details);

  const numberFormat = new Intl.NumberFormat();
  const numberFormatter = (value: number) => numberFormat.format(value);

  showTokenDetails("token0", token0Details);
  showTokenDetails("token1", token1Details);
  console.log(`fee: ${fee}`);

  console.log(`Last block number: ${numberFormatter(lastBlock)}`);

  const mintTopic0 = getEventFilterTopic0(pool.filters.Mint);
  const burnTopic0 = getEventFilterTopic0(pool.filters.Burn);

  const tickInStableFormatter = (() => {
    const token0Symbol = token0Details.symbol;
    const token1Symbol = token1Details.symbol;

    if (
      token0Symbol == "WETH" &&
      (token1Symbol == "USDC" || token1Symbol == "DAI")
    ) {
      return tickPriceFormatter(
        token0Details,
        token1Details,
        false,
        numberFormatter
      );
    } else if (
      (token0Symbol == "USDC" || token0Symbol == "DAI") &&
      token1Symbol == "WETH"
    ) {
      return tickPriceFormatter(
        token0Details,
        token1Details,
        true,
        numberFormatter
      );
    } else if (token0Symbol == "WBTC" && token1Symbol == "WETH") {
      return tickPriceFormatter(
        token0Details,
        token1Details,
        false,
        numberFormatter
      );
    } else if (token0Symbol == "WETH" && token1Symbol == "WBTC") {
      return tickPriceFormatter(
        token0Details,
        token1Details,
        true,
        numberFormatter
      );
    } else {
      throw new Error(
        "Unsupported token combination for the pool.\n" +
          "(token0, token1) needs to be one of:\n" +
          "  (WETH, USDC/DAI), (USDC/DAI, WETH), (WBTC, WETH), or (WETH, WBTC)."
      );
    }
  })();

  /*
   * Infura actually supports up to 100,000 blocks per request, but it responds faster if we ask for
   * less at a time.
   *
   * As this is an interactive tool, response time is more important here.
   */
  const maxChunkSize = 10000;
  let fromBlock = firstBlock;

  while (fromBlock + 1 < lastBlock) {
    const chunkSize = Math.min(lastBlock - fromBlock, maxChunkSize);
    const toBlock = fromBlock + chunkSize - 1;

    const allEventsFilter = {
      address: poolAddress,
      topics: [[mintTopic0, burnTopic0]],
      fromBlock,
      toBlock,
    };

    const entries = await tryNTimes(3, async () => {
      return provider.getLogs(allEventsFilter);
    });

    const blockInfo =
      `${numberFormatter(fromBlock)} -> ` + `${numberFormatter(toBlock)}`;
    console.log(`Blocks ${blockInfo}: got ${entries.length} log entries`);

    for (const entry of entries) {
      const sender = await getTransactionSender(
        provider,
        entry.transactionHash
      );
      showEvent(
        sender,
        pool.interface,
        entry,
        numberFormatter,
        tickInStableFormatter,
        token0Formatter,
        token1Formatter
      );
    }

    fromBlock += chunkSize;
  }
};

const poolTokenDetails = async (
  provider: Provider,
  pool: Contract
): Promise<{
  token0Details: TokenDetails;
  token1Details: TokenDetails;
  fee: number;
}> => {
  const [token0Address, token1Address, fee] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.fee(),
  ]);
  const token0 = new Contract(token0Address, IERC20Metadata.abi, provider);
  const token1 = new Contract(token1Address, IERC20Metadata.abi, provider);

  const [token0Details, token1Details] = await Promise.all([
    getTokenDetails(token0),
    getTokenDetails(token1),
  ]);

  return { token0Details, token1Details, fee };
};

const getTickToStablePrice = (
  token0Details: TokenDetails,
  token1Details: TokenDetails
): ((tick: number) => number) => {
  /*
   * We only support a limited set of pools at the moment.  But even there, the token order depends
   * on the token contract addresses.
   *
   * TODO We should provide the stable token name as a configuration parameter, instead of
   * hardcoding it here.
   */
  let tickToStablePrice: (tick: number) => number;
  const token0Symbol = token0Details.symbol;
  const token1Symbol = token1Details.symbol;
  if (token0Symbol == "WETH" && token1Symbol == "USDC") {
    tickToStablePrice = (tick: number) =>
      tickToPrice(tick, token0Details.decimals, token1Details.decimals);
  } else if (token0Symbol == "USDC" && token1Symbol == "WETH") {
    tickToStablePrice = (tick: number) =>
      tickToPrice(-tick, token1Details.decimals, token0Details.decimals);
  } else if (token0Symbol == "WBTC" && token1Symbol == "WETH") {
    tickToStablePrice = (tick: number) =>
      tickToPrice(tick, token0Details.decimals, token1Details.decimals);
  } else if (token0Symbol == "WETH" && token1Symbol == "WBTC") {
    tickToStablePrice = (tick: number) =>
      tickToPrice(-tick, token1Details.decimals, token0Details.decimals);
  } else {
    throw new Error(
      "Unsupported token combination for the pool.\n" +
        "(token0, token1) needs to be one of:\n" +
        "  (WETH, USDC), (USDC, WETH), (WBTC, WETH), or (WETH, WBTC)."
    );
  }

  return tickToStablePrice;
};

const showEvent = (
  txSender: string,
  iface: Interface,
  entry: Log,
  numberFormatter: NumberFormatter,
  tickInStableFormatter: TickFormatter,
  token0Formatter: TokenValueFormatter,
  token1Formatter: TokenValueFormatter
) => {
  const { blockNumber, transactionIndex } = entry;
  const { name, args } = iface.parseLog(entry);

  const eventId = `${numberFormatter(blockNumber)}-${transactionIndex}`;

  if (name == "Mint") {
    const { sender, owner, tickLower, tickUpper, amount0, amount1 } = args;
    console.log(`${eventId}: Mint`);
    console.log(`  transaction sender: ${txSender}`);
    console.log(`  sender: ${sender}`);
    console.log(`  owner: ${owner}`);
    console.log(
      `  tickLower: ${tickLower} - ${tickInStableFormatter(tickLower)}`
    );
    console.log(
      `  tickUpper: ${tickUpper} - ${tickInStableFormatter(tickUpper)}`
    );
    console.log(`  amount0: ${token0Formatter(amount0)}`);
    console.log(`  amount1: ${token1Formatter(amount1)}`);
  } else if (name == "Burn") {
    const { owner, tickLower, tickUpper, amount0, amount1 } = args;
    console.log(`${eventId}: Burn`);
    console.log(`  transaction sender: ${txSender}`);
    console.log(`  owner: ${owner}`);
    console.log(
      `  tickLower: ${tickLower} - ${tickInStableFormatter(tickLower)}`
    );
    console.log(
      `  tickUpper: ${tickUpper} - ${tickInStableFormatter(tickUpper)}`
    );
    console.log(`  amount0: ${token0Formatter(amount0)}`);
    console.log(`  amount1: ${token1Formatter(amount1)}`);
  } else {
    throw new Error(`Unexpected log entry event name: ${name}`);
  }
};

const tryNTimes = async <Res>(
  maxRetries: number,
  what: () => Promise<Res>
): Promise<Res> => {
  let retryCount = 0;
  while (true) {
    try {
      let res = await what();
      return res;
    } catch (e) {
      if (retryCount < maxRetries) {
        retryCount += 1;
        continue;
      }
      throw e;
    }
  }
};

const ensureIsNumber = (context: string, name: string, v: any): number => {
  if (typeof v !== "number") {
    if (isNaN(v)) {
      throw new Error(
        `${context}\n` + `"${name}" is not an number, observed value: "${v}"`
      );
    }

    v = Number(v);
  }

  return v;
};

const ensureIsBigint = (context: string, name: string, v: any): bigint => {
  try {
    return BigInt(v);
  } catch (e) {
    throw new Error(
      `${context}\n` + `${name} could not be parsed as BigInt: "${v}"\n` + e
    );
  }
};
