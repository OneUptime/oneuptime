import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ProbePendingCount, {
  LAST_PENDING_COUNT_KEPT_FOR_SECONDS,
  PENDING_COUNT_ANSWER_WITHIN_MS,
} from "../../../../Server/Utils/Probe/ProbePendingCount";
import {
  ProbeSchedulingBusyError,
  ProbeSchedulingLimiter,
  probeSchedulingLimits,
} from "../../../../Server/Utils/Probe/ProbeSchedulingLimiter";
import { KeyedConcurrencyRelease } from "../../../../Server/Utils/KeyedConcurrencyLimiter";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * The pending count a probe's autoscaler reads (#7920). KEDA gives up on a
 * read after 3 seconds and, after three failed reads, falls back to one
 * replica; a 0 scales the probe down. So while the server is too busy to
 * count in time, a read is answered with the last count kept for the probe
 * - never a made-up 0 - and a count that runs late still finishes and is
 * kept. With no last count, a read waits for its own count.
 */

jest.mock("../../../../Server/Utils/Logger");

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: jest.fn(),
      setString: jest.fn(),
    },
  };
});

const cache: { getString: jest.Mock; setString: jest.Mock } =
  GlobalCache as unknown as { getString: jest.Mock; setString: jest.Mock };

const PROBE_ID: string = "6597e3fc3b1c4c0b94e1d0e1";

// Lets queued promise callbacks run without moving Jest's fake clock.
async function settle(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await new Promise<void>((resolve: () => void): void => {
      process.nextTick(resolve);
    });
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {
    return undefined;
  };
  let reject: (error: Error) => void = (): void => {
    return undefined;
  };
  const promise: Promise<T> = new Promise<T>(
    (yes: (value: T) => void, no: (error: Error) => void): void => {
      resolve = yes;
      reject = no;
    },
  );
  return { promise, resolve, reject };
}

function lastCountIs(value: string | null): void {
  cache.getString.mockImplementation(async (): Promise<string | null> => {
    return value;
  });
}

