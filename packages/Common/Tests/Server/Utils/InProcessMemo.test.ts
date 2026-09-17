import InProcessMemo from "../../../Server/Utils/InProcessMemo";
import { describe, expect, jest, test, afterEach } from "@jest/globals";

/*
 * InProcessMemo is the L1 layer the telemetry ingest hot path now leans on
 * in four places (autoDiscover entity ids, the maintenance-fence refusal
 * memo, host resolution, resource retention). Its contract is small but
 * every clause is load-bearing:
 *
 *   - a hit must be free and a miss must be honest (expired == absent),
 *   - the map must stay bounded no matter what keys collectors invent,
 *     because the keys come from collector-controlled resource attributes,
 *   - eviction must be oldest-first so a hot steady-state working set is
 *     not evicted by one burst of novel keys, and
 *   - the clock must be steerable so the suites for the callers above can
 *     prove their TTL behaviour without sleeping.
 *
 * A fixed injected clock is used for determinism everywhere except the
 * lazy-Date.now test, which pins the property the module-level memos in
 * production depend on: a jest Date.now spy installed AFTER construction
 * must still steer the default clock.
 */

type Clock = { nowMs: number; now: () => number };

function makeClock(startMs: number = 1_000_000): Clock {
  const clock: Clock = {
    nowMs: startMs,
    now: (): number => {
      return clock.nowMs;
    },
  };
  return clock;
}

describe("InProcessMemo", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("get / set", () => {
    test("returns what was stored, within the TTL", () => {
      const clock: Clock = makeClock();
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 1000,
        now: clock.now,
      });

      memo.set("k", "v");

      expect(memo.get("k")).toBe("v");
    });

    test("misses on a key never stored", () => {
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 1000,
      });

      expect(memo.get("absent")).toBeUndefined();
    });

    test("stores falsy-but-present values distinguishably from a miss", () => {
      /*
       * The fence memo stores booleans and the empty string is a legal
       * cached value in principle — `undefined` alone must mean "miss".
       */
      const memo: InProcessMemo<string | boolean> = new InProcessMemo<
        string | boolean
      >({ ttlInMs: 1000 });

      memo.set("empty", "");
      memo.set("false", false);

      expect(memo.get("empty")).toBe("");
      expect(memo.get("false")).toBe(false);
    });

    test("a later set overwrites an earlier one", () => {
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 1000,
      });

      memo.set("k", "v1");
      memo.set("k", "v2");

      expect(memo.get("k")).toBe("v2");
    });

    test("keys are independent", () => {
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 1000,
      });

      memo.set("a", "va");
      memo.set("b", "vb");

      expect(memo.get("a")).toBe("va");
      expect(memo.get("b")).toBe("vb");
    });
  });

  describe("TTL", () => {
    test("expires exactly at the boundary — an entry at its expiry instant is a miss", () => {
      const clock: Clock = makeClock();
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 1000,
        now: clock.now,
      });

      memo.set("k", "v");

      clock.nowMs += 999;
      expect(memo.get("k")).toBe("v");

      clock.nowMs += 1;
      expect(memo.get("k")).toBeUndefined();
    });

    test("an expired entry is deleted on read, freeing its slot", () => {
      const clock: Clock = makeClock();
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 1000,
        now: clock.now,
      });

      memo.set("k", "v");
      clock.nowMs += 2000;

      expect(memo.get("k")).toBeUndefined();
      expect(memo.size()).toBe(0);
    });

    test("re-setting a key restarts its TTL", () => {
      const clock: Clock = makeClock();
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 1000,
        now: clock.now,
      });

      memo.set("k", "v1");
      clock.nowMs += 900;
      memo.set("k", "v2");
      clock.nowMs += 900;

      // 1800ms after the first set, but only 900ms after the second.
      expect(memo.get("k")).toBe("v2");
    });

    test("a per-set TTL override wins over the instance TTL", () => {
      /*
       * ResourceHeartbeat caps each entry at that caller's own liveness
       * window, which can be shorter than the memo's 60s default.
       */
      const clock: Clock = makeClock();
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 60_000,
        now: clock.now,
      });

      memo.set("short", "v", 1000);
      memo.set("default", "v");

      clock.nowMs += 1001;

      expect(memo.get("short")).toBeUndefined();
      expect(memo.get("default")).toBe("v");
    });

    test("the lazy default clock is steerable by a Date.now spy installed later", () => {
      /*
       * The production memos are constructed at module load, long before
       * any test runs. If the constructor captured the Date.now REFERENCE,
       * a later spy would be invisible and no caller suite could ever test
       * expiry. Pin the lazy read.
       */
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 1000,
      });

      let nowMs: number = 5_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowMs;
      });

      memo.set("k", "v");
      nowMs += 1001;

      expect(memo.get("k")).toBeUndefined();
    });
  });

  describe("bounding", () => {
    test("never grows past maxEntries under churn", () => {
      const memo: InProcessMemo<number> = new InProcessMemo<number>({
        ttlInMs: 60_000,
        maxEntries: 5,
      });

      for (let i: number = 0; i < 500; i++) {
        memo.set(`key-${i}`, i);
      }

      expect(memo.size()).toBeLessThanOrEqual(5);
    });

    test("evicts the oldest entry first", () => {
      const memo: InProcessMemo<number> = new InProcessMemo<number>({
        ttlInMs: 60_000,
        maxEntries: 3,
      });

      memo.set("a", 1);
      memo.set("b", 2);
      memo.set("c", 3);
      memo.set("d", 4);

      expect(memo.get("a")).toBeUndefined();
      expect(memo.get("b")).toBe(2);
      expect(memo.get("c")).toBe(3);
      expect(memo.get("d")).toBe(4);
    });

    test("re-setting an existing key refreshes its recency instead of evicting", () => {
      const memo: InProcessMemo<number> = new InProcessMemo<number>({
        ttlInMs: 60_000,
        maxEntries: 3,
      });

      memo.set("a", 1);
      memo.set("b", 2);
      memo.set("c", 3);
      // "a" becomes the youngest; "b" is now the oldest.
      memo.set("a", 10);
      memo.set("d", 4);

      expect(memo.get("b")).toBeUndefined();
      expect(memo.get("a")).toBe(10);
      expect(memo.get("c")).toBe(3);
      expect(memo.get("d")).toBe(4);
    });

    test("defaults the cap to 10k — the established ingest-path bound", () => {
      const memo: InProcessMemo<number> = new InProcessMemo<number>({
        ttlInMs: 60_000,
      });

      for (let i: number = 0; i < 10_500; i++) {
        memo.set(`key-${i}`, i);
      }

      expect(memo.size()).toBeLessThanOrEqual(10_000);
    });
  });

  describe("delete / clear", () => {
    test("delete drops exactly one entry", () => {
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 60_000,
      });

      memo.set("a", "va");
      memo.set("b", "vb");
      memo.delete("a");

      expect(memo.get("a")).toBeUndefined();
      expect(memo.get("b")).toBe("vb");
    });

    test("delete of an absent key is a no-op", () => {
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 60_000,
      });

      expect(() => {
        memo.delete("absent");
      }).not.toThrow();
    });

    test("clear drops everything", () => {
      const memo: InProcessMemo<string> = new InProcessMemo<string>({
        ttlInMs: 60_000,
      });

      memo.set("a", "va");
      memo.set("b", "vb");
      memo.clear();

      expect(memo.size()).toBe(0);
      expect(memo.get("a")).toBeUndefined();
    });
  });
});
