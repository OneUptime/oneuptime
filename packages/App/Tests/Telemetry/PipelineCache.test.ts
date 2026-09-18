import PipelineCache from "../../FeatureSet/Telemetry/Utils/PipelineCache";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: Error) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

// A microtask turn lets the registered loader run without real timers or I/O.
async function startLoads(): Promise<void> {
  await Promise.resolve();
}

describe("pipeline cache shared loads", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("shares one load and one result across 10,000 simultaneous callers", async () => {
    const cache: PipelineCache<Array<string>> = new PipelineCache(10, 100);
    const source: Deferred<Array<string>> = deferred();
    const load: jest.Mock = jest.fn(() => {
      return source.promise;
    });
    const calls: Array<Promise<Array<string>>> = Array.from(
      { length: 10_000 },
      () => {
        return cache.getOrLoad("project", load);
      },
    );
    await startLoads();
    expect(load).toHaveBeenCalledTimes(1);
    const value: Array<string> = ["pipeline"];
    source.resolve(value);
    for (const result of await Promise.all(calls)) {
      expect(result).toBe(value);
    }
    expect(await cache.getOrLoad("project", load)).toBe(value);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test.each([[], false, 0, "", null])(
    "caches a valid empty result: %p",
    async (value: unknown) => {
      const cache: PipelineCache<unknown> = new PipelineCache(10, 100);
      const load: jest.Mock = jest.fn().mockResolvedValue(value);
      expect(await cache.getOrLoad("project", load)).toBe(value);
      expect(await cache.getOrLoad("project", load)).toBe(value);
      expect(load).toHaveBeenCalledTimes(1);
    },
  );

  test("loads different projects independently while a project is stalled", async () => {
    const cache: PipelineCache<string> = new PipelineCache(10, 100);
    const stalled: Deferred<string> = deferred();
    const first: Promise<string> = cache.getOrLoad("one", () => {
      return stalled.promise;
    });
    expect(
      await cache.getOrLoad("two", async () => {
        return "second";
      }),
    ).toBe("second");
    stalled.resolve("first");
    expect(await first).toBe("first");
  });

  test("all waiters observe failure and the next call can retry", async () => {
    const cache: PipelineCache<string> = new PipelineCache(10, 100);
    const source: Deferred<string> = deferred();
    const load: jest.Mock = jest.fn(() => {
      return source.promise;
    });
    const calls: Array<Promise<string>> = Array.from({ length: 1_000 }, () => {
      return cache.getOrLoad("project", load);
    });
    const settled: Promise<Array<PromiseSettledResult<string>>> =
      Promise.allSettled(calls);
    const error: Error = new Error("database unavailable");
    source.reject(error);
    for (const result of await settled) {
      expect(result).toEqual({ status: "rejected", reason: error });
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(
      await cache.getOrLoad("project", async () => {
        return "recovered";
      }),
    ).toBe("recovered");
  });

  test("synchronous loader failures are shared and do not poison retries", async () => {
    const cache: PipelineCache<string> = new PipelineCache(10, 100);
    const error: Error = new Error("constructor failure");
    const load: jest.Mock = jest.fn(() => {
      throw error;
    });
    const results: Array<PromiseSettledResult<string>> =
      await Promise.allSettled([
        cache.getOrLoad("project", load),
        cache.getOrLoad("project", load),
      ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: "rejected", reason: error },
      { status: "rejected", reason: error },
    ]);
    await expect(cache.getOrLoad("project", load)).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("TTL begins on completion and expired callers share one refresh", async () => {
    const now: jest.SpyInstance = jest.spyOn(Date, "now").mockReturnValue(0);
    const cache: PipelineCache<string> = new PipelineCache(10, 100);
    const source: Deferred<string> = deferred();
    const load: jest.Mock = jest.fn(() => {
      return source.promise;
    });
    const first: Promise<string> = cache.getOrLoad("project", load);
    now.mockReturnValue(500);
    source.resolve("old");
    await first;
    now.mockReturnValue(600);
    expect(await cache.getOrLoad("project", load)).toBe("old");
    expect(load).toHaveBeenCalledTimes(1);
    now.mockReturnValue(601);
    const refresh: jest.Mock = jest.fn().mockResolvedValue("new");
    expect(
      await Promise.all(
        Array.from({ length: 1_000 }, () => {
          return cache.getOrLoad("project", refresh);
        }),
      ),
    ).toEqual(Array(1_000).fill("new"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("failed refresh does not return stale values and can retry", async () => {
    const now: jest.SpyInstance = jest.spyOn(Date, "now").mockReturnValue(0);
    const cache: PipelineCache<string> = new PipelineCache(10, 100);
    await cache.getOrLoad("project", async () => {
      return "old";
    });
    now.mockReturnValue(101);
    await expect(
      cache.getOrLoad("project", async () => {
        throw new Error("refresh failed");
      }),
    ).rejects.toThrow("refresh failed");
    expect(
      await cache.getOrLoad("project", async () => {
        return "new";
      }),
    ).toBe("new");
  });

  test("a stalled load stops attracting callers after the sharing TTL", async () => {
    const now: jest.SpyInstance = jest.spyOn(Date, "now").mockReturnValue(0);
    const cache: PipelineCache<string> = new PipelineCache(1, 100);
    const old: Deferred<string> = deferred();
    const first: Promise<string> = cache.getOrLoad("project", () => {
      return old.promise;
    });
    now.mockReturnValue(101);
    const refresh: jest.Mock = jest.fn().mockResolvedValue("new");
    expect(await cache.getOrLoad("project", refresh)).toBe("new");
    old.resolve("old");
    expect(await first).toBe("old");
    // Late completion delivers to the old caller but cannot roll back the cache.
    expect(await cache.getOrLoad("project", refresh)).toBe("new");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test.each(["resolve", "reject"])(
    "superseded load %s does not remove a pending replacement",
    async (outcome: string) => {
      const now: jest.SpyInstance = jest.spyOn(Date, "now").mockReturnValue(0);
      const cache: PipelineCache<string> = new PipelineCache(1, 100);
      const old: Deferred<string> = deferred();
      const next: Deferred<string> = deferred();
      const first: Promise<string> = cache.getOrLoad("project", () => {
        return old.promise;
      });
      const firstResult: Promise<Array<PromiseSettledResult<string>>> =
        Promise.allSettled([first]);
      now.mockReturnValue(101);
      const refresh: jest.Mock = jest.fn(() => {
        return next.promise;
      });
      const replacement: Promise<string> = cache.getOrLoad("project", refresh);
      if (outcome === "resolve") {
        old.resolve("old");
      } else {
        old.reject(new Error("old failed"));
      }
      await firstResult;
      const latest: Promise<string> = cache.getOrLoad("project", refresh);
      next.resolve("new");
      expect(await Promise.all([replacement, latest])).toEqual(["new", "new"]);
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  test("a backward clock jump cannot extend sharing of stalled work", async () => {
    const now: jest.SpyInstance = jest.spyOn(Date, "now").mockReturnValue(100);
    const cache: PipelineCache<string> = new PipelineCache(1, 100);
    const source: Deferred<string> = deferred();
    const old: Promise<string> = cache.getOrLoad("project", () => {
      return source.promise;
    });
    now.mockReturnValue(50);
    expect(
      await cache.getOrLoad("project", async () => {
        return "new";
      }),
    ).toBe("new");
    source.resolve("old");
    expect(await old).toBe("old");
  });

  test("evicts completed entries at capacity", async () => {
    const cache: PipelineCache<string> = new PipelineCache(2, 100);
    const load: jest.Mock = jest.fn().mockResolvedValue("value");
    await cache.getOrLoad("one", load);
    await cache.getOrLoad("two", load);
    await cache.getOrLoad("three", load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.getOrLoad("two", load);
    await cache.getOrLoad("three", load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.getOrLoad("one", load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  test("bounds pending entries, allows overflow, and recovers slots after rejection", async () => {
    const cache: PipelineCache<string> = new PipelineCache(1, 100);
    const source: Deferred<string> = deferred();
    const held: Promise<string> = cache.getOrLoad("held", () => {
      return source.promise;
    });
    const rejected: Promise<Array<PromiseSettledResult<string>>> =
      Promise.allSettled([held]);
    const overflow: jest.Mock = jest.fn().mockResolvedValue("overflow");
    expect(
      await Promise.all([
        cache.getOrLoad("overflow", overflow),
        cache.getOrLoad("overflow", overflow),
      ]),
    ).toEqual(["overflow", "overflow"]);
    expect(overflow).toHaveBeenCalledTimes(2);
    // Overflow loads have no ownership slot, so they do not populate the cache.
    await cache.getOrLoad("overflow", overflow);
    expect(overflow).toHaveBeenCalledTimes(3);
    source.reject(new Error("failed"));
    await rejected;
    const next: jest.Mock = jest.fn().mockResolvedValue("next");
    await Promise.all([
      cache.getOrLoad("next", next),
      cache.getOrLoad("next", next),
    ]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("an old overflow load cannot overwrite a later tracked result", async () => {
    const cache: PipelineCache<string> = new PipelineCache(1, 100);
    const held: Deferred<string> = deferred();
    const old: Deferred<string> = deferred();
    const heldCall: Promise<string> = cache.getOrLoad("held", () => {
      return held.promise;
    });
    const overflow: Promise<string> = cache.getOrLoad("project", () => {
      return old.promise;
    });
    held.resolve("held");
    await heldCall;
    const refresh: jest.Mock = jest.fn().mockResolvedValue("new");
    expect(await cache.getOrLoad("project", refresh)).toBe("new");
    old.resolve("old");
    expect(await overflow).toBe("old");
    expect(await cache.getOrLoad("project", refresh)).toBe("new");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test.each([101, -1])(
    "an abandoned project releases ownership capacity when the clock reaches %i",
    async (time: number) => {
      const now: jest.SpyInstance = jest.spyOn(Date, "now").mockReturnValue(0);
      const cache: PipelineCache<string> = new PipelineCache(1, 100);
      const abandoned: Deferred<string> = deferred();
      const old: Promise<string> = cache.getOrLoad("abandoned", () => {
        return abandoned.promise;
      });
      now.mockReturnValue(time);
      const load: jest.Mock = jest.fn().mockResolvedValue("active");
      expect(
        await Promise.all([
          cache.getOrLoad("active", load),
          cache.getOrLoad("active", load),
        ]),
      ).toEqual(["active", "active"]);
      expect(await cache.getOrLoad("active", load)).toBe("active");
      expect(load).toHaveBeenCalledTimes(1);
      abandoned.resolve("old");
      expect(await old).toBe("old");
      expect(await cache.getOrLoad("active", load)).toBe("active");
      expect(load).toHaveBeenCalledTimes(1);
    },
  );

  test("completion releases pending slots across repeated unique project bursts", async () => {
    const cache: PipelineCache<number> = new PipelineCache(2, 100);
    const load: jest.Mock = jest.fn().mockResolvedValue(1);
    for (let round: number = 0; round < 100; round++) {
      await Promise.all(
        Array.from({ length: 20 }, () => {
          return cache.getOrLoad(`project-${round}`, load);
        }),
      );
    }
    expect(load).toHaveBeenCalledTimes(100);
  });

  test("instances keep signal-specific results isolated even for identical project IDs", async () => {
    const logs: PipelineCache<string> = new PipelineCache(10, 100);
    const traces: PipelineCache<string> = new PipelineCache(10, 100);
    const result: Array<string> = await Promise.all([
      logs.getOrLoad("project", async () => {
        return "logs";
      }),
      traces.getOrLoad("project", async () => {
        return "traces";
      }),
    ]);
    expect(result).toEqual(["logs", "traces"]);
  });
});
