import TopologyConcurrencyLimiterInstance, {
  TOPOLOGY_BUSY_MESSAGE,
  TOPOLOGY_BUSY_RETRY_AFTER_SECONDS,
  TOPOLOGY_CONCURRENCY_LIMITS,
  TopologyConcurrencyLimiter,
  TopologyConcurrencyLimits,
} from "../../../../Server/Utils/Topology/TopologyConcurrencyLimiter";
import ExceptionCode from "../../../../Types/Exception/ExceptionCode";
import TooManyRequestsException from "../../../../Types/Exception/TooManyRequestsException";
import { describe, expect, test } from "@jest/globals";

/*
 * The Topology API's per-process limiter: how many reads run at once, per
 * process and per project; that waiters start in arrival order without a
 * project at its limit holding up another; that a full queue or a long wait
 * is a 429 without running anything; and that a slot is always given back,
 * however the work ends.
 */

const LIMITS: TopologyConcurrencyLimits = {
  maxRunning: 4,
  maxRunningPerProject: 2,
  maxWaiting: 64,
  maxWaitingPerProject: 16,
  maxWaitMs: 60_000,
};

interface Job {
  label: string;
  started: boolean;
  settled: boolean;
  result: Promise<string>;
  finish: () => void;
  fail: (error: Error) => void;
}

