import ConcurrencyLimiter from "../../../../Utils/Monitors/SyntheticRuntime/ConcurrencyLimiter";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: Error) => void;
}

interface ManualTimer {
  readonly callback: () => void;
  readonly delayInMs: number;
  cleared: boolean;
}

interface ManualTimerController {
  readonly fireByDelay: (delayInMs: number) => void;
  readonly activeTimerCount: () => number;
}

function installManualTimers(): ManualTimerController {
  const timers: ManualTimer[] = [];
  jest.spyOn(global, "setTimeout").mockImplementation(((
    callback: () => void,
    delayInMs?: number,
  ): NodeJS.Timeout => {
    const timer: ManualTimer = {
      callback,
      delayInMs: delayInMs || 0,
      cleared: false,
    };
    timers.push(timer);
    return timer as unknown as NodeJS.Timeout;
  }) as typeof global.setTimeout);
  jest.spyOn(global, "clearTimeout").mockImplementation(((
    handle: NodeJS.Timeout | undefined,
  ): void => {
    if (handle) {
      (handle as unknown as ManualTimer).cleared = true;
    }
  }) as typeof global.clearTimeout);

  return {
    fireByDelay: (delayInMs: number): void => {
      const timer: ManualTimer | undefined = timers.find(
        (candidate: ManualTimer) => {
          return !candidate.cleared && candidate.delayInMs === delayInMs;
        },
      );
      if (!timer) {
        throw new Error(`No active ${delayInMs}ms timer was scheduled.`);
      }
      timer.cleared = true;
      timer.callback();
    },
    activeTimerCount: (): number => {
      return timers.filter((timer: ManualTimer) => {
        return !timer.cleared;
      }).length;
    },
  };
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve: (value: Value) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<Value> = new Promise<Value>(
    (
      promiseResolve: (value: Value) => void,
      promiseReject: (error: Error) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    global.setImmediate(resolve);
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index: number = 0; index < 6; index++) {
    await Promise.resolve();
  }
}

describe("SyntheticRuntime ConcurrencyLimiter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runs no more than the configured number of operations", async () => {
    const limiter: ConcurrencyLimiter = new ConcurrencyLimiter(2);
    const first: Deferred<string> = createDeferred<string>();
    const second: Deferred<string> = createDeferred<string>();
    const third: Deferred<string> = createDeferred<string>();
    const starts: number[] = [];

    const firstRun: Promise<string> = limiter.run(async (): Promise<string> => {
      starts.push(1);
      return first.promise;
    });
    const secondRun: Promise<string> = limiter.run(
      async (): Promise<string> => {
        starts.push(2);
        return second.promise;
      },
    );
    const thirdRun: Promise<string> = limiter.run(async (): Promise<string> => {
      starts.push(3);
      return third.promise;
    });

    await flushPromises();
    expect(starts).toEqual([1, 2]);
    expect(limiter.activeCount).toBe(2);
    expect(limiter.pendingCount).toBe(1);

    first.resolve("first");
    await flushPromises();
    expect(starts).toEqual([1, 2, 3]);
    expect(limiter.activeCount).toBe(2);
    expect(limiter.pendingCount).toBe(0);

    second.resolve("second");
    third.resolve("third");

    await expect(Promise.all([firstRun, secondRun, thirdRun])).resolves.toEqual(
      ["first", "second", "third"],
    );
    expect(limiter.activeCount).toBe(0);
  });

  test("releases a slot when an operation rejects", async () => {
    const limiter: ConcurrencyLimiter = new ConcurrencyLimiter(1);
    const first: Deferred<string> = createDeferred<string>();
    let secondStarted: boolean = false;

    const firstRun: Promise<string> = limiter.run(async (): Promise<string> => {
      return first.promise;
    });
    const secondRun: Promise<string> = limiter.run(
      async (): Promise<string> => {
        secondStarted = true;
        return "second";
      },
    );

    await flushPromises();
    expect(secondStarted).toBe(false);

    first.reject(new Error("first failed"));
    await expect(firstRun).rejects.toThrow("first failed");
    await expect(secondRun).resolves.toBe("second");
    expect(secondStarted).toBe(true);
    expect(limiter.activeCount).toBe(0);
  });

  test("uses a bounded pending queue by default", async () => {
    const limiter: ConcurrencyLimiter = new ConcurrencyLimiter(1);
    const first: Deferred<string> = createDeferred<string>();
    const firstRun: Promise<string> = limiter.run(async (): Promise<string> => {
      return first.promise;
    });
    const queuedRuns: Array<Promise<number>> = [1, 2, 3, 4].map(
      (value: number) => {
        return limiter.run(async (): Promise<number> => {
          return value;
        });
      },
    );

    await flushPromises();
    expect(limiter.pendingLimit).toBe(4);
    expect(limiter.pendingCount).toBe(4);
    await expect(
      limiter.run(async (): Promise<number> => {
        return 5;
      }),
    ).rejects.toThrow("execution queue is full");

    first.resolve("first");
    await expect(firstRun).resolves.toBe("first");
    await expect(Promise.all(queuedRuns)).resolves.toEqual([1, 2, 3, 4]);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);
  });

  test("honors an explicit zero-length pending queue", async () => {
    const limiter: ConcurrencyLimiter = new ConcurrencyLimiter(1, 0);
    const first: Deferred<void> = createDeferred<void>();
    const firstRun: Promise<void> = limiter.run(async (): Promise<void> => {
      return first.promise;
    });

    await flushPromises();
    await expect(
      limiter.run(async (): Promise<void> => {
        return;
      }),
    ).rejects.toThrow("execution queue is full");
    expect(limiter.pendingCount).toBe(0);

    first.resolve();
    await firstRun;
  });

  test("removes an acquisition when its queue deadline expires", async () => {
    const timers: ManualTimerController = installManualTimers();
    const limiter: ConcurrencyLimiter = new ConcurrencyLimiter(1, 1);
    const first: Deferred<void> = createDeferred<void>();
    let queuedOperationStarted: boolean = false;
    const firstRun: Promise<void> = limiter.run(async (): Promise<void> => {
      return first.promise;
    });
    const queuedRun: Promise<void> = limiter.run(async (): Promise<void> => {
      queuedOperationStarted = true;
    }, 25);
    const queuedExpectation: Promise<void> = expect(queuedRun).rejects.toThrow(
      "timed out waiting for an execution slot",
    );

    await flushMicrotasks();
    expect(limiter.pendingCount).toBe(1);
    timers.fireByDelay(25);
    await queuedExpectation;
    expect(queuedOperationStarted).toBe(false);
    expect(limiter.pendingCount).toBe(0);

    first.resolve();
    await firstRun;
    expect(limiter.activeCount).toBe(0);
  });

  test("cancels a queue timer when the slot is granted", async () => {
    const timers: ManualTimerController = installManualTimers();
    const limiter: ConcurrencyLimiter = new ConcurrencyLimiter(1, 1);
    const first: Deferred<void> = createDeferred<void>();
    const firstRun: Promise<void> = limiter.run(async (): Promise<void> => {
      return first.promise;
    });
    const queuedRun: Promise<string> = limiter.run(
      async (): Promise<string> => {
        return "queued";
      },
      25,
    );

    await flushMicrotasks();
    first.resolve();
    await firstRun;
    await expect(queuedRun).resolves.toBe("queued");
    expect(timers.activeTimerCount()).toBe(0);
    expect(limiter.activeCount).toBe(0);
  });

  test("hands a released slot to the next live waiter", async () => {
    const timers: ManualTimerController = installManualTimers();
    const limiter: ConcurrencyLimiter = new ConcurrencyLimiter(1, 2);
    const first: Deferred<void> = createDeferred<void>();
    const starts: string[] = [];
    const firstRun: Promise<void> = limiter.run(async (): Promise<void> => {
      return first.promise;
    });
    const expiredRun: Promise<void> = limiter.run(async (): Promise<void> => {
      starts.push("expired");
    }, 10);
    const liveRun: Promise<void> = limiter.run(async (): Promise<void> => {
      starts.push("live");
    });
    const expiredExpectation: Promise<void> = expect(
      expiredRun,
    ).rejects.toThrow("timed out waiting for an execution slot");

    await flushMicrotasks();
    timers.fireByDelay(10);
    await expiredExpectation;
    expect(limiter.pendingCount).toBe(1);

    first.resolve();
    await firstRun;
    await liveRun;
    expect(starts).toEqual(["live"]);
    expect(limiter.activeCount).toBe(0);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid queue timeout %s even when a slot is free",
    async (timeoutInMs: number) => {
      const limiter: ConcurrencyLimiter = new ConcurrencyLimiter(1);
      await expect(
        limiter.run(async (): Promise<void> => {
          return;
        }, timeoutInMs),
      ).rejects.toThrow("queue timeout must be a positive integer");
      expect(limiter.activeCount).toBe(0);
    },
  );

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid pending limit %s",
    (pendingLimit: number) => {
      expect(() => {
        return new ConcurrencyLimiter(1, pendingLimit);
      }).toThrow("pending limit must be a non-negative integer");
    },
  );

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid limit %s",
    (limit: number) => {
      expect(() => {
        return new ConcurrencyLimiter(limit);
      }).toThrow("positive integer");
    },
  );
});
