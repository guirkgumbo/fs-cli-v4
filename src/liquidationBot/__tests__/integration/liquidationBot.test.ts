import type { LiquidationBotEvents } from "@liquidationBot/reporting";
import { LiquidationError } from "@liquidationBot/errors";
import { BigNumber } from "ethers";
import {
  Deployment,
  LiquidationBot,
  liquidationBot,
} from "@liquidationBot/bot";
import * as deployments from "../../deployments";
import { TradeRouter } from "@generated/TradeRouter";
import { LiquidationBotApiV2 } from "@generated/LiquidationBotApiV2";
import { Provider } from "@ethersproject/providers";
import { IExchangeLedger } from "@generated/IExchangeLedger";

type ChangePositionEventResult = {
  args: {
    cpd: {
      trader: string;
      startAsset: BigNumber;
      startStable: BigNumber;
      totalAsset: BigNumber;
      totalStable: BigNumber;
    };
  };
};

jest.disableAutomock();

const setupMocks = (
  liquidationBot: LiquidationBot
): {
  mockChangePositionEvents: jest.MockedFunction<
    () => Promise<ChangePositionEventResult[]>
  >;
  mockLiquidate: jest.MockedFunction<() => Promise<Symbol>>;
  mockIsLiquidatable: jest.Mock;
  start: () => void;
} => {
  // TODO `as any as Type` conversion is not safe.  It would be nice to replace it with a more
  // comprehensive mock.  One that would through a meaningful error if an unexpected property is
  // accessed, for example.
  const mockLiquidate = jest.fn() as jest.MockedFunction<() => Promise<Symbol>>;
  const mockTradeRouter = {
    liquidate: mockLiquidate,
  } as any as TradeRouter;

  const mockChangePositionEvents = jest.fn() as jest.MockedFunction<
    () => Promise<ChangePositionEventResult[]>
  >;
  const mockExchangeLedger = {
    queryFilter: () => mockChangePositionEvents(),
    filters: { PositionChanged: () => null },
  } as any as IExchangeLedger;

  const mockIsLiquidatable = jest.fn();
  const mockLiquidationBotApi = {
    callStatic: { isLiquidatable: mockIsLiquidatable },
  } as any as LiquidationBotApiV2;

  const mockProvider = {
    getBlockNumber: () => 10,
  } as any as Provider;

  // Considering that the difference between v4 and v4.1 is only in external
  // APIs signatures and that v4 is deprecated, this file includes only tests
  // for v4.1
  const deployment: Deployment = deployments.v4_1.init({
    tradeRouter: mockTradeRouter,
    exchangeLedger: mockExchangeLedger,
    liquidationBotApi: mockLiquidationBotApi,
    tradeRouterAddress: "mockTradeRouter",
    exchangeLaunchBlock: 0,
    maxTradersPerLiquidationCheck: 1000,
    maxBlocksPerJsonRpcQuery: 1000,
  });

  const start = () => {
    // NOTE Timeouts here need to be very low, as we need to wait for a timeout to expire when
    // are stopping our tests.  So the shorter the timeouts are, the less time our tests will waste
    // when stopping.
    liquidationBot.start(deployment, mockProvider, 0.01, 0.01, 0.005, 0.001, 0);
  };

  return { mockChangePositionEvents, mockLiquidate, mockIsLiquidatable, start };
};

