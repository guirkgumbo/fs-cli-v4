import type { LiquidationBotEvents } from "@liquidationBot/reporting";
import { LiquidationError } from "@liquidationBot/errors";
import { LiquidationBot, liquidationBot } from "@liquidationBot/bot";
import { IExchange } from "@generated/IExchange";
import { LiquidationBotApi } from "@generated/LiquidationBotApi";

jest.disableAutomock();

const mockFetchTraders = jest.fn() as jest.MockedFunction<
  () => Promise<{ trades: { trader: string }[] }>
>;
jest.mock("axios", () => ({
  get: jest.fn(async () => ({ data: await mockFetchTraders() })),
}));

const setupMocks = (
  liquidationBot: LiquidationBot
): {
  mockLiquidate: jest.Mock;
  mockIsLiquidatable: jest.Mock;
  start: () => void;
} => {
  // TODO `as any as Type` conversion is not safe.  It would be nice to replace it with a more
  // comprehensive mock.  One that would through a meaningful error if an unexpected property is
  // accessed, for example.

  const mockLiquidate = jest.fn();
  const mockExchange = {
    liquidate: mockLiquidate,
  } as any as IExchange;

  const mockIsLiquidatable = jest.fn();
  const mockLiquidationBotApi = {
    callStatic: { isLiquidatable: mockIsLiquidatable },
  } as any as LiquidationBotApi;

  const start = () => {
    // NOTE Timeouts here need to be very low, as we need to wait for a timeout to expire when when
    // are stopping our tests.  So the shorter the timeouts are, the less time our tests will waste
    // when stopping.
    liquidationBot.start(
      mockExchange,
      mockLiquidationBotApi,
      "http://backend/trades",
      0.01,
      0.005,
      0.001,
      1000
    );
  };

  return { mockLiquidate, mockIsLiquidatable, start };
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
    const { mockLiquidate, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    mockFetchTraders.mockResolvedValue({ trades: [{ trader: "trader1" }] });
    mockIsLiquidatable.mockResolvedValueOnce([true]);
    const mockLiquidationResult = Symbol("mockLiquidationResult") as any;
    mockLiquidate.mockResolvedValueOnce(mockLiquidationResult);

    start();
    const { trader } = await onceBotEvent("traderLiquidated");

    expect(trader).toEqual("trader1");
  });

  it("should not liquidate non-liquidatable trader", async () => {
    const { mockIsLiquidatable, start } = setupMocks(liquidationBot);

    mockFetchTraders.mockResolvedValue({ trades: [{ trader: "trader1" }] });
    mockIsLiquidatable.mockResolvedValue([false]);

    start();
    collectBotEvents("traderLiquidated", "error");
    await onceBotEvent("tradersChecked");
    await onceBotEvent("tradersFetched"); // some long waining

    expect(botEvents).toBeEmpty();
  });

  it("should liquidate only liquidatable trader", async () => {
    const { mockLiquidate, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    mockFetchTraders.mockResolvedValue({
      trades: [{ trader: "trader1" }, { trader: "trader2" }],
    });
    mockIsLiquidatable.mockResolvedValueOnce([false, true]);
    const mockLiquidationResult = Symbol("mockLiquidationResult") as any;
    mockLiquidate.mockResolvedValueOnce(mockLiquidationResult);

    start();
    const { trader } = await onceBotEvent("traderLiquidated");

    expect(trader).toEqual("trader2");
  });

  it("should liquidate trader after it would become liquidatable", async () => {
    const { mockIsLiquidatable, start } = setupMocks(liquidationBot);

    mockFetchTraders.mockResolvedValue({ trades: [{ trader: "trader1" }] });
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
    const { mockLiquidate, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    mockFetchTraders.mockResolvedValue({ trades: [{ trader: "trader1" }] });
    mockIsLiquidatable.mockResolvedValueOnce([true]);
    mockIsLiquidatable.mockResolvedValue([false]);
    const mockLiquidationResult = Symbol("mockLiquidationResult") as any;
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
    const { mockLiquidate, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    mockFetchTraders.mockResolvedValue({ trades: [{ trader: "trader1" }] });
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

  it("should not retry to liquidate when trader becomes non-liquidatable", async () => {
    const { mockLiquidate, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    mockFetchTraders.mockResolvedValue({ trades: [{ trader: "trader1" }] });
    mockIsLiquidatable.mockResolvedValueOnce([true]); // call in check processor
    mockIsLiquidatable.mockResolvedValue([false]); // call before retry and after
    mockLiquidate.mockRejectedValueOnce(Error("mock liquidate error"));

    start();
    collectBotEvents("traderLiquidated", "error");
    await onceBotEvent("error"); // mock liquidate error
    await onceBotEvent("tradersChecked"); // some long waining

    expect(botEvents).toEqual([
      { type: "error", error: expect.any(LiquidationError) },
    ]);
  });

  // TODO This logic is not implemented yet.
  it.skip("should not retry to liquidate when liquidation failed twice", async () => {
    const { mockLiquidate, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    mockFetchTraders.mockResolvedValue({ trades: [{ trader: "trader1" }] });
    mockIsLiquidatable.mockResolvedValue([true]);
    mockLiquidate.mockRejectedValueOnce(Error("mock liquidate error 1"));
    mockLiquidate.mockRejectedValueOnce(Error("mock liquidate error 2"));

    start();
    collectBotEvents("traderLiquidated", "error");
    await onceBotEvent("error"); // mock liquidate error 1
    await onceBotEvent("error"); // mock liquidate error 2
    await onceBotEvent("tradersChecked"); // some long waining

    expect(botEvents).toEqual([
      { type: "error", error: expect.any(LiquidationError) },
      { type: "error", error: expect.any(LiquidationError) },
    ]);
  });

  it("chunks api requests when too many active traders", async () => {
    const { mockLiquidate, mockIsLiquidatable, start } =
      setupMocks(liquidationBot);

    const activeTraders = Array.from({ length: 5_000 }, (_, i) => ({
      trader: `trader${i}`,
    }));
    mockFetchTraders.mockResolvedValue({ trades: activeTraders });
    mockIsLiquidatable.mockResolvedValue([false, true]);
    const mockLiquidationResult = Symbol("mockLiquidationResult") as any;
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
