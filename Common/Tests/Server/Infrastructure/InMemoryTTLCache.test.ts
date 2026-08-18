import InMemoryTTLCache from "../../../Server/Infrastructure/InMemoryTTLCache";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test — the bounded TTL cache the telemetry ingest rule
 * caches (log/trace pipelines, drop filters, scrub rules, metric rules)
 * sit on. Two properties matter for those callers:
 *
 * 1. Expiry physically deletes: a read past the TTL must both miss AND
 *    shrink the store, or per-project entries accumulate for every tenant
 *    ever seen by a long-lived ingest process.
 * 2. Capacity is a hard cap with oldest-write eviction, so the cache can
 *    never grow past maxEntries no matter how many distinct keys arrive.
 */

/*
 * Minimal structural view of a jest spy — the @jest/globals and @types/jest
 * spy types disagree in this repo, so annotate with just the surface these
 * tests use.
 */
type NowSpyLike = {
  mockReturnValue: (value: number) => unknown;
  mockRestore: () => void;
};

function spyNow(value: number): NowSpyLike {
  const spy: NowSpyLike = jest.spyOn(Date, "now") as unknown as NowSpyLike;
  spy.mockReturnValue(value);
  return spy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InMemoryTTLCache TTL behavior", () => {
  test("get returns the value within its TTL", () => {
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);

    cache.set("a", "value-a", 60_000);

    expect(cache.get("a")).toBe("value-a");
    expect(cache.has("a")).toBe(true);
    expect(cache.size()).toBe(1);
  });

  test("get past the TTL misses AND physically deletes the entry", () => {
    const t0: number = 1_000_000;
    const nowSpy: NowSpyLike = spyNow(t0);

    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);
    cache.set("a", "value-a", 1_000);
    expect(cache.size()).toBe(1);

    // Boundary: at exactly expiresAt the entry is still valid (strict >).
    nowSpy.mockReturnValue(t0 + 1_000);
    expect(cache.get("a")).toBe("value-a");
    expect(cache.size()).toBe(1);

    nowSpy.mockReturnValue(t0 + 1_001);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  test("has() reports false for an expired entry and deletes it", () => {
    const t0: number = 1_000_000;
    const nowSpy: NowSpyLike = spyNow(t0);

    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);
    cache.set("a", "value-a", 1_000);

    nowSpy.mockReturnValue(t0 + 5_000);
    expect(cache.has("a")).toBe(false);
    expect(cache.size()).toBe(0);
  });
});

describe("InMemoryTTLCache capacity eviction", () => {
  test("insert beyond capacity evicts the oldest key", () => {
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);

    cache.set("a", "value-a", 60_000);
    cache.set("b", "value-b", 60_000);
    cache.set("c", "value-c", 60_000);
    cache.set("d", "value-d", 60_000);

    expect(cache.size()).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("value-b");
    expect(cache.get("c")).toBe("value-c");
    expect(cache.get("d")).toBe("value-d");
  });

  test("re-setting an existing key refreshes insertion order so it is not the eviction victim", () => {
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);

    cache.set("a", "value-a", 60_000);
    cache.set("b", "value-b", 60_000);
    cache.set("c", "value-c", 60_000);

    // Overwrite at capacity: no eviction, "a" moves to newest position.
    cache.set("a", "value-a2", 60_000);
    expect(cache.size()).toBe(3);
    expect(cache.get("b")).toBe("value-b");
    expect(cache.get("c")).toBe("value-c");

    // Next new key evicts "b" (now the oldest), not the refreshed "a".
    cache.set("d", "value-d", 60_000);
    expect(cache.size()).toBe(3);
    expect(cache.get("a")).toBe("value-a2");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("value-c");
    expect(cache.get("d")).toBe("value-d");
  });
});

describe("InMemoryTTLCache basics", () => {
  test("values are stored by reference", () => {
    const cache: InMemoryTTLCache<Array<string>> = new InMemoryTTLCache<
      Array<string>
    >(3);

    const value: Array<string> = [];
    cache.set("a", value, 60_000);

    expect(cache.get("a")).toBe(value);
  });

  test("delete removes an entry", () => {
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);

    cache.set("a", "value-a", 60_000);
    cache.delete("a");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(false);
    expect(cache.size()).toBe(0);
  });

  test("clear empties the cache", () => {
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);

    cache.set("a", "value-a", 60_000);
    cache.set("b", "value-b", 60_000);
    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  test("has returns false for a key that was never set", () => {
    const cache: InMemoryTTLCache<string> = new InMemoryTTLCache<string>(3);

    expect(cache.has("missing")).toBe(false);
    expect(cache.get("missing")).toBeUndefined();
  });
});