describe("liquidationBot", () => {
  /*
   * Because bot processors cycles are running on timers, the most natural way
   * to write integration tests on it would be to use Jest's fake timers API.
   * But unfortunately it doesn't work properly with Promises.
   * https://github.com/facebook/jest/issues/7151
   * Workaround exists, and I have tried some of them, but the results was from
   * not working at all to working unreliable.
   * Maybe it can be setup better, but I have decided just to set cycles time
   * length to a very low values in .env.test and control bot execution by
   * listening events. And it works great
   */
  type EventTypes = LiquidationBotEvents["type"];
  let botEvents: LiquidationBotEvents[] = [];

  // call collectBotEvents after bot.start() to collect specified events into
  // botEvents to assert them by the end of the test. If no events to collect
  // are specified then all events would be collected
  const collectBotEvents = (...eventsTypes: EventTypes[]) => {
    (async () => {
      for await (const event of liquidationBot.getEventsIterator()) {
        if (!eventsTypes || eventsTypes.includes(event.type)) {
          botEvents.push(event);
        }
      }
    })();
  };

  const onceBotEvent = async <EventType extends EventTypes>(
    eventType: EventType
  ): Promise<LiquidationBotEvents & { type: EventType }> => {
    for await (const event of liquidationBot.getEventsIterator()) {
      if (event.type === eventType) {
        return event as any;
      }
    }
    return undefined as never; // unreachable. Just for compiler
  };

  afterEach(async () => {
    await liquidationBot.stop();
    botEvents = [];
  });

  it("should liquidate liquidatable trader", async () => {
    const {
      mockChangePositionEvents,
      mockLiquidate,
      mockIsLiquidatable,
      start,
    } = setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValueOnce([true]);
    const mockLiquidationResult = Symbol("mockLiquidationResult");
    mockLiquidate.mockResolvedValueOnce(mockLiquidationResult);

    start();
    const { trader } = await onceBotEvent("traderLiquidated");

    expect(trader).toEqual("trader1");
  });

  it("should not liquidate non-liquidatable trader", async () => {
    const { mockChangePositionEvents, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValue([false]);

    start();
    collectBotEvents("traderLiquidated", "error");
    await onceBotEvent("tradersChecked");
    await onceBotEvent("tradersFetched");

    expect(botEvents).toBeEmpty();
  });

  it("should not liquidate trader who closed their position", async () => {
    const { mockChangePositionEvents, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValue([false]);

    start();
    await onceBotEvent("tradersChecked");
    await onceBotEvent("tradersFetched");

    closePositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValue([true]);

    expect(botEvents).toBeEmpty();
  });

  it("should liquidate only liquidatable trader", async () => {
    const {
      mockChangePositionEvents,
      mockLiquidate,
      mockIsLiquidatable,
      start,
    } = setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1", "trader2"]);
    mockIsLiquidatable.mockResolvedValueOnce([false, true]);
    const mockLiquidationResult = Symbol("mockLiquidationResult");
    mockLiquidate.mockResolvedValueOnce(mockLiquidationResult);

    start();
    const { trader } = await onceBotEvent("traderLiquidated");

    expect(trader).toEqual("trader2");
  });

  it("should liquidate trader after it would become liquidatable", async () => {
    const { mockChangePositionEvents, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValueOnce([false]);
    mockIsLiquidatable.mockResolvedValueOnce([true]);

    start();
    collectBotEvents("tradersChecked", "traderLiquidated", "error");
    await onceBotEvent("traderLiquidated");

    expect(botEvents).toEqual([
      expect.objectContaining({ type: "tradersChecked" }),
      expect.objectContaining({ type: "tradersChecked" }),
      expect.objectContaining({ type: "traderLiquidated" }),
    ]);
  });

  it("should not liquidate trader after it has been liquidated", async () => {
    const {
      mockChangePositionEvents,
      mockLiquidate,
      mockIsLiquidatable,
      start,
    } = setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValueOnce([true]);
    mockIsLiquidatable.mockResolvedValue([false]);
    const mockLiquidationResult = Symbol("mockLiquidationResult");
    mockLiquidate.mockResolvedValueOnce(mockLiquidationResult);

    start();
    collectBotEvents("tradersChecked", "traderLiquidated", "error");
    await onceBotEvent("tradersChecked");
    await onceBotEvent("tradersChecked");
    await onceBotEvent("tradersChecked");

    expect(botEvents).toEqual([
      expect.objectContaining({ type: "tradersChecked" }),
      expect.objectContaining({ type: "traderLiquidated" }),
      expect.objectContaining({ type: "tradersChecked" }),
      expect.objectContaining({ type: "tradersChecked" }),
    ]);
  });

  it("should retry to liquidate when error occurs on liquidation", async () => {
    const {
      mockChangePositionEvents,
      mockLiquidate,
      mockIsLiquidatable,
      start,
    } = setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValueOnce([true]); // call in check processor
    mockIsLiquidatable.mockResolvedValueOnce([true]); // call before retry
    mockLiquidate.mockRejectedValueOnce(Error("mock liquidate error"));
    const mockLiquidationResult = Symbol("mockLiquidationResult") as any;
    mockLiquidate.mockResolvedValueOnce(mockLiquidationResult);

    start();
    collectBotEvents("tradersChecked", "traderLiquidated", "error");
    await onceBotEvent("error"); // mock liquidate error
    await onceBotEvent("traderLiquidated");

    expect(botEvents).toEqual([
      expect.objectContaining({ type: "tradersChecked" }),
      { type: "error", error: expect.any(LiquidationError) },
      {
        type: "traderLiquidated",
        trader: "trader1",
        contractTransaction: mockLiquidationResult,
      },
    ]);
  });

  it("should not retry to liquidate when after error liquidatable trader becomes non-liquidatable", async () => {
    const {
      mockChangePositionEvents,
      mockLiquidate,
      mockIsLiquidatable,
      start,
    } = setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValueOnce([true]); // call in check processor
    mockIsLiquidatable.mockResolvedValue([false]); // call before retry and after
    mockLiquidate.mockRejectedValueOnce(Error("mock liquidate error"));

    start();
    collectBotEvents("traderLiquidated", "error");
    await onceBotEvent("error"); // mock liquidate error
    await onceBotEvent("tradersChecked");

    expect(botEvents).toEqual([
      { type: "error", error: expect.any(LiquidationError) },
    ]);
  });

  // TODO This logic is not implemented yet.
  it.skip("should not retry to liquidate when liquidation failed twice", async () => {
    const {
      mockChangePositionEvents,
      mockLiquidate,
      mockIsLiquidatable,
      start,
    } = setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, ["trader1"]);
    mockIsLiquidatable.mockResolvedValue([true]);
    mockLiquidate.mockRejectedValueOnce(Error("mock liquidate error 1"));
    mockLiquidate.mockRejectedValueOnce(Error("mock liquidate error 2"));

    start();
    collectBotEvents("traderLiquidated", "error");
    await onceBotEvent("error"); // mock liquidate error 1
    await onceBotEvent("error"); // mock liquidate error 2
    await onceBotEvent("tradersChecked");

    expect(botEvents).toEqual([
      { type: "error", error: expect.any(LiquidationError) },
      { type: "error", error: expect.any(LiquidationError) },
    ]);
  });

  it("should determine liquidatable traders when number of active traders exceeds the chunk size of liquidation bot api", async () => {
    const activeTraders = Array.from({ length: 5_000 }, (_, i) => `trader${i}`);
    const {
      mockChangePositionEvents,
      mockLiquidate,
      mockIsLiquidatable,
      start,
    } = setupMocks(liquidationBot);

    openPositions(mockChangePositionEvents, activeTraders);
    mockIsLiquidatable.mockResolvedValue([false, true]);
    const mockLiquidationResult = Symbol("mockLiquidationResult");
    mockLiquidate.mockResolvedValueOnce(mockLiquidationResult);

    start();
    const { trader: trader1 } = await onceBotEvent("traderLiquidated");
    const { trader: trader2 } = await onceBotEvent("traderLiquidated");
    const { trader: trader3 } = await onceBotEvent("traderLiquidated");
    const { trader: trader4 } = await onceBotEvent("traderLiquidated");
    const { trader: trader5 } = await onceBotEvent("traderLiquidated");

    expect(trader1).toEqual("trader1");
    expect(trader2).toEqual("trader1001");
    expect(trader3).toEqual("trader2001");
    expect(trader4).toEqual("trader3001");
    expect(trader5).toEqual("trader4001");
  });
});

function openPositions(
  mockChangePositionEvents: jest.MockedFunction<
    () => Promise<ChangePositionEventResult[]>
  >,
  traders: string[]
) {
  addTradeActivity(
    mockChangePositionEvents,
    traders,
    BigNumber.from(0),
    BigNumber.from(0),
    BigNumber.from(100),
    BigNumber.from(100)
  );
}

function closePositions(
  mockChangePositionEvents: jest.MockedFunction<
    () => Promise<ChangePositionEventResult[]>
  >,
  traders: string[]
) {
  addTradeActivity(
    mockChangePositionEvents,
    traders,
    BigNumber.from(100),
    BigNumber.from(100),
    BigNumber.from(0),
    BigNumber.from(0)
  );
}

function addTradeActivity(
  mockChangePositionEvents: jest.MockedFunction<
    () => Promise<ChangePositionEventResult[]>
  >,
  traders: string[],
  startAsset: BigNumber,
  startStable: BigNumber,
  totalAsset: BigNumber,
  totalStable: BigNumber
) {
  const activities = traders.map((trader) => {
    return {
      args: {
        cpd: { startAsset, startStable, totalAsset, totalStable, trader },
      },
    };
  });
  mockChangePositionEvents.mockResolvedValue(activities);
}
