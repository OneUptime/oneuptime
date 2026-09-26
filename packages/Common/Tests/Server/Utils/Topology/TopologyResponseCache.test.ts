import TopologyResponseCacheInstance, {
  TOPOLOGY_RESPONSE_CACHE_MAX_BYTES,
  TOPOLOGY_RESPONSE_CACHE_TTL_MS,
  TopologyResponseCache,
  topologyResponseCacheKey,
} from "../../../../Server/Utils/Topology/TopologyResponseCache";
import { describe, expect, test } from "@jest/globals";

/*
 * The Topology maps' response cache: a short TTL, a byte budget rather than
 * an entry count (one infrastructure payload can be tens of megabytes), and
 * single flight so a burst of cold requests builds once. Failures are never
 * cached. A steerable clock keeps the TTL tests from sleeping.
 */

type Clock = { nowMs: number; now: () => number };

function makeClock(): Clock {
  const clock: Clock = {
    nowMs: 1_000_000,
    now: (): number => {
      return clock.nowMs;
    },
  };
  return clock;
}

interface Deferred {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve: (value: string) => void = (): void => {
    return undefined;
  };
  let reject: (error: Error) => void = (): void => {
    return undefined;
  };
  const promise: Promise<string> = new Promise<string>(
    (
      resolveFn: (value: string) => void,
      rejectFn: (error: Error) => void,
    ): void => {
      resolve = resolveFn;
      reject = rejectFn;
    },
  );
  return { promise, resolve, reject };
}

