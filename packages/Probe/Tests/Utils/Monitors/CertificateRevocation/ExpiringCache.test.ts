// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import { SpyInstance } from "jest-mock";
import { ExpiringCache } from "../../../../Utils/Monitors/CertificateRevocation/CertificateRevocationChecker";
import OldestKeyMap from "Common/Utils/OldestKeyMap";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * The cache the revocation checker keeps its OCSP answers (10,000 at most)
 * and CRLs (64, and 256 MB in all) in. It evicts its oldest entry when a new
 * one would not fit, through OldestKeyMap's oldestKey() (issue #6840): a
 * probe that checks many certificates fills the OCSP cache and then evicts
 * on every write, where map.keys().next() walked past every slot evicted
 * since V8 last compacted the map. These hold it to the answers it gave
 * when it evicted with keys().next(), and to its limits and expiry.
 */

const NEVER: number = Number.POSITIVE_INFINITY;

function lengthOf(value: string): number {
  return value.length;
}

describe("ExpiringCache's limits", () => {
  test("keeps at most maxEntries, letting the oldest go first", () => {
    const cache: ExpiringCache<string> = new ExpiringCache<string>(3);

    for (const key of ["a", "b", "c", "d"]) {
      cache.set(key, `value of ${key}`, NEVER);
    }

    expect(cache.get("a")).toBeUndefined();
    expect(["b", "c", "d"].map((key: string) => cache.get(key))).toEqual([
      "value of b",
      "value of c",
      "value of d",
    ]);

    cache.set("e", "value of e", NEVER);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("e")).toBe("value of e");
  });

  test("a key written again is the newest, with its new value, and is not evicted twice", () => {
    const cache: ExpiringCache<string> = new ExpiringCache<string>(3);

    cache.set("a", "first a", NEVER);
    cache.set("b", "b", NEVER);
    cache.set("c", "c", NEVER);
    cache.set("a", "second a", NEVER);
    cache.set("d", "d", NEVER);

    // b was the oldest once a was written again.
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("second a");
    expect(cache.get("c")).toBe("c");
    expect(cache.get("d")).toBe("d");

    cache.set("e", "e", NEVER);

    // Then c: a moved behind it.
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("a")).toBe("second a");
  });

  test("a size budget lets the oldest go until the new value fits", () => {
    const cache: ExpiringCache<string> = new ExpiringCache<string>(
      100,
      lengthOf,
      10,
    );

    cache.set("a", "aaaa", NEVER);
    cache.set("b", "bbbb", NEVER);
    // 4 + 4 + 4 is over 10: a goes.
    cache.set("c", "cccc", NEVER);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("bbbb");
    expect(cache.get("c")).toBe("cccc");

    // 9 fits only alone: b and c go, oldest first.
    cache.set("d", "ddddddddd", NEVER);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("d")).toBe("ddddddddd");

    // A value of no size fits beside it.
    cache.set("e", "", NEVER);

    expect(cache.get("d")).toBe("ddddddddd");
    expect(cache.get("e")).toBe("");
  });

  test("a value over the whole budget is not kept", () => {
    const cache: ExpiringCache<string> = new ExpiringCache<string>(
      100,
      lengthOf,
      10,
    );

    cache.set("huge", "x".repeat(11), NEVER);

    expect(cache.get("huge")).toBeUndefined();

    // Nothing of it was counted: a value that fills the budget still fits.
    cache.set("full", "y".repeat(10), NEVER);

    expect(cache.get("full")).toBe("y".repeat(10));
  });

  test("a value written again counts only its new size", () => {
    const cache: ExpiringCache<string> = new ExpiringCache<string>(
      100,
      lengthOf,
      10,
    );

    cache.set("a", "aaaaaaaa", NEVER);
    cache.set("a", "aa", NEVER);
    // 2 + 8 fits only if a's first 8 were let go of.
    cache.set("b", "bbbbbbbb", NEVER);

    expect(cache.get("a")).toBe("aa");
    expect(cache.get("b")).toBe("bbbbbbbb");
  });
});

describe("ExpiringCache's expiry", () => {
  test("an entry past its time is gone, and the room it took is free again", () => {
    const cache: ExpiringCache<string> = new ExpiringCache<string>(
      100,
      lengthOf,
      10,
    );

    cache.set("expired", "eeeeee", Date.now() - 1);
    cache.set("current", "cccc", NEVER);

    expect(cache.get("expired")).toBeUndefined();

    // The 6 the expired entry took are free: current stays.
    cache.set("next", "nnnnnn", NEVER);

    expect(cache.get("current")).toBe("cccc");
    expect(cache.get("next")).toBe("nnnnnn");
  });

  test("an entry is current until its time, and gone at it", () => {
    const now: SpyInstance<typeof Date.now> = jest.spyOn(Date, "now");

    try {
      now.mockReturnValue(1000);

      const cache: ExpiringCache<string> = new ExpiringCache<string>(10);

      cache.set("a", "a", 2000);

      now.mockReturnValue(1999);
      expect(cache.get("a")).toBe("a");

      now.mockReturnValue(2000);
      expect(cache.get("a")).toBeUndefined();

      // Gone for good, even if the clock went back.
      now.mockReturnValue(1000);
      expect(cache.get("a")).toBeUndefined();
    } finally {
      now.mockRestore();
    }
  });

  test("clear() lets go of every entry and of the size they took", () => {
    const cache: ExpiringCache<string> = new ExpiringCache<string>(
      3,
      lengthOf,
      10,
    );

    cache.set("a", "aaaaa", NEVER);
    cache.set("b", "bbbbb", NEVER);
    cache.clear();

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();

    cache.set("c", "c".repeat(10), NEVER);

    expect(cache.get("c")).toBe("c".repeat(10));
  });
});

