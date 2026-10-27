/// <reference lib="es2021.weakref" />
import InMemoryTTLCache, {
  EXPIRED_ENTRY_SWEEP_INTERVAL_MS,
} from "../../../Server/Infrastructure/InMemoryTTLCache";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import v8 from "v8";
import vm from "vm";

/*
 * WHAT A CACHE LETS GO OF, AND THAT IT STILL EVICTS WHAT IT ALWAYS DID.
 *
 * A full InMemoryTTLCache finds its oldest entry through one Map iterator it
 * keeps between writes (Utils/OldestKeyCursor). V8 rebuilds a Map's table as
 * entries come and go, and an iterator keeps the table it was made on alive,
 * with every entry in it, chained to each table after it, until it next
 * moves. The cursor moves only when a full cache evicts, so kept across
 * other changes it held on to everything the cache stored meanwhile: a cache
 * that filled once and then churned below its limit kept 1,323 values it had
 * deleted for 100 it held, and after a million writes of half-kilobyte
 * values, about 300 MB. So every change but an eviction lets the cursor go.
 *
 * The tests force a full garbage collection and read WeakRefs to the values
 * written: a value the cache deleted, replaced, swept or evicted must be
 * collected, and only the values it holds stay. Then a seeded differential
 * run holds the cache to evicting exactly what it did with keys().next(),
 * through every kind of change, expiry and sweep included.
 */

