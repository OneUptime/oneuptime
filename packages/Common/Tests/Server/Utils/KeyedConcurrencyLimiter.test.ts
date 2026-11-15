import KeyedConcurrencyLimiter, {
  KeyedConcurrencyLimits,
  KeyedConcurrencyRelease,
} from "../../../Server/Utils/KeyedConcurrencyLimiter";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The generic per-process, per-key limiter behind Topology's reads, the
 * probes' scheduling requests and the Postgres connections queue jobs
 * borrow: how many callers hold a slot at once, per process and per key;
 * that waiters start in arrival order without a key at its limit holding up
 * another; that a full queue or a long wait is the limiter's own busy error
 * without running anything; that a caller who leaves gives its place up;
 * and that a slot is always given back exactly once, however the work ends.
 */

class BusyError extends Error {
  public constructor() {
    super("busy");
    this.name = "BusyError";
  }
}

class AbandonedError extends Error {
  public constructor() {
    super("abandoned");
    this.name = "AbandonedError";
  }
}

const LIMITS: KeyedConcurrencyLimits = {
  maxRunning: 4,
  maxRunningPerKey: 2,
  maxWaiting: 64,
  maxWaitingPerKey: 16,
  maxWaitMs: 60_000,
};

function limiterWith(
  limits: Partial<KeyedConcurrencyLimits> = {},
): KeyedConcurrencyLimiter {
  return new KeyedConcurrencyLimiter({
    limits: { ...LIMITS, ...limits },
    busyError: (): Error => {
      return new BusyError();
    },
    abandonedError: (): Error => {
      return new AbandonedError();
    },
  });
}

interface Job {
  label: string;
  started: boolean;
  settled: boolean;
  result: Promise<string>;
  finish: () => void;
  fail: (error: Error) => void;
}

/*
 * Lets queued promise callbacks (a slot handed over, work starting) run. A
 * process.nextTick callback runs only once every queued promise callback
 * has, so this works on Jest's fake clock as well, without moving it.
 */
async function settle(): Promise<void> {
  for (let round: number = 0; round < 3; round++) {
    await new Promise<void>((resolve: () => void): void => {
      process.nextTick(resolve);
    });
  }
}

/*
 * A unit of work under the limiter that runs until the test finishes or
 * fails it. `started` records whether the limiter let it run; `order` the
 * order in which jobs started.
 */
function launch(
  limiter: KeyedConcurrencyLimiter,
  key: string,
  label: string,
  order: Array<string>,
  options?: { signal?: AbortSignal; maxWaitMs?: number },
): Job {
  let finish: () => void = (): void => {
    return undefined;
  };
  let fail: (error: Error) => void = (): void => {
    return undefined;
  };
  const job: Job = {
    label,
    started: false,
    settled: false,
    result: Promise.resolve(""),
    finish: (): void => {
      finish();
    },
    fail: (error: Error): void => {
      fail(error);
    },
  };
  job.result = limiter.run(
    key,
    (): Promise<string> => {
      job.started = true;
      order.push(label);
      return new Promise<string>(
        (resolve: (value: string) => void, reject: (error: Error) => void) => {
          finish = (): void => {
            resolve(label);
          };
          fail = reject;
        },
      );
    },
    options,
  );
  job.result.then(
    (): void => {
      job.settled = true;
    },
    (): void => {
      job.settled = true;
    },
  );
  return job;
}

async function refusal(job: Job): Promise<unknown> {
  try {
    await job.result;
  } catch (error) {
    return error;
  }
  return null;
}

async function finishAll(jobs: Array<Job>): Promise<void> {
  // Each finish() may start a waiter, which needs its own finish() after.
  for (let round: number = 0; round <= jobs.length; round++) {
    for (const job of jobs) {
      job.finish();
    }
    await settle();
  }
  await Promise.allSettled(
    jobs.map((job: Job): Promise<string> => {
      return job.result;
    }),
  );
}