describe("TopologyResponseCache", () => {
  test("defaults: a minute, ~256 MB", () => {
    expect(TOPOLOGY_RESPONSE_CACHE_TTL_MS).toBe(60_000);
    expect(TOPOLOGY_RESPONSE_CACHE_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(TopologyResponseCacheInstance).toBeInstanceOf(TopologyResponseCache);
  });

  test("the key is (route, project, range start)", () => {
    const base: { route: string; projectId: string; rangeStart: Date } = {
      route: "/telemetry/topology/service-map",
      projectId: "p-1",
      rangeStart: new Date("2026-09-26T11:00:00.000Z"),
    };
    const key: string = topologyResponseCacheKey(base);
    expect(key).toBe(
      `/telemetry/topology/service-map|p-1|${Date.parse("2026-09-26T11:00:00.000Z")}`,
    );
    expect(topologyResponseCacheKey({ ...base, projectId: "p-2" })).not.toBe(
      key,
    );
    expect(
      topologyResponseCacheKey({
        ...base,
        route: "/telemetry/topology/infrastructure",
      }),
    ).not.toBe(key);
    expect(
      topologyResponseCacheKey({
        ...base,
        rangeStart: new Date("2026-09-26T11:01:00.000Z"),
      }),
    ).not.toBe(key);
  });

  test("a hit returns the cached string without building", async () => {
    const cache: TopologyResponseCache = new TopologyResponseCache();
    let builds: number = 0;
    const build: () => Promise<string> = async (): Promise<string> => {
      builds++;
      return `{"build":${builds}}`;
    };
    expect(await cache.getOrBuild("k", build)).toBe(`{"build":1}`);
    expect(await cache.getOrBuild("k", build)).toBe(`{"build":1}`);
    expect(builds).toBe(1);
  });

  test("entries expire after the TTL", async () => {
    const clock: Clock = makeClock();
    const cache: TopologyResponseCache = new TopologyResponseCache(
      60_000,
      1_000_000,
      clock.now,
    );
    cache.set("k", "v1");
    clock.nowMs += 60_000;
    expect(cache.get("k")).toBe("v1");
    clock.nowMs += 1;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0);
    expect(cache.byteSize()).toBe(0);
  });

  test("the byte budget evicts oldest first and skips a value larger than it", () => {
    const cache: TopologyResponseCache = new TopologyResponseCache(60_000, 40);
    cache.set("a", "0123456789"); // 20 bytes
    cache.set("b", "0123456789"); // 20 bytes, budget full
    cache.set("c", "01234"); // 10 bytes: evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("0123456789");
    expect(cache.get("c")).toBe("01234");
    expect(cache.byteSize()).toBe(30);

    cache.set("huge", "x".repeat(21)); // 42 bytes > budget: not kept
    expect(cache.get("huge")).toBeUndefined();
    expect(cache.byteSize()).toBe(30);

    // Replacing a key releases its old bytes.
    cache.set("b", "01");
    expect(cache.byteSize()).toBe(14);
  });

  test("expired entries are swept on write", () => {
    const clock: Clock = makeClock();
    const cache: TopologyResponseCache = new TopologyResponseCache(
      10,
      1_000,
      clock.now,
    );
    cache.set("old", "v");
    clock.nowMs += 11;
    cache.set("new", "v");
    expect(cache.size()).toBe(1);
  });

  test("concurrent cold requests share one build", async () => {
    const cache: TopologyResponseCache = new TopologyResponseCache();
    const pending: Deferred = deferred();
    let builds: number = 0;
    const build: () => Promise<string> = (): Promise<string> => {
      builds++;
      return pending.promise;
    };
    const first: Promise<string> = cache.getOrBuild("k", build);
    const second: Promise<string> = cache.getOrBuild("k", build);
    expect(cache.inFlightCount()).toBe(1);
    pending.resolve("payload");
    expect(await Promise.all([first, second])).toEqual(["payload", "payload"]);
    expect(builds).toBe(1);
    expect(cache.inFlightCount()).toBe(0);
    expect(cache.get("k")).toBe("payload");
  });

  test("a failed build is shared by its followers and never cached", async () => {
    const cache: TopologyResponseCache = new TopologyResponseCache();
    const pending: Deferred = deferred();
    const first: Promise<string> = cache.getOrBuild("k", () => {
      return pending.promise;
    });
    const second: Promise<string> = cache.getOrBuild("k", () => {
      return Promise.resolve("never");
    });
    pending.reject(new Error("statement timeout"));
    await expect(first).rejects.toThrow("statement timeout");
    await expect(second).rejects.toThrow("statement timeout");
    expect(cache.get("k")).toBeUndefined();
    expect(cache.inFlightCount()).toBe(0);

    // The next request starts over.
    expect(
      await cache.getOrBuild("k", async () => {
        return "fresh";
      }),
    ).toBe("fresh");
  });

  test("a build that throws synchronously still releases its key", async () => {
    const cache: TopologyResponseCache = new TopologyResponseCache();
    await expect(
      cache.getOrBuild("k", (): Promise<string> => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(cache.inFlightCount()).toBe(0);
  });

  test("different keys build independently", async () => {
    const cache: TopologyResponseCache = new TopologyResponseCache();
    const results: Array<string> = await Promise.all([
      cache.getOrBuild("a", async () => {
        return "A";
      }),
      cache.getOrBuild("b", async () => {
        return "B";
      }),
    ]);
    expect(results).toEqual(["A", "B"]);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.byteSize()).toBe(0);
  });

  describe("fresh (an explicit refresh)", () => {
    test("after a warm hit, rebuilds and replaces the entry for everyone", async () => {
      const cache: TopologyResponseCache = new TopologyResponseCache();
      let builds: number = 0;
      const build: () => Promise<string> = async (): Promise<string> => {
        builds++;
        return `{"build":${builds}}`;
      };
      expect(await cache.getOrBuild("k", build)).toBe(`{"build":1}`);
      expect(await cache.getOrBuild("k", build)).toBe(`{"build":1}`);

      expect(await cache.getOrBuild("k", build, { fresh: true })).toBe(
        `{"build":2}`,
      );
      expect(builds).toBe(2);
      // The refreshed copy is what the next ordinary request gets.
      expect(await cache.getOrBuild("k", build)).toBe(`{"build":2}`);
      expect(builds).toBe(2);
      expect(cache.size()).toBe(1);
      expect(cache.byteSize()).toBe(`{"build":2}`.length * 2);
    });

    test("joins a build already in flight instead of starting a second", async () => {
      const cache: TopologyResponseCache = new TopologyResponseCache();
      const pending: Deferred = deferred();
      let builds: number = 0;
      const build: () => Promise<string> = (): Promise<string> => {
        builds++;
        return pending.promise;
      };
      const cold: Promise<string> = cache.getOrBuild("k", build);
      const fresh: Promise<string> = cache.getOrBuild("k", build, {
        fresh: true,
      });
      expect(cache.inFlightCount()).toBe(1);
      pending.resolve("payload");
      expect(await Promise.all([cold, fresh])).toEqual(["payload", "payload"]);
      expect(builds).toBe(1);
    });

    test("ordinary requests during a refresh still get the cached copy, then the new one", async () => {
      const cache: TopologyResponseCache = new TopologyResponseCache();
      cache.set("k", "old");
      const pending: Deferred = deferred();
      const refresh: Promise<string> = cache.getOrBuild(
        "k",
        () => {
          return pending.promise;
        },
        { fresh: true },
      );
      expect(
        await cache.getOrBuild("k", async () => {
          return "unexpected";
        }),
      ).toBe("old");
      pending.resolve("new");
      expect(await refresh).toBe("new");
      expect(cache.get("k")).toBe("new");
    });

    test("a failed refresh is not cached and leaves the previous copy in place", async () => {
      const cache: TopologyResponseCache = new TopologyResponseCache();
      cache.set("k", "old");
      await expect(
        cache.getOrBuild(
          "k",
          async (): Promise<string> => {
            throw new Error("statement timeout");
          },
          { fresh: true },
        ),
      ).rejects.toThrow("statement timeout");
      expect(cache.get("k")).toBe("old");
      expect(cache.inFlightCount()).toBe(0);
    });

    test("fresh: false behaves like no option", async () => {
      const cache: TopologyResponseCache = new TopologyResponseCache();
      cache.set("k", "cached");
      expect(
        await cache.getOrBuild(
          "k",
          async () => {
            return "built";
          },
          { fresh: false },
        ),
      ).toBe("cached");
    });
  });
});