interface Payload {
  round: number;
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A full garbage collection, from inside a test. V8 exposes gc() under a
 * flag, and a context made after the flag is set has it; the flag adds that
 * function and changes nothing else in the worker.
 */
function garbageCollector(): () => void {
  v8.setFlagsFromString("--expose-gc");
  return vm.runInNewContext("gc") as () => void;
}

/*
 * Collects garbage, after the current job has ended: a WeakRef made or read
 * in the job that is running keeps its value alive until the job ends.
 */
async function collectGarbage(): Promise<void> {
  const gc: () => void = garbageCollector();

  for (let pass: number = 0; pass < 2; pass++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
    gc();
  }
}

/*
 * Writes one value a round, each made here and handed to `write`, and
 * returns a WeakRef to each by its round. The values are made in this
 * synchronous function rather than in the async test: a suspended async
 * function keeps its registers, and with them the last value it made, which
 * would read as one the cache kept.
 */
function writeRounds(
  rounds: number,
  write: (round: number, value: Payload) => void,
): Map<number, WeakRef<Payload>> {
  const refs: Map<number, WeakRef<Payload>> = new Map();

  for (let round: number = 0; round < rounds; round++) {
    const value: Payload = { round: round };

    refs.set(round, new WeakRef<Payload>(value));
    write(round, value);
  }

  return refs;
}

// The rounds whose values are still in memory.
function roundsAlive(refs: Map<number, WeakRef<Payload>>): Array<number> {
  const alive: Array<number> = [];

  for (const [round, ref] of refs) {
    if (ref.deref() !== undefined) {
      alive.push(round);
    }
  }

  return alive;
}

describe("a cache lets go of what it no longer holds", () => {
  test("the collector this suite forces works: a value nothing refers to is collected, one still referred to is not", async () => {
    const kept: Array<Payload> = [];
    const refs: Map<number, WeakRef<Payload>> = writeRounds(
      2,
      (round: number, value: Payload): void => {
        if (round === 1) {
          kept.push(value);
        }
      },
    );

    await collectGarbage();

    expect(roundsAlive(refs)).toEqual([1]);
    expect(kept[0]!.round).toBe(1);
  });

  test("after it was full once, a cache that churns below its limit keeps none of the values it deleted", async () => {
    const cache: InMemoryTTLCache<Payload> = new InMemoryTTLCache<Payload>(
      1000,
    );

    // Full, and one write past it: an eviction, so the cursor is made.
    for (let index: number = 0; index <= 1000; index++) {
      cache.set(`filled-${index}`, { round: -1 }, 60_000);
    }
    expect(cache.size()).toBe(1000);
    for (let index: number = 1; index <= 500; index++) {
      cache.delete(`filled-${index}`);
    }

    // Below the limit from here on: a write and a delete each round.
    const refs: Map<number, WeakRef<Payload>> = writeRounds(
      20000,
      (round: number, value: Payload): void => {
        cache.set(`churn-${round}`, value, 60_000);
        cache.delete(`churn-${round - 100}`);
      },
    );

    expect(cache.size()).toBe(600);

    await collectGarbage();

    // Only the last hundred are still in the cache.
    const alive: Array<number> = roundsAlive(refs);
    expect(
      alive.filter((round: number): boolean => {
        return round < 19900;
      }),
    ).toEqual([]);
    expect(alive).toHaveLength(100);
  });

  test("a full cache whose writes replace its own keys keeps none of the values it replaced", async () => {
    const cache: InMemoryTTLCache<Payload> = new InMemoryTTLCache<Payload>(
      1000,
    );

    for (let index: number = 0; index < 1000; index++) {
      cache.set(`key-${index}`, { round: -1 }, 60_000);
    }
    // One past the limit: it evicts key-0, its oldest, and holds 1,000.
    cache.set("one-more", { round: -1 }, 60_000);
    expect(cache.size()).toBe(1000);
    expect(cache.has("key-0")).toBe(false);

    // Hot keys it holds, written again and again: no write evicts.
    const refs: Map<number, WeakRef<Payload>> = writeRounds(
      20000,
      (round: number, value: Payload): void => {
        cache.set(`key-${1 + (round % 999)}`, value, 60_000);
      },
    );

    expect(cache.size()).toBe(1000);
    expect(cache.has("one-more")).toBe(true);

    await collectGarbage();

    // Each of the 999 keys holds its last value; every earlier one is gone.
    const alive: Array<number> = roundsAlive(refs);
    expect(
      alive.filter((round: number): boolean => {
        return round < 20000 - 999;
      }),
    ).toEqual([]);
    expect(alive).toHaveLength(999);
  });

  test("a full cache whose entries expire keeps none of the values its sweep dropped", async () => {
    let now: number = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    const cache: InMemoryTTLCache<Payload> = new InMemoryTTLCache<Payload>(
      1000,
    );

    for (let index: number = 0; index <= 1000; index++) {
      cache.set(`filled-${index}`, { round: -1 }, 60_000);
    }

    /*
     * Short-lived entries from here on, each living about 200 writes: the
     * sweep drops them, and the cache stays below its limit.
     */
    now += 120_000;
    const refs: Map<number, WeakRef<Payload>> = writeRounds(
      20000,
      (round: number, value: Payload): void => {
        cache.set(`short-${round}`, value, 1_000);
        now += 5;
      },
    );

    // Long past every TTL, and a read that sweeps.
    now += 10 * EXPIRED_ENTRY_SWEEP_INTERVAL_MS;
    expect(cache.get("short-0")).toBeUndefined();
    expect(cache.size()).toBe(0);

    await collectGarbage();

    expect(roundsAlive(refs)).toEqual([]);
  });

  test("a full cache emptied by deletes, and written to no more, keeps none of what it deleted", async () => {
    const cache: InMemoryTTLCache<Payload> = new InMemoryTTLCache<Payload>(
      1000,
    );
    // Its last write evicts, so the cursor is the last thing that moved.
    const refs: Map<number, WeakRef<Payload>> = writeRounds(
      1001,
      (round: number, value: Payload): void => {
        cache.set(`project-1:${round}`, value, 60_000);
      },
    );

    cache.deleteByPrefix("project-1:");
    expect(cache.size()).toBe(0);

    await collectGarbage();

    expect(roundsAlive(refs)).toEqual([]);
  });

  test("a full cache cleared, and written to no more, keeps none of what it held", async () => {
    const cache: InMemoryTTLCache<Payload> = new InMemoryTTLCache<Payload>(
      1000,
    );
    // Its last write evicts, as above.
    const refs: Map<number, WeakRef<Payload>> = writeRounds(
      1001,
      (round: number, value: Payload): void => {
        cache.set(`rule-${round}`, value, 60_000);
      },
    );

    cache.clear();
    expect(cache.size()).toBe(0);

    await collectGarbage();

    expect(roundsAlive(refs)).toEqual([]);
  });

  test("a full cache whose every entry expired, swept by a read with no write after, keeps none of them", async () => {
    let now: number = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    const cache: InMemoryTTLCache<Payload> = new InMemoryTTLCache<Payload>(
      1000,
    );
    // Its last write evicts, as above.
    const refs: Map<number, WeakRef<Payload>> = writeRounds(
      1001,
      (round: number, value: Payload): void => {
        cache.set(`overview-${round}`, value, 15_000);
      },
    );

    now += 60_000;
    expect(cache.get("overview-1000")).toBeUndefined();
    expect(cache.size()).toBe(0);

    await collectGarbage();

    expect(roundsAlive(refs)).toEqual([]);
  });

  test("a full cache that evicts on every write keeps none of the values it evicted", async () => {
    const cache: InMemoryTTLCache<Payload> = new InMemoryTTLCache<Payload>(
      1000,
    );
    const refs: Map<number, WeakRef<Payload>> = writeRounds(
      20000,
      (round: number, value: Payload): void => {
        cache.set(`new-${round}`, value, 60_000);
      },
    );

    expect(cache.size()).toBe(1000);

    await collectGarbage();

    const alive: Array<number> = roundsAlive(refs);
    expect(
      alive.filter((round: number): boolean => {
        return round < 19000;
      }),
    ).toEqual([]);
    expect(alive).toHaveLength(1000);
  });
});

/*
 * The cache as it was before OldestKeyCursor (master's InMemoryTTLCache up
 * to 2026-10-27, but for its name): the oldest entry is a new
 * keys().next() on every evicting write. The cursor must evict exactly
 * what this does.
 */
class KeysNextTTLCache<T> {
  private store: Map<string, { value: T; expiresAt: number }> = new Map();
  private maxEntries: number;
  private lastSweepAt: number = Number.NEGATIVE_INFINITY;