describe("KeyedConcurrencyLimiter", () => {
  test("runs the work and hands back its result, then frees the slot", async () => {
    const limiter: KeyedConcurrencyLimiter = limiterWith();
    expect(
      await limiter.run("k", async (): Promise<number> => {
        expect(limiter.runningCount()).toBe(1);
        expect(limiter.runningCount("k")).toBe(1);
        return 42;
      }),
    ).toBe(42);
    expect(limiter.runningCount()).toBe(0);
    expect(limiter.runningCount("k")).toBe(0);
    expect(limiter.limits).toEqual(LIMITS);
  });

  describe("queueing", () => {
    test("never more than the process limit at once; waiters start in arrival order as slots free up", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith();
      const order: Array<string> = [];
      const jobs: Array<Job> = ["a", "b", "c", "d", "e", "f"].map(
        (key: string): Job => {
          return launch(limiter, key, key, order);
        },
      );
      await settle();
      expect(order).toEqual(["a", "b", "c", "d"]);
      expect(limiter.runningCount()).toBe(4);
      expect(limiter.waitingCount()).toBe(2);
      expect(limiter.waitingCount("e")).toBe(1);

      jobs[1]!.finish();
      await settle();
      expect(order).toEqual(["a", "b", "c", "d", "e"]);
      expect(limiter.runningCount()).toBe(4);
      expect(limiter.waitingCount()).toBe(1);
      expect(limiter.waitingCount("e")).toBe(0);

      await finishAll(jobs);
      expect(order).toEqual(["a", "b", "c", "d", "e", "f"]);
      expect(limiter.runningCount()).toBe(0);
      expect(limiter.waitingCount()).toBe(0);
    });

    test("a slot is given back when the work fails or throws, and the next waiter runs", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({ maxRunning: 1 });
      const order: Array<string> = [];
      const failing: Job = launch(limiter, "a", "failing", order);
      const next: Job = launch(limiter, "b", "next", order);
      await settle();
      expect(next.started).toBe(false);

      failing.fail(new Error("statement timeout"));
      await expect(failing.result).rejects.toThrow("statement timeout");
      await settle();
      expect(next.started).toBe(true);
      expect(limiter.runningCount("a")).toBe(0);

      next.finish();
      await next.result;

      // Work that throws before returning a promise frees its slot too.
      await expect(
        limiter.run("c", (): Promise<string> => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(limiter.runningCount()).toBe(0);
      expect(
        await limiter.run("c", async (): Promise<string> => {
          return "still works";
        }),
      ).toBe("still works");
    });
  });

  describe("per-key fairness", () => {
    test("one key gets at most its share; another key is not held up behind it", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith();
      const order: Array<string> = [];
      const busy: Array<Job> = [1, 2, 3, 4, 5].map((index: number): Job => {
        return launch(limiter, "busy", `busy-${index}`, order);
      });
      await settle();
      expect(order).toEqual(["busy-1", "busy-2"]);
      expect(limiter.runningCount("busy")).toBe(2);
      expect(limiter.waitingCount("busy")).toBe(3);

      // Queued after busy's waiters, yet starts at once: the process has room.
      const quiet: Job = launch(limiter, "quiet", "quiet-1", order);
      await settle();
      expect(quiet.started).toBe(true);
      expect(order).toEqual(["busy-1", "busy-2", "quiet-1"]);

      // busy's own waiters go in arrival order, one per slot busy gives back.
      busy[0]!.finish();
      await settle();
      expect(order).toEqual(["busy-1", "busy-2", "quiet-1", "busy-3"]);
      expect(busy[3]!.started).toBe(false);

      await finishAll([...busy, quiet]);
      expect(order).toEqual([
        "busy-1",
        "busy-2",
        "quiet-1",
        "busy-3",
        "busy-4",
        "busy-5",
      ]);
    });

    test("a freed slot goes to the first waiter that may use it, skipping keys at their limit", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 2,
        maxRunningPerKey: 1,
      });
      const order: Array<string> = [];
      const a1: Job = launch(limiter, "a", "a1", order);
      const b1: Job = launch(limiter, "b", "b1", order);
      const a2: Job = launch(limiter, "a", "a2", order);
      const a3: Job = launch(limiter, "a", "a3", order);
      const b2: Job = launch(limiter, "b", "b2", order);
      const c1: Job = launch(limiter, "c", "c1", order);
      await settle();
      expect(order).toEqual(["a1", "b1"]);

      // b's slot: a2 and a3 are first in line but a is at its limit.
      b1.finish();
      await settle();
      expect(order).toEqual(["a1", "b1", "b2"]);

      // a's slot: a2, the first in line that may start now.
      a1.finish();
      await settle();
      expect(order).toEqual(["a1", "b1", "b2", "a2"]);

      b2.finish();
      await settle();
      expect(order).toEqual(["a1", "b1", "b2", "a2", "c1"]);

      await finishAll([a1, b1, a2, a3, b2, c1]);
      expect(order).toEqual(["a1", "b1", "b2", "a2", "c1", "a3"]);
    });

    test("with a per-key limit as large as the process's, it is one plain arrival-order queue", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 2,
        maxRunningPerKey: 2,
      });
      const order: Array<string> = [];
      const jobs: Array<Job> = [
        launch(limiter, "telemetry", "t1", order),
        launch(limiter, "telemetry", "t2", order),
        launch(limiter, "telemetry", "t3", order),
        launch(limiter, "worker", "w1", order),
      ];
      await settle();
      expect(order).toEqual(["t1", "t2"]);

      jobs[0]!.finish();
      await settle();
      // t3 came first, and its key is under its limit.
      expect(order).toEqual(["t1", "t2", "t3"]);

      await finishAll(jobs);
      expect(order).toEqual(["t1", "t2", "t3", "w1"]);
    });
  });

  describe("busy answers", () => {
    test("a full queue is the limiter's busy error at once, and the refused work never runs", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 1,
        maxRunningPerKey: 1,
        maxWaiting: 2,
      });
      const order: Array<string> = [];
      const running: Job = launch(limiter, "a", "running", order);
      const waiting: Array<Job> = [
        launch(limiter, "b", "waiting-1", order),
        launch(limiter, "c", "waiting-2", order),
      ];
      const refused: Job = launch(limiter, "d", "refused", order);
      await settle();

      const error: unknown = await refusal(refused);
      expect(error).toBeInstanceOf(BusyError);
      expect(limiter.waitingCount()).toBe(2);

      await finishAll([running, ...waiting]);
      expect(order).toEqual(["running", "waiting-1", "waiting-2"]);
      expect(refused.started).toBe(false);
    });

    test("one key cannot fill the queue: past its own share it is refused, others still queue", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 1,
        maxRunningPerKey: 1,
        maxWaiting: 10,
        maxWaitingPerKey: 2,
      });
      const order: Array<string> = [];
      const jobs: Array<Job> = [
        launch(limiter, "a", "a-running", order),
        launch(limiter, "a", "a-waiting-1", order),
        launch(limiter, "a", "a-waiting-2", order),
      ];
      const refused: Job = launch(limiter, "a", "a-refused", order);
      const other: Job = launch(limiter, "b", "b-waiting", order);
      await settle();
      expect(await refusal(refused)).toBeInstanceOf(BusyError);
      expect(limiter.waitingCount("a")).toBe(2);
      expect(limiter.waitingCount("b")).toBe(1);

      await finishAll([...jobs, other]);
      expect(refused.started).toBe(false);
      // In arrival order: a's waiters came first, and a was under its limit.
      expect(order).toEqual([
        "a-running",
        "a-waiting-1",
        "a-waiting-2",
        "b-waiting",
      ]);
    });
  });

  /*
   * On Jest's fake clock, so a wait limit passes exactly where a test moves
   * time past it rather than racing the limiter's own timer.
   */
  describe("the wait limit", () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ["nextTick"] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test("a caller that waits past the limit gets the busy error, leaves the queue and never runs", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 1,
        maxWaitMs: 25,
      });
      const order: Array<string> = [];
      const running: Job = launch(limiter, "a", "running", order);
      const waiting: Job = launch(limiter, "b", "waiting", order);
      await settle();
      expect(limiter.waitingCount()).toBe(1);

      // Still waiting a moment before the limit...
      jest.advanceTimersByTime(24);
      await settle();
      expect(waiting.settled).toBe(false);
      expect(limiter.waitingCount("b")).toBe(1);

      // ...and refused at it.
      jest.advanceTimersByTime(1);
      expect(await refusal(waiting)).toBeInstanceOf(BusyError);
      expect(limiter.waitingCount()).toBe(0);
      expect(limiter.waitingCount("b")).toBe(0);

      running.finish();
      await running.result;
      await settle();
      expect(waiting.started).toBe(false);
      expect(order).toEqual(["running"]);
      expect(limiter.runningCount()).toBe(0);
    });

    test("a waiter that gets its slot in time is not refused later", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 1,
        maxWaitMs: 40,
      });
      const order: Array<string> = [];
      const running: Job = launch(limiter, "a", "running", order);
      const waiting: Job = launch(limiter, "b", "waiting", order);
      await settle();

      // Its slot comes free just inside the limit.
      jest.advanceTimersByTime(39);
      running.finish();
      await settle();
      expect(waiting.started).toBe(true);
      // The wait timer went with the wait...
      expect(jest.getTimerCount()).toBe(0);

      // ...so passing the limit while it runs refuses nothing.
      jest.advanceTimersByTime(60);
      await settle();
      expect(waiting.settled).toBe(false);
      waiting.finish();
      expect(await waiting.result).toBe("waiting");
    });

    test("a caller can wait less than the limiter's limit, and a short wait does not shorten anyone else's", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 1,
        maxWaitMs: 5_000,
      });
      const order: Array<string> = [];
      const running: Job = launch(limiter, "a", "running", order);
      const impatient: Job = launch(limiter, "b", "impatient", order, {
        maxWaitMs: 1_000,
      });
      const patient: Job = launch(limiter, "c", "patient", order);
      await settle();

      jest.advanceTimersByTime(1_000);
      expect(await refusal(impatient)).toBeInstanceOf(BusyError);
      await settle();
      expect(patient.settled).toBe(false);
      expect(limiter.waitingCount()).toBe(1);

      jest.advanceTimersByTime(3_999);
      await settle();
      expect(patient.settled).toBe(false);

      running.finish();
      await settle();
      expect(patient.started).toBe(true);
      patient.finish();
      expect(await patient.result).toBe("patient");
      expect(order).toEqual(["running", "patient"]);
    });

    test("a wait limit of zero refuses at once unless a slot is free now", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 1,
      });
      const order: Array<string> = [];
      const free: Job = launch(limiter, "a", "free", order, { maxWaitMs: 0 });
      const noWait: Job = launch(limiter, "b", "no-wait", order, {
        maxWaitMs: 0,
      });
      await settle();
      expect(free.started).toBe(true);

      jest.advanceTimersByTime(0);
      expect(await refusal(noWait)).toBeInstanceOf(BusyError);
      free.finish();
      await free.result;
      expect(order).toEqual(["free"]);
    });
  });

  describe("a caller who leaves", () => {
    test("gives its place up at once, never runs, and frees its place for others", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 1,
        maxWaitingPerKey: 1,
      });
      const order: Array<string> = [];
      const running: Job = launch(limiter, "a", "running", order);
      const controller: AbortController = new AbortController();
      const abandoned: Job = launch(limiter, "a", "abandoned", order, {
        signal: controller.signal,
      });
      await settle();
      expect(limiter.waitingCount("a")).toBe(1);

      controller.abort();
      expect(await refusal(abandoned)).toBeInstanceOf(AbandonedError);
      expect(limiter.waitingCount("a")).toBe(0);

      // Its place is free again: the key's next caller queues, not refused.
      const next: Job = launch(limiter, "a", "next", order);
      await settle();
      expect(next.settled).toBe(false);
      expect(limiter.waitingCount("a")).toBe(1);

      await finishAll([running, next]);
      expect(order).toEqual(["running", "next"]);
      expect(abandoned.started).toBe(false);
      expect(limiter.runningCount()).toBe(0);
    });

    test("an already-abandoned caller takes no slot and never runs", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith();
      const controller: AbortController = new AbortController();
      controller.abort();
      const order: Array<string> = [];
      const job: Job = launch(limiter, "a", "gone", order, {
        signal: controller.signal,
      });
      expect(await refusal(job)).toBeInstanceOf(AbandonedError);
      expect(job.started).toBe(false);
      expect(limiter.runningCount()).toBe(0);
      expect(limiter.waitingCount()).toBe(0);
    });

    test("abandoned while its slot is being handed over: the slot goes back unused", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({ maxRunning: 1 });
      const order: Array<string> = [];
      const running: Job = launch(limiter, "a", "running", order);
      const controller: AbortController = new AbortController();
      const handedOver: Job = launch(limiter, "b", "handed-over", order, {
        signal: controller.signal,
      });
      const after: Job = launch(limiter, "c", "after", order);
      await settle();

      // The slot is granted synchronously; the abort lands before work runs.
      running.finish();
      controller.abort();
      expect(await refusal(handedOver)).toBeInstanceOf(AbandonedError);
      await settle();
      expect(handedOver.started).toBe(false);
      expect(after.started).toBe(true);
      after.finish();
      await after.result;
      expect(limiter.runningCount()).toBe(0);
    });

    test("work that already started is not interrupted by its caller leaving", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith();
      const controller: AbortController = new AbortController();
      const order: Array<string> = [];
      const job: Job = launch(limiter, "a", "started", order, {
        signal: controller.signal,
      });
      await settle();
      expect(job.started).toBe(true);
      controller.abort();
      job.finish();
      expect(await job.result).toBe("started");
      expect(limiter.runningCount()).toBe(0);
    });
  });

  describe("acquire", () => {
    test("holds the slot until it is released, and releasing twice gives back one slot", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 2,
        maxRunningPerKey: 2,
      });
      const first: KeyedConcurrencyRelease = await limiter.acquire("q");
      const second: KeyedConcurrencyRelease = await limiter.acquire("q");
      expect(limiter.runningCount("q")).toBe(2);

      const third: Promise<KeyedConcurrencyRelease> = limiter.acquire("q");
      let thirdGranted: boolean = false;
      void third.then((): void => {
        thirdGranted = true;
      });
      await settle();
      expect(thirdGranted).toBe(false);
      expect(limiter.waitingCount("q")).toBe(1);

      first();
      first();
      first();
      await settle();
      expect(thirdGranted).toBe(true);
      // One release made room for one waiter, not three.
      expect(limiter.runningCount("q")).toBe(2);

      second();
      (await third)();
      expect(limiter.runningCount()).toBe(0);
      expect(limiter.waitingCount()).toBe(0);
    });

    test("is refused as run() is: busy when the queue is full", async () => {
      const limiter: KeyedConcurrencyLimiter = limiterWith({
        maxRunning: 1,
        maxWaiting: 0,
      });
      const held: KeyedConcurrencyRelease = await limiter.acquire("q");
      await expect(limiter.acquire("q")).rejects.toBeInstanceOf(BusyError);
      held();
      (await limiter.acquire("q"))();
      expect(limiter.runningCount()).toBe(0);
    });
  });
});