/* Lets queued promise callbacks (a slot handed over, work starting) run. */
async function settle(): Promise<void> {
  for (let round: number = 0; round < 3; round++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

/*
 * A unit of work under the limiter that runs until the test finishes or
 * fails it. `started` records whether the limiter let it run; `order` the
 * order in which jobs started.
 */
function launch(
  limiter: TopologyConcurrencyLimiter,
  projectId: string,
  label: string,
  order: Array<string>,
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
  job.result = limiter.run(projectId, (): Promise<string> => {
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
  });
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

describe("TopologyConcurrencyLimiter", () => {
  test("defaults: 4 at once per process, 2 per project, 64 waiting (16 per project), 30 s wait", () => {
    expect(TOPOLOGY_CONCURRENCY_LIMITS).toEqual({
      maxRunning: 4,
      maxRunningPerProject: 2,
      maxWaiting: 64,
      maxWaitingPerProject: 16,
      maxWaitMs: 30_000,
    });
    expect(TopologyConcurrencyLimiterInstance).toBeInstanceOf(
      TopologyConcurrencyLimiter,
    );
    expect(TOPOLOGY_BUSY_RETRY_AFTER_SECONDS).toBeGreaterThan(0);
  });

  test("runs the work and hands back its result, then frees the slot", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter(
      LIMITS,
    );
    expect(
      await limiter.run("p", async (): Promise<number> => {
        expect(limiter.runningCount()).toBe(1);
        expect(limiter.runningCount("p")).toBe(1);
        return 42;
      }),
    ).toBe(42);
    expect(limiter.runningCount()).toBe(0);
    expect(limiter.runningCount("p")).toBe(0);
  });

  test("never more than the process limit at once, and waiters start as slots free up", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter(
      LIMITS,
    );
    const order: Array<string> = [];
    const jobs: Array<Job> = ["a", "b", "c", "d", "e", "f"].map(
      (project: string): Job => {
        return launch(limiter, project, project, order);
      },
    );
    await settle();
    expect(order).toEqual(["a", "b", "c", "d"]);
    expect(limiter.runningCount()).toBe(4);
    expect(limiter.waitingCount()).toBe(2);

    jobs[1]!.finish();
    await settle();
    expect(order).toEqual(["a", "b", "c", "d", "e"]);
    expect(limiter.runningCount()).toBe(4);

    for (const job of jobs) {
      job.finish();
    }
    await settle();
    expect(order).toEqual(["a", "b", "c", "d", "e", "f"]);
    for (const job of jobs) {
      job.finish();
    }
    await Promise.all(
      jobs.map((job: Job): Promise<string> => {
        return job.result;
      }),
    );
    expect(limiter.runningCount()).toBe(0);
    expect(limiter.waitingCount()).toBe(0);
  });

  test("one project gets at most its share; another project is not held up behind it", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter(
      LIMITS,
    );
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

    for (const job of [...busy, quiet]) {
      job.finish();
    }
    await settle();
    for (const job of busy) {
      job.finish();
    }
    await Promise.all(
      [...busy, quiet].map((job: Job): Promise<string> => {
        return job.result;
      }),
    );
    expect(order).toEqual([
      "busy-1",
      "busy-2",
      "quiet-1",
      "busy-3",
      "busy-4",
      "busy-5",
    ]);
  });

  test("a freed slot goes to the first waiter that may use it, skipping projects at their limit", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter({
      ...LIMITS,
      maxRunning: 2,
      maxRunningPerProject: 1,
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

    for (const job of [a2, c1]) {
      job.finish();
    }
    await settle();
    a3.finish();
    await Promise.all(
      [a1, b1, a2, a3, b2, c1].map((job: Job): Promise<string> => {
        return job.result;
      }),
    );
    expect(order).toEqual(["a1", "b1", "b2", "a2", "c1", "a3"]);
  });

  test("a full queue is a 429 at once, and the refused work never runs", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter({
      ...LIMITS,
      maxRunning: 1,
      maxRunningPerProject: 1,
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
    expect(error).toBeInstanceOf(TooManyRequestsException);
    expect((error as TooManyRequestsException).code).toBe(
      ExceptionCode.TooManyRequestsException,
    );
    expect((error as Error).message).toBe(TOPOLOGY_BUSY_MESSAGE);
    expect(limiter.waitingCount()).toBe(2);

    running.finish();
    for (const job of waiting) {
      await settle();
      job.finish();
    }
    await Promise.all(
      [running, ...waiting].map((job: Job): Promise<string> => {
        return job.result;
      }),
    );
    expect(order).toEqual(["running", "waiting-1", "waiting-2"]);
    expect(refused.started).toBe(false);
  });

  test("one project cannot fill the queue: past its own share it is refused, others still queue", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter({
      ...LIMITS,
      maxRunning: 1,
      maxRunningPerProject: 1,
      maxWaiting: 10,
      maxWaitingPerProject: 2,
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
    expect(await refusal(refused)).toBeInstanceOf(TooManyRequestsException);
    expect(limiter.waitingCount("a")).toBe(2);
    expect(limiter.waitingCount("b")).toBe(1);

    for (const job of [...jobs, other]) {
      job.finish();
      await settle();
    }
    for (const job of [...jobs, other]) {
      job.finish();
    }
    await Promise.all(
      [...jobs, other].map((job: Job): Promise<string> => {
        return job.result;
      }),
    );
    expect(refused.started).toBe(false);
  });

  test("a slot is given back when the work fails or throws, and the next waiter runs", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter({
      ...LIMITS,
      maxRunning: 1,
    });
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

  test("a request that waits past the limit is a 429, leaves the queue and never runs", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter({
      ...LIMITS,
      maxRunning: 1,
      maxWaitMs: 25,
    });
    const order: Array<string> = [];
    const running: Job = launch(limiter, "a", "running", order);
    const waiting: Job = launch(limiter, "b", "waiting", order);
    await settle();
    expect(limiter.waitingCount()).toBe(1);

    const error: unknown = await refusal(waiting);
    expect(error).toBeInstanceOf(TooManyRequestsException);
    expect(limiter.waitingCount()).toBe(0);

    running.finish();
    await running.result;
    await settle();
    expect(waiting.started).toBe(false);
    expect(order).toEqual(["running"]);
    expect(limiter.runningCount()).toBe(0);
  });

  test("a waiter that gets its slot in time is not refused later", async () => {
    const limiter: TopologyConcurrencyLimiter = new TopologyConcurrencyLimiter({
      ...LIMITS,
      maxRunning: 1,
      maxWaitMs: 40,
    });
    const order: Array<string> = [];
    const running: Job = launch(limiter, "a", "running", order);
    const waiting: Job = launch(limiter, "b", "waiting", order);
    await settle();
    running.finish();
    await settle();
    expect(waiting.started).toBe(true);
    // Past the wait limit while running: the timer was cleared.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 60);
    });
    expect(waiting.settled).toBe(false);
    waiting.finish();
    expect(await waiting.result).toBe("waiting");
  });
});