  public constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  public set(key: string, value: T, ttlMs: number): void {
    const now: number = Date.now();

    this.sweepExpiredEntriesWhenDue(now);

    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest: string | undefined = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: now + ttlMs });
  }

  public get(key: string): T | undefined {
    const now: number = Date.now();

    this.sweepExpiredEntriesWhenDue(now);

    const entry: { value: T; expiresAt: number } | undefined =
      this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (now > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
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

  private sweepExpiredEntriesWhenDue(now: number): void {
    if (
      now - this.lastSweepAt < EXPIRED_ENTRY_SWEEP_INTERVAL_MS &&
      now >= this.lastSweepAt
    ) {
      return;
    }

    this.lastSweepAt = now;

    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

describe("the cursor evicts what keys().next() evicted", () => {
  test("200 seeded runs of writes, rewrites, reads, deletes, prefix deletes, clears and expiry hold the same entries", () => {
    let now: number = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    const differences: Array<string> = [];

    for (let run: number = 0; run < 200; run++) {
      const random: SeededRandom = seededRandom(20261027 + run);
      const capacity: number = 1 + random(12);
      const cache: InMemoryTTLCache<number> = new InMemoryTTLCache<number>(
        capacity,
      );
      const before: KeysNextTTLCache<number> = new KeysNextTTLCache<number>(
        capacity,
      );
      const keys: Array<string> = [];

      for (let index: number = 0; index < 30; index++) {
        keys.push(`${index % 3 === 0 ? "a" : "b"}${index}`);
      }

      for (let step: number = 0; step < 1500; step++) {
        const key: string = keys[random(keys.length)]!;
        const operation: number = random(100);
        let answer: string = "";
        let answerBefore: string = "";

        if (operation < 55) {
          const ttl: number = [50, 400, 5_000][random(3)]!;
          cache.set(key, step, ttl);
          before.set(key, step, ttl);
        } else if (operation < 75) {
          answer = String(cache.get(key));
          answerBefore = String(before.get(key));
        } else if (operation < 92) {
          cache.delete(key);
          before.delete(key);
        } else if (operation < 96) {
          cache.deleteByPrefix("a");
          before.deleteByPrefix("a");
        } else if (operation < 97) {
          cache.clear();
          before.clear();
        } else {
          now += random(1500);
        }
        now += random(40);

        if (answer !== answerBefore) {
          differences.push(
            `run ${run} step ${step}: read ${answer} for ${answerBefore}`,
          );
        }
        if (cache.size() !== before.size()) {
          differences.push(
            `run ${run} step ${step}: ${cache.size()} entries for ${before.size()}`,
          );
        }
        if (step % 50 === 49) {
          // Every key, read from both: the same entries, the same values.
          const held: string = keys
            .map((each: string): string => {
              return String(cache.get(each));
            })
            .join(",");
          const heldBefore: string = keys
            .map((each: string): string => {
              return String(before.get(each));
            })
            .join(",");

          if (held !== heldBefore) {
            differences.push(
              `run ${run} step ${step}: held ${held} for ${heldBefore}`,
            );
          }
        }
      }
    }

    expect(differences).toEqual([]);
  });
});