describe("ProbePendingCount", () => {
  let limiter: ProbeSchedulingLimiter;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    limiter = new ProbeSchedulingLimiter(probeSchedulingLimits(2));
    cache.getString.mockReset();
    cache.setString.mockReset();
    cache.setString.mockImplementation(async (): Promise<void> => {
      return undefined;
    });
    lastCountIs(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("answers the fresh count when it comes in time, and keeps it for busy reads", async () => {
    lastCountIs("7");

    expect(
      await ProbePendingCount.get(
        PROBE_ID,
        async (): Promise<number> => {
          return 42;
        },
        limiter,
      ),
    ).toBe(42);

    expect(cache.getString).toHaveBeenCalledWith(
      "probe-pending-count",
      PROBE_ID,
    );
    expect(cache.setString).toHaveBeenCalledWith(
      "probe-pending-count",
      PROBE_ID,
      "42",
      { expiresInSeconds: LAST_PENDING_COUNT_KEPT_FOR_SECONDS },
    );
    expect(LAST_PENDING_COUNT_KEPT_FOR_SECONDS).toBe(15 * 60);
  });

  test("a count slower than the answer time: the last count is answered then, and the late count is kept when it finishes", async () => {
    lastCountIs("7");
    const count: Deferred<number> = deferred<number>();

    let answered: number | null = null;
    void ProbePendingCount.get(
      PROBE_ID,
      (): Promise<number> => {
        return count.promise;
      },
      limiter,
    ).then((value: number): void => {
      answered = value;
    });
    await settle();

    jest.advanceTimersByTime(PENDING_COUNT_ANSWER_WITHIN_MS - 1);
    await settle();
    expect(answered).toBeNull();

    jest.advanceTimersByTime(1);
    await settle();
    expect(answered).toBe(7);
    // Well inside KEDA's 3 s.
    expect(PENDING_COUNT_ANSWER_WITHIN_MS).toBeLessThan(3000);

    // The count still runs, holding its slot, and is kept when it finishes.
    expect(limiter.runningCount()).toBe(1);
    count.resolve(55);
    await settle();
    expect(cache.setString).toHaveBeenCalledWith(
      "probe-pending-count",
      PROBE_ID,
      "55",
      { expiresInSeconds: LAST_PENDING_COUNT_KEPT_FOR_SECONDS },
    );
    expect(limiter.runningCount()).toBe(0);
  });

  test("refused by the probe scheduling limit with a last count: the last count, at once, and nothing is counted", async () => {
    lastCountIs("12");
    const busy: ProbeSchedulingLimiter = new ProbeSchedulingLimiter({
      ...probeSchedulingLimits(1),
      maxWaiting: 0,
    });
    const held: KeyedConcurrencyRelease = await busy.acquire("another-probe");
    const count: Mock<() => Promise<number>> = jest.fn(
      async (): Promise<number> => {
        return 99;
      },
    );

    expect(await ProbePendingCount.get(PROBE_ID, count, busy)).toBe(12);
    expect(count).not.toHaveBeenCalled();
    expect(cache.setString).not.toHaveBeenCalled();
    held();
  });

  test("with a last count, a read never waits for a slot longer than the answer time", async () => {
    lastCountIs("3");
    const full: ProbeSchedulingLimiter = new ProbeSchedulingLimiter(
      probeSchedulingLimits(1),
    );
    const held: KeyedConcurrencyRelease = await full.acquire("another-probe");
    const count: Mock<() => Promise<number>> = jest.fn(
      async (): Promise<number> => {
        return 99;
      },
    );

    let answered: number | null = null;
    void ProbePendingCount.get(PROBE_ID, count, full).then(
      (value: number): void => {
        answered = value;
      },
    );
    await settle();
    expect(full.waitingCount(`${PROBE_ID}:pending-count`)).toBe(1);

    jest.advanceTimersByTime(PENDING_COUNT_ANSWER_WITHIN_MS);
    await settle();
    expect(answered).toBe(3);
    // It gave its place up: a slot freed later does not run a count nobody waits for.
    expect(full.waitingCount()).toBe(0);
    held();
    await settle();
    expect(count).not.toHaveBeenCalled();
  });

  test("a count that fails, with a last count: the last count", async () => {
    lastCountIs("9");

    expect(
      await ProbePendingCount.get(
        PROBE_ID,
        async (): Promise<number> => {
          throw new Error("canceling statement due to statement timeout");
        },
        limiter,
      ),
    ).toBe(9);
  });

  test("a last count of 0 is answered as it was kept: a real count, not a made-up one", async () => {
    lastCountIs("0");
    const busy: ProbeSchedulingLimiter = new ProbeSchedulingLimiter({
      ...probeSchedulingLimits(1),
      maxWaiting: 0,
    });
    const held: KeyedConcurrencyRelease = await busy.acquire("another-probe");

    expect(
      await ProbePendingCount.get(
        PROBE_ID,
        async (): Promise<number> => {
          return 5;
        },
        busy,
      ),
    ).toBe(0);
    held();
  });

  describe("with no last count", () => {
    test("a read waits for its own count, however long it takes, and keeps it", async () => {
      const count: Deferred<number> = deferred<number>();
      let answered: number | null = null;
      void ProbePendingCount.get(
        PROBE_ID,
        (): Promise<number> => {
          return count.promise;
        },
        limiter,
      ).then((value: number): void => {
        answered = value;
      });
      await settle();

      jest.advanceTimersByTime(PENDING_COUNT_ANSWER_WITHIN_MS * 5);
      await settle();
      expect(answered).toBeNull();

      count.resolve(31);
      await settle();
      expect(answered).toBe(31);
      expect(cache.setString).toHaveBeenCalledWith(
        "probe-pending-count",
        PROBE_ID,
        "31",
        { expiresInSeconds: LAST_PENDING_COUNT_KEPT_FOR_SECONDS },
      );
    });

    test("refused by the limit: the busy error, never a 0", async () => {
      const busy: ProbeSchedulingLimiter = new ProbeSchedulingLimiter({
        ...probeSchedulingLimits(1),
        maxWaiting: 0,
      });
      const held: KeyedConcurrencyRelease = await busy.acquire("another-probe");

      await expect(
        ProbePendingCount.get(
          PROBE_ID,
          async (): Promise<number> => {
            return 0;
          },
          busy,
        ),
      ).rejects.toBeInstanceOf(ProbeSchedulingBusyError);
      held();
    });

    test("a count that fails fails the read", async () => {
      await expect(
        ProbePendingCount.get(
          PROBE_ID,
          async (): Promise<number> => {
            throw new Error("connection terminated");
          },
          limiter,
        ),
      ).rejects.toThrow("connection terminated");
    });

    test("an unreachable cache reads as no last count, and a failed keep does not fail the read", async () => {
      cache.getString.mockImplementation(async (): Promise<string | null> => {
        throw new Error("Cache is not connected");
      });
      cache.setString.mockImplementation(async (): Promise<void> => {
        throw new Error("Cache is not connected");
      });

      expect(
        await ProbePendingCount.get(
          PROBE_ID,
          async (): Promise<number> => {
            return 4;
          },
          limiter,
        ),
      ).toBe(4);
    });

    test("a kept value that is not a count reads as none", async () => {
      for (const value of ["", "-1", "1.5", "lots"]) {
        lastCountIs(value);
        expect(await ProbePendingCount.readLast(PROBE_ID)).toBeNull();
      }
      lastCountIs("17");
      expect(await ProbePendingCount.readLast(PROBE_ID)).toBe(17);
    });
  });

  test("a probe's count takes its own place in the limit, apart from its list requests", async () => {
    const counted: Array<string | undefined> = [];
    // eslint-disable-next-line @typescript-eslint/typedef
    const spy = jest.spyOn(limiter, "run");

    await ProbePendingCount.get(
      PROBE_ID,
      async (): Promise<number> => {
        counted.push("counted");
        return 1;
      },
      limiter,
    );

    expect(spy.mock.calls[0]![0]).toBe(`${PROBE_ID}:pending-count`);
    expect(counted).toEqual(["counted"]);
  });
});
