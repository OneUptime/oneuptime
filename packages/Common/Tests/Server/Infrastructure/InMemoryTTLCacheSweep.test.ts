import InMemoryTTLCache, {
  EXPIRED_ENTRY_SWEEP_INTERVAL_MS,
} from "../../../Server/Infrastructure/InMemoryTTLCache";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * InMemoryTTLCache used to drop an expired entry only when its own key was
 * read, or when the cache was full and it happened to be the oldest. An
 * entry nobody asks for again stayed in memory until enough newer entries
 * pushed it out: StatusPageOverviewCache keeps 500 status page overviews for
 * 15 seconds each, and every overview left behind by a new generation (a
 * key that is never read again) sat in the heap until 500 newer ones had
 * been built. Now a read or a write sweeps out every expired entry, at most
 * once per EXPIRED_ENTRY_SWEEP_INTERVAL_MS.
 *
 * What the tests hold it to:
 *   - expired entries leave memory without being read, on the next read or
 *     write once the interval has passed, and live entries never do;
 *   - the sweep runs at most once per interval;
 *   - a read returns exactly what master's cache returned, and more only
 *     where master had evicted a live entry to make room for one that
 *     could never be read again (a seeded differential run against
 *     ReferenceTTLCache, master's class verbatim, on the same operations);
 *   - the cache still never holds more than its capacity.
 */

interface ReferenceEntry<T> {
  value: T;
  expiresAt: number;
}

// Master's InMemoryTTLCache, verbatim.
class ReferenceTTLCache<T> {
  private store: Map<string, ReferenceEntry<T>> = new Map();
  private maxEntries: number;

  public constructor(maxEntries: number = 10_000) {
    this.maxEntries = maxEntries;
  }

  public set(key: string, value: T, ttlMs: number): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest: string | undefined = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  public get(key: string): T | undefined {
    const entry: ReferenceEntry<T> | undefined = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  public delete(key: string): void {
    this.store.delete(key);
  }

  public deleteByPrefix(prefix: string): void {
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}

let clockNow: number = 1_000_000;

function useClock(start: number): void {
  clockNow = start;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return clockNow;
  });
}

function advance(ms: number): void {
  clockNow += ms;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("expired entries leave memory without being read", () => {
  test("a write after the interval sweeps every expired entry and keeps every live one", () => {
    useClock(1_000_000);
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(500);

    for (let i: number = 0; i < 400; i++) {
      cache.set(`short-${i}`, `value-${i}`, 15_000);
    }
    for (let i: number = 0; i < 50; i++) {
      cache.set(`long-${i}`, `value-${i}`, 60 * 60_000);
    }

    expect(cache.size()).toBe(450);

    advance(15_001);
    cache.set("new", "fresh", 15_000);

    expect(cache.size()).toBe(51);
    for (let i: number = 0; i < 50; i++) {
      expect(cache.get(`long-${i}`)).toBe(`value-${i}`);
    }
    expect(cache.get("new")).toBe("fresh");
  });

  test("a read sweeps too, so a cache that is only read lets go of what expired", () => {
    useClock(5_000_000);
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(100);

    for (let i: number = 0; i < 60; i++) {
      cache.set(`page-${i}`, `overview-${i}`, 15_000);
    }

    advance(20_000);

    // A miss on a key that was never there still sweeps.
    expect(cache.get("someone-else")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  test("an entry exactly at its expiry is still live and is not swept", () => {
    useClock(0);
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(10);

    cache.set("a", "value-a", 2_000);
    advance(2_000);

    cache.set("b", "value-b", 2_000);
    expect(cache.size()).toBe(2);
    expect(cache.get("a")).toBe("value-a");

    advance(1);
    expect(cache.get("b")).toBe("value-b");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(1);
  });

  test("the sweep runs at most once per interval", () => {
    useClock(10_000);
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(100);

    // The first operation sweeps (an empty cache) and starts the interval.
    cache.set("a", "value-a", 100);
    cache.set("b", "value-b", 100);

    advance(EXPIRED_ENTRY_SWEEP_INTERVAL_MS - 1);

    // Both expired, but the interval has not passed: no sweep yet.
    cache.set("c", "value-c", 60_000);
    expect(cache.size()).toBe(3);

    advance(1);
    cache.set("d", "value-d", 60_000);
    expect(cache.size()).toBe(2);
    expect(cache.get("c")).toBe("value-c");
    expect(cache.get("d")).toBe("value-d");
  });

  test("a clock that moved backwards sweeps again without waiting for it to catch up", () => {
    useClock(100_000);
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(100);

    // Expires at 100,010 by the clock it was set by.
    cache.set("a", "value-a", 10);

    // The clock jumps back a minute; this write still sweeps.
    advance(-60_000);
    cache.set("x", "value-x", 10);

    /*
     * Two seconds later by the new clock: "x" expired and is swept. Had the
     * sweep waited for the clock to pass 100,000 + the interval again, "x"
     * would sit there for a minute.
     */
    advance(2_000);
    cache.set("y", "value-y", 60_000);

    expect(cache.size()).toBe(2);
    expect(cache.get("x")).toBeUndefined();
    expect(cache.get("a")).toBe("value-a");
    expect(cache.get("y")).toBe("value-y");
  });

  test("a full cache of expired entries takes a new one without evicting a live entry", () => {
    useClock(0);
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);

    cache.set("live", "kept", 60_000);
    cache.set("old-1", "x", 10);
    cache.set("old-2", "y", 10);

    advance(EXPIRED_ENTRY_SWEEP_INTERVAL_MS);
    cache.set("new", "z", 60_000);

    // Master's cache evicted "live" here, the oldest entry, to make room.
    expect(cache.get("live")).toBe("kept");
    expect(cache.get("new")).toBe("z");
    expect(cache.size()).toBe(2);
  });

  test("500 large overviews: memory holds only what is still live", () => {
    useClock(1_700_000_000_000);
    const cache: InMemoryTTLCache<Array<string>> = new InMemoryTTLCache<
      Array<string>
    >(500);
    const reference: ReferenceTTLCache<Array<string>> = new ReferenceTTLCache<
      Array<string>
    >(500);

    // Generations move on: each page's overview is built under a new key.
    for (let generation: number = 0; generation < 5; generation++) {
      for (let page: number = 0; page < 100; page++) {
        const overview: Array<string> = new Array<string>(100).fill(
          `monitor timeline ${page}`,
        );
        cache.set(`page-${page}|${generation}`, overview, 15_000);
        reference.set(`page-${page}|${generation}`, overview, 15_000);
      }
      advance(16_000);
    }

    // One more request a minute later.
    cache.set("page-0|5", ["x"], 15_000);
    reference.set("page-0|5", ["x"], 15_000);

    // Master kept 500 overviews nobody could read again; this keeps one.
    expect(reference.size()).toBe(500);
    expect(cache.size()).toBe(1);
  });
});

describe("reads return what master's cache returned", () => {
  type Operation =
    | { kind: "set"; key: string; value: number; ttl: number }
    | { kind: "get"; key: string }
    | { kind: "has"; key: string }
    | { kind: "delete"; key: string }
    | { kind: "deleteByPrefix"; prefix: string }
    | { kind: "clear" }
    | { kind: "advance"; ms: number };

  function drawOperation(random: SeededRandom, keys: number): Operation {
    const roll: number = random(100);
    const key: string = `k${random(keys)}`;

    if (roll < 35) {
      return {
        kind: "set",
        key: key,
        value: random(1_000_000),
        // Short, middling and long TTLs, so entries expire out of order.
        ttl: [5, 50, 500, 1_000, 5_000, 60_000][random(6)] as number,
      };
    }
    if (roll < 60) {
      return { kind: "get", key: key };
    }
    if (roll < 68) {
      return { kind: "has", key: key };
    }
    if (roll < 72) {
      return { kind: "delete", key: key };
    }
    if (roll < 74) {
      return { kind: "deleteByPrefix", prefix: `k${random(3)}` };
    }
    if (roll < 75) {
      return { kind: "clear" };
    }
    return {
      kind: "advance",
      ms: [0, 1, 10, 100, 500, 999, 1_000, 1_001, 3_000][random(9)] as number,
    };
  }

  interface Truth {
    value: number;
    expiresAt: number;
  }

  test("200 seeded runs of 2,000 operations each, capacities from 1 to 12", () => {
    let hitsMasterMissed: number = 0;
    let hitsBoth: number = 0;

    for (let run: number = 0; run < 200; run++) {
      const random: SeededRandom = seededRandom(31 + run);
      const capacity: number = 1 + random(12);
      const keys: number = 2 + random(30);

      useClock(1_000_000 + run);
      const cache: InMemoryTTLCache<number> = new InMemoryTTLCache<number>(
        capacity,
      );
      const reference: ReferenceTTLCache<number> =
        new ReferenceTTLCache<number>(capacity);
      // The latest value set under each key and when it expires.
      const truth: Map<string, Truth> = new Map<string, Truth>();

      for (let step: number = 0; step < 2000; step++) {
        const operation: Operation = drawOperation(random, keys);

        if (operation.kind === "set") {
          cache.set(operation.key, operation.value, operation.ttl);
          reference.set(operation.key, operation.value, operation.ttl);
          truth.set(operation.key, {
            value: operation.value,
            expiresAt: clockNow + operation.ttl,
          });
        } else if (operation.kind === "get" || operation.kind === "has") {
          const fromReference: number | undefined = reference.get(
            operation.key,
          );
          const fromCache: number | undefined =
            operation.kind === "get"
              ? cache.get(operation.key)
              : cache.has(operation.key)
                ? cache.get(operation.key)
                : undefined;

          if (fromReference !== undefined) {
            // Every hit master had is a hit here, with the same value.
            if (fromCache !== fromReference) {
              throw new Error(
                `run ${run} step ${step}: read ${String(fromCache)} where master read ${fromReference}`,
              );
            }
            hitsBoth++;
          } else if (fromCache !== undefined) {
            // A hit master lacked: the latest value set, still live.
            const latest: Truth | undefined = truth.get(operation.key);
            if (
              !latest ||
              fromCache !== latest.value ||
              clockNow > latest.expiresAt
            ) {
              throw new Error(
                `run ${run} step ${step}: read ${fromCache}, which is not the live value of ${operation.key}`,
              );
            }
            hitsMasterMissed++;
          }
        } else if (operation.kind === "delete") {
          cache.delete(operation.key);
          reference.delete(operation.key);
          truth.delete(operation.key);
        } else if (operation.kind === "deleteByPrefix") {
          cache.deleteByPrefix(operation.prefix);
          reference.deleteByPrefix(operation.prefix);
          for (const key of Array.from(truth.keys())) {
            if (key.startsWith(operation.prefix)) {
              truth.delete(key);
            }
          }
        } else if (operation.kind === "clear") {
          cache.clear();
          reference.clear();
          truth.clear();
        } else {
          advance(operation.ms);
        }

        if (cache.size() > capacity) {
          throw new Error(
            `run ${run} step ${step}: ${cache.size()} entries in a cache of ${capacity}`,
          );
        }
      }

      jest.restoreAllMocks();
    }

    // The runs exercised both kinds of hit.
    expect(hitsBoth).toBeGreaterThan(10000);
    expect(hitsMasterMissed).toBeGreaterThan(0);
  });

  test("with every TTL the same, the sweep changes no read at all", () => {
    for (let run: number = 0; run < 100; run++) {
      const random: SeededRandom = seededRandom(7000 + run);
      const capacity: number = 1 + random(8);

      useClock(50_000);
      const cache: InMemoryTTLCache<number> = new InMemoryTTLCache<number>(
        capacity,
      );
      const reference: ReferenceTTLCache<number> =
        new ReferenceTTLCache<number>(capacity);

      for (let step: number = 0; step < 1500; step++) {
        const key: string = `k${random(12)}`;
        const roll: number = random(10);

        if (roll < 4) {
          const value: number = random(1000);
          cache.set(key, value, 2_000);
          reference.set(key, value, 2_000);
        } else if (roll < 8) {
          const fromCache: number | undefined = cache.get(key);
          const fromReference: number | undefined = reference.get(key);
          if (fromCache !== fromReference) {
            throw new Error(
              `run ${run} step ${step}: read ${String(fromCache)} where master read ${String(fromReference)}`,
            );
          }
        } else {
          advance([1, 250, 999, 1_000, 1_999, 2_001][random(6)] as number);
        }
      }

      jest.restoreAllMocks();
    }
  });
});
