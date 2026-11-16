import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import timers from "timers";
import EventLoop, {
  EVENT_LOOP_BUDGET_MS,
  EventLoopBudget,
} from "../../../Server/Utils/EventLoop";

/*
 * HAND THE EVENT LOOP BACK BY THE TIME THE WORK TOOK (#6514).
 *
 * Telemetry ingest handed the event loop back every 500 logs or 200 spans,
 * and a record's work is not bounded by that count: a batch of records at
 * the scrub rules' 10,000-value bound held the loop for seconds, every other
 * request and job on the process waiting. An EventLoopBudget hands it back
 * once the work since the last time took EVENT_LOOP_BUDGET_MS, whatever the
 * records carry.
 *
 * Every test here reads a clock it moves itself (EventLoop.now replaced), so
 * none depends on how fast the machine running it is.
 */

// Common's jest environment is jsdom, which has no setImmediate.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

let fakeNow: number;
let handBacksAt: Array<number>;
// What the other work on the process takes while the loop is handed back.
let otherWorkPerHandBack: number;

beforeEach(() => {
  fakeNow = 1_000;
  handBacksAt = [];
  otherWorkPerHandBack = 0;

  jest.spyOn(EventLoop, "now").mockImplementation((): number => {
    return fakeNow;
  });

  jest
    .spyOn(EventLoop, "yieldToEventLoop")
    .mockImplementation(async (): Promise<void> => {
      handBacksAt.push(fakeNow);
      fakeNow += otherWorkPerHandBack;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A loop over records whose work took the given times, asking the budget
 * before each one as ingest does. Returns where, in fake time, each record
 * started: the stretch between two hand-backs is read from them.
 */
async function runRecords(
  budget: EventLoopBudget,
  recordTimes: Array<number>,
): Promise<Array<number>> {
  const startedAt: Array<number> = [];

  for (const recordTime of recordTimes) {
    if (budget.isSpent()) {
      await budget.handBack();
    }

    startedAt.push(fakeNow);
    fakeNow += recordTime;
  }

  return startedAt;
}

// The longest time the loop was held between two hand-backs, or before one.
function longestStretch(start: number, end: number): number {
  let longest: number = 0;
  let from: number = start;

  for (const at of handBacksAt) {
    longest = Math.max(longest, at - from);
    from = at + otherWorkPerHandBack;
  }

  return Math.max(longest, end - from);
}

describe("EventLoopBudget", () => {
  test("is not spent before the budget's time has passed, and is once it has", () => {
    const budget: EventLoopBudget = new EventLoopBudget(20);

    expect(budget.isSpent()).toBe(false);

    fakeNow += 19.999;
    expect(budget.isSpent()).toBe(false);

    fakeNow += 0.001;
    expect(budget.isSpent()).toBe(true);

    fakeNow += 1_000;
    expect(budget.isSpent()).toBe(true);
  });

  test("starts with EVENT_LOOP_BUDGET_MS, from when it is made", () => {
    expect(EVENT_LOOP_BUDGET_MS).toBe(20);

    fakeNow += 500;
    const budget: EventLoopBudget = new EventLoopBudget();

    fakeNow += EVENT_LOOP_BUDGET_MS - 1;
    expect(budget.isSpent()).toBe(false);

    fakeNow += 1;
    expect(budget.isSpent()).toBe(true);
  });

  test("asking never hands the loop back and never awaits: it is a plain answer", () => {
    const budget: EventLoopBudget = new EventLoopBudget(20);

    fakeNow += 25;

    const answer: unknown = budget.isSpent();

    expect(answer).toBe(true);
    expect(handBacksAt).toEqual([]);
  });

  test("handing back yields to the event loop, and the budget starts again", async () => {
    const budget: EventLoopBudget = new EventLoopBudget(20);

    fakeNow += 30;
    expect(budget.isSpent()).toBe(true);

    await budget.handBack();

    expect(handBacksAt).toEqual([1_030]);
    expect(budget.isSpent()).toBe(false);

    fakeNow += 19;
    expect(budget.isSpent()).toBe(false);

    fakeNow += 1;
    expect(budget.isSpent()).toBe(true);
  });

  test("the budget starts again from when the loop is back, not from when it was handed back", async () => {
    // Other work runs 15 ms while the loop is handed back.
    otherWorkPerHandBack = 15;
    const budget: EventLoopBudget = new EventLoopBudget(20);

    fakeNow += 20;
    await budget.handBack();

    // Back at 1,035: the loop has all of its 20 ms again.
    expect(fakeNow).toBe(1_035);
    fakeNow += 19;
    expect(budget.isSpent()).toBe(false);
    fakeNow += 1;
    expect(budget.isSpent()).toBe(true);
  });

  test("records of very different sizes: the loop is never held longer than the budget and one record", async () => {
    const budget: EventLoopBudget = new EventLoopBudget(20);
    // Small records of 0.02 ms, among them large ones of 7 and 13 ms.
    const recordTimes: Array<number> = [];

    for (let index: number = 0; index < 5_000; index++) {
      recordTimes.push(index % 97 === 0 ? (index % 2 === 0 ? 13 : 7) : 0.02);
    }

    const start: number = fakeNow;
    await runRecords(budget, recordTimes);

    expect(handBacksAt.length).toBeGreaterThan(0);
    expect(longestStretch(start, fakeNow)).toBeLessThan(20 + 13);

    // And each stretch ended as soon as the budget was spent, not later.
    let from: number = start;

    for (const at of handBacksAt) {
      expect(at - from).toBeGreaterThanOrEqual(20);
      from = at;
    }
  });

  test("records each larger than the budget: the loop is handed back before every record after the first", async () => {
    const budget: EventLoopBudget = new EventLoopBudget(20);

    await runRecords(budget, new Array<number>(50).fill(45));

    // 49 hand-backs: before each record but the first.
    expect(handBacksAt).toHaveLength(49);
    expect(longestStretch(1_000, fakeNow)).toBe(45);
  });

  test("small records are handed back by the time they take: 20,000 records of 0.03 ms, about once every 20 ms", async () => {
    const budget: EventLoopBudget = new EventLoopBudget(20);

    await runRecords(budget, new Array<number>(20_000).fill(0.03));

    /*
     * 600 ms of work, so 29 hand-backs (one every 667 records): fewer than
     * the 40 a hand-back every 500 records made - what log ingest did for
     * records that take less than 0.04 ms each.
     */
    expect(handBacksAt).toHaveLength(29);
    expect(handBacksAt.length).toBeLessThan(20_000 / 500);
    expect(longestStretch(1_000, fakeNow)).toBeLessThan(20 + 0.03 + 1e-9);
  });

  test("a batch shorter than the budget is never handed back", async () => {
    const budget: EventLoopBudget = new EventLoopBudget(20);

    await runRecords(budget, new Array<number>(600).fill(0.03));

    expect(handBacksAt).toEqual([]);
  });

  test("each batch has a budget of its own", async () => {
    const first: EventLoopBudget = new EventLoopBudget(20);

    fakeNow += 15;

    const second: EventLoopBudget = new EventLoopBudget(20);

    fakeNow += 5;

    expect(first.isSpent()).toBe(true);
    expect(second.isSpent()).toBe(false);

    await first.handBack();

    expect(first.isSpent()).toBe(false);
    expect(second.isSpent()).toBe(false);
    fakeNow += 15;
    expect(second.isSpent()).toBe(true);
    expect(first.isSpent()).toBe(false);
  });
});

describe("EventLoop.now", () => {
  test("reads a clock in milliseconds that never goes back", () => {
    jest.restoreAllMocks();

    const readings: Array<number> = [];

    for (let index: number = 0; index < 1_000; index++) {
      readings.push(EventLoop.now());
    }

    for (let index: number = 1; index < readings.length; index++) {
      expect(readings[index]!).toBeGreaterThanOrEqual(readings[index - 1]!);
    }

    // Milliseconds: a real wait of 5 ms reads as about 5, not 5,000,000.
    const before: number = EventLoop.now();
    const spinUntil: number = Date.now() + 5;

    while (Date.now() < spinUntil) {
      // Holding the thread is the work here.
    }

    const elapsed: number = EventLoop.now() - before;

    expect(elapsed).toBeGreaterThanOrEqual(4);
    expect(elapsed).toBeLessThan(5_000);
  });

  test("a budget on the real clock is spent once its time has really passed, and hands back through a real yield", async () => {
    jest.restoreAllMocks();

    const budget: EventLoopBudget = new EventLoopBudget(2);

    expect(budget.isSpent()).toBe(false);

    const spinUntil: number = EventLoop.now() + 3;

    while (EventLoop.now() < spinUntil) {
      // Holding the thread is the work here.
    }

    expect(budget.isSpent()).toBe(true);

    let immediateRan: boolean = false;

    setImmediate((): void => {
      immediateRan = true;
    });

    await budget.handBack();

    // A pending immediate ran across the hand-back: the loop had its turn.
    expect(immediateRan).toBe(true);
    expect(budget.isSpent()).toBe(false);
  });
});
