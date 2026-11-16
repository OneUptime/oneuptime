import InMemoryLruCache, {
  InMemoryLruCacheLimits,
} from "../../../Server/Infrastructure/InMemoryLruCache";
import { EXPIRED_ENTRY_SWEEP_INTERVAL_MS } from "../../../Server/Infrastructure/InMemoryTTLCache";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A cache bounded by count and by the bytes its entries hold: the entry used
 * least recently goes first, none bigger than maxEntryBytes is kept, and
 * entries whose life is over are let go of rather than held until pushed
 * out.
 */

function cacheOf(
  limits: Partial<InMemoryLruCacheLimits<string>>,
): InMemoryLruCache<string> {
  return new InMemoryLruCache<string>(() => {
    return {
      maxEntries: 100,
      maxBytes: Number.POSITIVE_INFINITY,
      maxEntryBytes: Number.POSITIVE_INFINITY,
      sizeOf: (value: string): number => {
        return value.length;
      },
      ...limits,
    };
  });
}

function moveClock(ms: number): void {
  const now: number = Date.now() + ms;
  jest.spyOn(Date, "now").mockReturnValue(now);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InMemoryLruCache", () => {
  test("keeps a value for its ttl, and no longer", () => {
    const cache: InMemoryLruCache<string> = cacheOf({});

    expect(cache.set("a", "value", 1_000)).toBe(true);
    expect(cache.get("a")).toBe("value");

    moveClock(1_001);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toEqual({ entries: 0, bytes: 0 });
  });

  test("keeps at most maxEntries: the least recently used goes first", () => {
    const cache: InMemoryLruCache<string> = cacheOf({ maxEntries: 2 });

    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    // a is used again: b is now the least recently used.
    cache.get("a");
    cache.set("c", "3", 60_000);

    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
  });

  test("keeps at most maxBytes, letting go of as many as it takes", () => {
    const cache: InMemoryLruCache<string> = cacheOf({ maxBytes: 10 });

    cache.set("a", "aaaa", 60_000);
    cache.set("b", "bbbb", 60_000);
    cache.set("c", "cccccccc", 60_000);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("cccccccc");
    expect(cache.size()).toEqual({ entries: 1, bytes: 8 });
  });

  test("never keeps a value bigger than maxEntryBytes, or than maxBytes", () => {
    const cache: InMemoryLruCache<string> = cacheOf({
      maxEntryBytes: 5,
      maxBytes: 100,
    });

    expect(cache.set("big", "too big for one entry", 60_000)).toBe(false);
    expect(cache.get("big")).toBeUndefined();

    const small: InMemoryLruCache<string> = cacheOf({ maxBytes: 3 });
    expect(small.set("big", "four", 60_000)).toBe(false);
  });

  test("a value written again replaces the old one, and its bytes", () => {
    const cache: InMemoryLruCache<string> = cacheOf({});

    cache.set("a", "first", 60_000);
    cache.set("a", "second!", 60_000);

    expect(cache.get("a")).toBe("second!");
    expect(cache.size()).toEqual({ entries: 1, bytes: 7 });
  });

  test("lets go of entries whose life is over on a write, once the sweep is due", () => {
    const cache: InMemoryLruCache<string> = cacheOf({});

    cache.set("old", "an old value", 1_000);
    moveClock(EXPIRED_ENTRY_SWEEP_INTERVAL_MS + 1_000);
    cache.set("new", "new", 60_000);

    expect(cache.size()).toEqual({ entries: 1, bytes: 3 });
  });

  test("asks for its limits on every write", () => {
    let maxEntries: number = 1;
    const cache: InMemoryLruCache<string> = new InMemoryLruCache<string>(() => {
      return {
        maxEntries: maxEntries,
        maxBytes: Number.POSITIVE_INFINITY,
        maxEntryBytes: Number.POSITIVE_INFINITY,
        sizeOf: (): number => {
          return 0;
        },
      };
    });

    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    expect(cache.size().entries).toBe(1);

    maxEntries = 3;
    cache.set("c", "3", 60_000);
    expect(cache.size().entries).toBe(2);
  });

  test("keeps nothing with no life, and forgets everything on clear", () => {
    const cache: InMemoryLruCache<string> = cacheOf({});

    expect(cache.set("a", "1", 0)).toBe(false);

    cache.set("b", "2", 60_000);
    cache.clear();

    expect(cache.get("b")).toBeUndefined();
    expect(cache.size()).toEqual({ entries: 0, bytes: 0 });
  });
});