describe("ExpiringCache evicts through OldestKeyMap", () => {
  test("its entries are an OldestKeyMap", () => {
    const cache: ExpiringCache<string> = new ExpiringCache<string>(3);

    expect(cache["entries"]).toBeInstanceOf(OldestKeyMap);
  });

  test("a full cache the size of the OCSP cache keeps exactly the newest entries", () => {
    const capacity: number = 10000;
    const writes: number = 5 * capacity;
    const cache: ExpiringCache<number> = new ExpiringCache<number>(capacity);

    for (let index: number = 0; index < writes; index++) {
      cache.set(`key-${index}`, index, NEVER);
    }

    expect(cache["entries"].size).toBe(capacity);
    expect(cache.get(`key-${writes - capacity - 1}`)).toBeUndefined();
    expect(cache.get(`key-${writes - capacity}`)).toBe(writes - capacity);
    expect(cache.get(`key-${writes - 1}`)).toBe(writes - 1);
  });

  /*
   * The cache as it was, evicting with keys().next(): what the cache must
   * still answer, write for write. Here in the test only - the product's
   * code may not evict this way (OldestKeyEvictionGuard).
   */
  class KeysNextCache {
    private readonly entries: Map<
      string,
      { value: string; expiresAt: number; size: number }
    > = new Map<string, { value: string; expiresAt: number; size: number }>();
    private totalSize: number = 0;

    public constructor(
      private readonly maxEntries: number,
      private readonly maxTotalSize: number,
    ) {}

    public get(key: string, now: number): string | undefined {
      const entry: { value: string; expiresAt: number } | undefined =
        this.entries.get(key);

      if (!entry) {
        return undefined;
      }

      if (entry.expiresAt <= now) {
        this.delete(key);
        return undefined;
      }

      return entry.value;
    }

    public set(key: string, value: string, expiresAt: number): void {
      this.delete(key);

      while (
        this.entries.size > 0 &&
        (this.entries.size >= this.maxEntries ||
          this.totalSize + value.length > this.maxTotalSize)
      ) {
        this.delete(this.entries.keys().next().value as string);
      }

      if (value.length > this.maxTotalSize) {
        return;
      }

      this.entries.set(key, {
        value: value,
        expiresAt: expiresAt,
        size: value.length,
      });
      this.totalSize += value.length;
    }

    public clear(): void {
      this.entries.clear();
      this.totalSize = 0;
    }

    private delete(key: string): void {
      const entry: { size: number } | undefined = this.entries.get(key);

      if (entry) {
        this.totalSize -= entry.size;
        this.entries.delete(key);
      }
    }
  }

  test.each([
    { seed: 6840, maxEntries: 8, maxTotalSize: 20, keys: 24 },
    { seed: 6841, maxEntries: 3, maxTotalSize: 1000, keys: 10 },
    { seed: 6842, maxEntries: 64, maxTotalSize: 400, keys: 100 },
  ])(
    "answers every read as the keys().next() cache did (seed $seed: $maxEntries entries, size $maxTotalSize, $keys keys)",
    (scenario: {
      seed: number;
      maxEntries: number;
      maxTotalSize: number;
      keys: number;
    }) => {
      const random: SeededRandom = seededRandom(scenario.seed);
      const now: SpyInstance<typeof Date.now> = jest.spyOn(
        Date,
        "now",
      );
      const cache: ExpiringCache<string> = new ExpiringCache<string>(
        scenario.maxEntries,
        lengthOf,
        scenario.maxTotalSize,
      );
      const reference: KeysNextCache = new KeysNextCache(
        scenario.maxEntries,
        scenario.maxTotalSize,
      );
      const mismatches: Array<string> = [];
      let clock: number = 1000;
      let reads: number = 0;
      let hits: number = 0;

      try {
        for (let step: number = 0; step < 20000; step++) {
          clock += random(3);
          now.mockReturnValue(clock);

          const key: string = `key-${random(scenario.keys)}`;
          const pick: number = random(100);

          if (pick < 50) {
            const value: string = "v".repeat(random(8)) + step;
            // Some entries outlive the run, some go within a few steps.
            const expiresAt: number =
              random(4) === 0 ? NEVER : clock + random(60);

            cache.set(key, value, expiresAt);
            reference.set(key, value, expiresAt);
          } else if (pick < 99) {
            const answer: string | undefined = cache.get(key);
            const expected: string | undefined = reference.get(key, clock);

            reads++;
            hits += expected === undefined ? 0 : 1;

            if (answer !== expected) {
              mismatches.push(
                `step ${step}: ${key} read ${String(answer)}, the keys().next() cache read ${String(expected)}`,
              );
            }
          } else {
            cache.clear();
            reference.clear();
          }
        }
      } finally {
        now.mockRestore();
      }

      expect(mismatches.slice(0, 5)).toEqual([]);
      // Both kinds of answer were compared, many times over.
      expect(reads).toBeGreaterThan(5000);
      expect(hits).toBeGreaterThan(500);
      expect(reads - hits).toBeGreaterThan(500);
    },
  );
});
