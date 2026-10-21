import AttributeValueSuggestionCache, {
  AttributeValueSuggestionCacheEntry,
} from "../../../../Server/Utils/Telemetry/AttributeValueSuggestionCache";
import { describe, expect, test } from "@jest/globals";

/*
 * The process-local store of recent attribute value lookups (issue #4708):
 * answers live five minutes, a lookup that ran out of time one minute, and
 * the whole store is held to a number of answers and of characters, the
 * answer used longest ago making room first.
 */

interface Clock {
  now: number;
}

function cacheWith(
  clock: Clock,
  overrides: Partial<{
    maxEntries: number;
    maxCharacters: number;
  }> = {},
): AttributeValueSuggestionCache {
  return new AttributeValueSuggestionCache({
    maxEntries: overrides.maxEntries ?? 100,
    maxCharacters: overrides.maxCharacters ?? 100000,
    answerTtlInMs: 5 * 60 * 1000,
    stoppedTtlInMs: 60 * 1000,
    now: (): number => {
      return clock.now;
    },
  });
}

function valuesOf(
  entry: AttributeValueSuggestionCacheEntry | undefined,
): Array<string> | undefined {
  return entry && entry.kind === "values" ? entry.values : undefined;
}

describe("AttributeValueSuggestionCache", () => {
  test("an answer is there for five minutes, then gone", () => {
    const clock: Clock = { now: 1000 };
    const cache: AttributeValueSuggestionCache = cacheWith(clock);

    cache.setValues("a", ["GET", "POST"]);

    clock.now += 5 * 60 * 1000 - 1;
    expect(valuesOf(cache.get("a"))).toEqual(["GET", "POST"]);

    clock.now += 1;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.heldCharacters).toBe(0);
  });

  test("a stop at the time limit is remembered for one minute", () => {
    const clock: Clock = { now: 0 };
    const cache: AttributeValueSuggestionCache = cacheWith(clock);

    cache.setStopped("a");

    clock.now = 59999;
    expect(cache.get("a")).toEqual({ kind: "stopped" });

    clock.now = 60000;
    expect(cache.get("a")).toBeUndefined();
  });

  test("an answer replaces a remembered stop, and the other way round", () => {
    const clock: Clock = { now: 0 };
    const cache: AttributeValueSuggestionCache = cacheWith(clock);

    cache.setStopped("a");
    cache.setValues("a", ["x"]);
    expect(valuesOf(cache.get("a"))).toEqual(["x"]);

    cache.setStopped("a");
    expect(cache.get("a")).toEqual({ kind: "stopped" });
    expect(cache.size).toBe(1);
    expect(cache.heldCharacters).toBe("a".length);
  });

  test("a caller gets a copy: changing it changes nothing held", () => {
    const clock: Clock = { now: 0 };
    const cache: AttributeValueSuggestionCache = cacheWith(clock);
    const stored: Array<string> = ["b", "a"];

    cache.setValues("k", stored);
    stored.push("pushed after storing");

    const first: Array<string> = valuesOf(cache.get("k"))!;
    first.sort();
    first.push("pushed by a reader");

    expect(valuesOf(cache.get("k"))).toEqual(["b", "a"]);
  });

  test("past the entry limit, the answer used longest ago makes room", () => {
    const clock: Clock = { now: 0 };
    const cache: AttributeValueSuggestionCache = cacheWith(clock, {
      maxEntries: 3,
    });

    cache.setValues("one", ["1"]);
    cache.setValues("two", ["2"]);
    cache.setValues("three", ["3"]);

    // Reading "one" makes it the newest; "two" is now the oldest.
    expect(valuesOf(cache.get("one"))).toEqual(["1"]);

    cache.setValues("four", ["4"]);

    expect(cache.size).toBe(3);
    expect(cache.get("two")).toBeUndefined();
    expect(valuesOf(cache.get("one"))).toEqual(["1"]);
    expect(valuesOf(cache.get("three"))).toEqual(["3"]);
    expect(valuesOf(cache.get("four"))).toEqual(["4"]);
  });

  test("past the character budget, the oldest answers make room", () => {
    const clock: Clock = { now: 0 };
    // Each entry below is 1 + 10 = 11 characters.
    const cache: AttributeValueSuggestionCache = cacheWith(clock, {
      maxCharacters: 33,
    });

    cache.setValues("a", ["0123456789"]);
    cache.setValues("b", ["0123456789"]);
    cache.setValues("c", ["0123456789"]);
    expect(cache.heldCharacters).toBe(33);

    cache.setValues("d", ["0123456789"]);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(3);
    expect(cache.heldCharacters).toBe(33);

    // A long answer pushes out as many as it needs.
    cache.setValues("e", ["01234567890123456789"]);
    expect(cache.heldCharacters).toBeLessThanOrEqual(33);
    expect(valuesOf(cache.get("e"))).toEqual(["01234567890123456789"]);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeUndefined();
  });

  test("an answer bigger than the whole budget is not kept, and keeps what was there", () => {
    const clock: Clock = { now: 0 };
    const cache: AttributeValueSuggestionCache = cacheWith(clock, {
      maxCharacters: 20,
    });

    cache.setValues("small", ["abc"]);
    cache.setValues("huge", ["x".repeat(50)]);

    expect(cache.get("huge")).toBeUndefined();
    expect(valuesOf(cache.get("small"))).toEqual(["abc"]);
  });

  test("the characters held always match what is held", () => {
    const clock: Clock = { now: 0 };
    const cache: AttributeValueSuggestionCache = cacheWith(clock, {
      maxEntries: 5,
      maxCharacters: 60,
    });

    for (let index: number = 0; index < 40; index++) {
      const key: string = `key-${index % 7}`;

      if (index % 3 === 0) {
        cache.setStopped(key);
      } else {
        cache.setValues(key, ["v".repeat(index % 11)]);
      }

      clock.now += 20 * 1000;
      cache.get(`key-${(index * 5) % 7}`);
    }

    let expected: number = 0;

    for (let index: number = 0; index < 7; index++) {
      const key: string = `key-${index}`;
      const entry: AttributeValueSuggestionCacheEntry | undefined =
        cache.get(key);

      if (entry) {
        expected += key.length;
        expected += (valuesOf(entry) || []).join("").length;
      }
    }

    expect(cache.heldCharacters).toBe(expected);
    expect(cache.size).toBeLessThanOrEqual(5);
    expect(cache.heldCharacters).toBeLessThanOrEqual(60);
  });

  test("clear forgets everything", () => {
    const clock: Clock = { now: 0 };
    const cache: AttributeValueSuggestionCache = cacheWith(clock);

    cache.setValues("a", ["1"]);
    cache.setStopped("b");
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.heldCharacters).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
