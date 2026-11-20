import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EventLoop, { EventLoopBudget } from "../../../Server/Utils/EventLoop";
import SlicedWork, { SlicedWorkSteps } from "../../../Utils/SlicedWork";

/*
 * WORK THAT CAN PAUSE (issue #10108).
 *
 * A grouped monitor's loops over 16,000 series are written as generators
 * that pause between two series or every so many rows (SlicedWork):
 * SlicedWork.runToEnd runs one through as the synchronous function it was,
 * and EventLoop.runInSlices hands the event loop back at a pause once the
 * work since the last hand-back took its budget. The clock is moved by hand
 * (EventLoop.now replaced) and each hand-back recorded, so no test depends
 * on how fast the machine running it is.
 */

let fakeNow: number;
let handBacksAt: Array<number>;

beforeEach(() => {
  fakeNow = 1_000;
  handBacksAt = [];

  jest.spyOn(EventLoop, "now").mockImplementation((): number => {
    return fakeNow;
  });

  jest
    .spyOn(EventLoop, "yieldToEventLoop")
    .mockImplementation(async (): Promise<void> => {
      handBacksAt.push(fakeNow);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Work over items that each take the given time, pausing after each, and
 * recording when each started: what a series loop is.
 */
function* itemsWork(input: {
  itemTimes: Array<number>;
  startedAt: Array<number>;
}): SlicedWorkSteps<number> {
  let total: number = 0;

  for (const itemTime of input.itemTimes) {
    input.startedAt.push(fakeNow);
    fakeNow += itemTime;
    total += itemTime;

    yield;
  }

  return total;
}

function* failingWork(afterItems: number): SlicedWorkSteps<string> {
  for (let index: number = 0; index < afterItems; index++) {
    fakeNow += 10;
    yield;
  }

  throw new Error("the work failed part way");
}

describe("SlicedWork.runToEnd", () => {
  test("runs the work through and returns what it returns, never handing the loop back", () => {
    const startedAt: Array<number> = [];

    const total: number = SlicedWork.runToEnd(
      itemsWork({ itemTimes: new Array<number>(100).fill(7), startedAt }),
    );

    expect(total).toBe(700);
    expect(startedAt).toHaveLength(100);
    expect(handBacksAt).toEqual([]);
  });

  test("throws what the work throws", () => {
    expect(() => {
      SlicedWork.runToEnd(failingWork(3));
    }).toThrow("the work failed part way");
  });

  test("work without a pause is its value", () => {
    // eslint-disable-next-line require-yield
    function* noPause(): SlicedWorkSteps<string> {
      return "done";
    }

    expect(SlicedWork.runToEnd(noPause())).toBe("done");
  });
});

describe("EventLoop.runInSlices", () => {
  test("hands the loop back at a pause once the budget is spent, never more often", async () => {
    const startedAt: Array<number> = [];

    const total: number = await EventLoop.runInSlices(
      itemsWork({ itemTimes: new Array<number>(100).fill(3), startedAt }),
      new EventLoopBudget(20),
    );

    expect(total).toBe(300);
    // 300 ms of work, the loop handed back every 21 ms: after 7 items.
    expect(handBacksAt).toHaveLength(14);

    let from: number = 1_000;
    for (const at of handBacksAt) {
      expect(at - from).toBeGreaterThanOrEqual(20);
      expect(at - from).toBeLessThan(20 + 3);
      from = at;
    }
  });

  test("never hands the loop back inside a step: an item longer than the budget is one stretch", async () => {
    const startedAt: Array<number> = [];

    await EventLoop.runInSlices(
      itemsWork({ itemTimes: [5, 45, 5, 45, 5], startedAt }),
      new EventLoopBudget(20),
    );

    // After each long item, and only at a pause.
    expect(handBacksAt).toEqual([1_050, 1_100]);
    expect(startedAt).toEqual([1_000, 1_005, 1_050, 1_055, 1_100]);
  });

  test("work shorter than its budget is never handed back", async () => {
    const startedAt: Array<number> = [];

    await EventLoop.runInSlices(
      itemsWork({ itemTimes: new Array<number>(19).fill(1), startedAt }),
      new EventLoopBudget(20),
    );

    expect(handBacksAt).toEqual([]);
  });

  test("throws what the work throws, and runs no further", async () => {
    await expect(
      EventLoop.runInSlices(failingWork(5), new EventLoopBudget(20)),
    ).rejects.toThrow("the work failed part way");

    expect(handBacksAt).toEqual([1_020, 1_040]);
  });

  test("pieces of work given one budget share its clock", async () => {
    const budget: EventLoopBudget = new EventLoopBudget(20);
    const startedAt: Array<number> = [];

    // 15 ms of work, then 15 more: one hand-back between, at 1,020.
    await EventLoop.runInSlices(
      itemsWork({ itemTimes: [5, 5, 5], startedAt }),
      budget,
    );
    expect(handBacksAt).toEqual([]);

    await EventLoop.runInSlices(
      itemsWork({ itemTimes: [5, 5, 5], startedAt }),
      budget,
    );
    expect(handBacksAt).toEqual([1_020]);
  });

  test("without a budget given, makes one of EVENT_LOOP_BUDGET_MS", async () => {
    const startedAt: Array<number> = [];

    await EventLoop.runInSlices(
      itemsWork({ itemTimes: new Array<number>(10).fill(10), startedAt }),
    );

    expect(handBacksAt).toEqual([1_020, 1_040, 1_060, 1_080, 1_100]);
  });
});

describe("EventLoop.yieldToEventLoop", () => {
  test("turns the loop by a timer where there is no setImmediate", async () => {
    jest.restoreAllMocks();

    const globals: { setImmediate?: unknown } = globalThis as unknown as {
      setImmediate?: unknown;
    };
    const setImmediateWas: unknown = globals.setImmediate;
    const setTimeoutSpy: jest.SpiedFunction<typeof setTimeout> = jest.spyOn(
      global,
      "setTimeout",
    );

    try {
      globals.setImmediate = undefined;

      let timerRan: boolean = false;
      setTimeout((): void => {
        timerRan = true;
      }, 0);

      await EventLoop.yieldToEventLoop();

      expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
      // A timer due before it ran across it: the loop had its turn.
      expect(timerRan).toBe(true);
    } finally {
      globals.setImmediate = setImmediateWas;
    }
  });
});
