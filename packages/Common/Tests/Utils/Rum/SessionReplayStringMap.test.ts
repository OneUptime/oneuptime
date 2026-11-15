import { describe, expect, it } from "@jest/globals";
import {
  SessionReplayStringMapLimits,
  isSessionReplayStringMap,
  mergeSessionReplayStringMaps,
  sanitizeSessionReplayStringMap,
} from "../../../Utils/Rum/SessionReplayStringMap";
import {
  SESSION_REPLAY_MAX_TAG_KEYS,
  SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
  SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
} from "../../../Types/Rum/SessionReplay";

/*
 * This module runs inside customers' pages (through the recorder bundle)
 * and again at ingest over the same bytes. The tests pin the two
 * properties that make that safe: it never throws on anything a page
 * author can hand it, and it produces the same map on both sides.
 */

const LIMITS: SessionReplayStringMapLimits = {
  maxKeys: 3,
  maxKeyLength: 5,
  maxValueLength: 4,
};

describe("sanitizeSessionReplayStringMap", () => {
  it("returns an empty map for anything that is not a plain object", () => {
    for (const input of [
      null,
      undefined,
      "tags",
      42,
      true,
      ["a", "b"],
      (): void => {},
      Symbol("x"),
    ]) {
      expect(sanitizeSessionReplayStringMap(input, LIMITS)).toEqual({});
    }
  });

  it("accepts string, finite number and boolean values and stringifies them", () => {
    expect(
      sanitizeSessionReplayStringMap(
        { plan: "pro", seats: 12, beta: true, off: false },
        { maxKeys: 10, maxKeyLength: 10, maxValueLength: 10 },
      ),
    ).toEqual({ plan: "pro", seats: "12", beta: "true", off: "false" });
  });

  it("drops values that would render as garbage: objects, arrays, null, undefined, NaN, Infinity, functions", () => {
    expect(
      sanitizeSessionReplayStringMap(
        {
          obj: { nested: 1 },
          arr: [1],
          nil: null,
          undef: undefined,
          nan: NaN,
          inf: Infinity,
          fn: (): void => {},
          kept: "yes",
        },
        { maxKeys: 10, maxKeyLength: 10, maxValueLength: 10 },
      ),
    ).toEqual({ kept: "yes" });
  });

  it("truncates keys to maxKeyLength and values to maxValueLength", () => {
    expect(
      sanitizeSessionReplayStringMap({ abcdefgh: "123456789" }, LIMITS),
    ).toEqual({ abcde: "1234" });
  });

  it("drops empty keys", () => {
    expect(sanitizeSessionReplayStringMap({ "": "x", a: "y" }, LIMITS)).toEqual(
      { a: "y" },
    );
  });

  it("keeps insertion order and stops taking NEW keys at maxKeys", () => {
    const result: Record<string, string> = sanitizeSessionReplayStringMap(
      { a: "1", b: "2", c: "3", d: "4", e: "5" },
      LIMITS,
    );

    expect(Object.keys(result)).toEqual(["a", "b", "c"]);
  });

  it("lets a repeated key overwrite without counting against the cap", () => {
    /*
     * A truncated key that collides with an earlier one behaves like a
     * plain object assignment: last write wins, count unchanged.
     */
    const result: Record<string, string> = sanitizeSessionReplayStringMap(
      { abcde1: "first", abcde2: "second", b: "2", c: "3" },
      LIMITS,
    );

    /* "second" is also cut to the 4-character value cap. */
    expect(result).toEqual({ abcde: "seco", b: "2", c: "3" });
  });

  it("never lets a __proto__ key rewrite the prototype", () => {
    const input: Record<string, unknown> = JSON.parse(
      '{"__proto__": {"polluted": "yes"}, "a": "1"}',
    );

    const result: Record<string, string> = sanitizeSessionReplayStringMap(
      input,
      { maxKeys: 10, maxKeyLength: 20, maxValueLength: 20 },
    );

    expect(result).toEqual({ a: "1" });
    expect((result as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("does not throw on a throwing getter or a revoked proxy", () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "boom", {
      enumerable: true,
      get: (): never => {
        throw new Error("no");
      },
    });
    hostile["fine"] = "ok";

    expect(sanitizeSessionReplayStringMap(hostile, LIMITS)).toEqual({
      fine: "ok",
    });

    const revocable: { proxy: Record<string, unknown>; revoke: () => void } =
      Proxy.revocable<Record<string, unknown>>({}, {});
    revocable.revoke();

    expect(sanitizeSessionReplayStringMap(revocable.proxy, LIMITS)).toEqual({});
  });

  it("treats a zero-length cap as 'keep nothing' rather than throwing", () => {
    expect(
      sanitizeSessionReplayStringMap(
        { a: "1" },
        { maxKeys: 0, maxKeyLength: 5, maxValueLength: 5 },
      ),
    ).toEqual({});
    expect(
      sanitizeSessionReplayStringMap(
        { a: "1" },
        { maxKeys: 5, maxKeyLength: 0, maxValueLength: 5 },
      ),
    ).toEqual({});
    expect(
      sanitizeSessionReplayStringMap(
        { a: "1" },
        { maxKeys: 5, maxKeyLength: 5, maxValueLength: 0 },
      ),
    ).toEqual({ a: "" });
  });

  it("is idempotent, so the server re-sanitising the recorder's output changes nothing", () => {
    const once: Record<string, string> = sanitizeSessionReplayStringMap(
      { abcdefgh: 123456789, b: true, c: "x", d: "dropped" },
      LIMITS,
    );

    expect(sanitizeSessionReplayStringMap(once, LIMITS)).toEqual(once);
  });

  it("works at the shipped tag caps", () => {
    const wide: Record<string, string> = {};

    for (
      let index: number = 0;
      index < SESSION_REPLAY_MAX_TAG_KEYS + 5;
      index++
    ) {
      wide[`k${index}`] = "v";
    }

    const result: Record<string, string> = sanitizeSessionReplayStringMap(
      wide,
      {
        maxKeys: SESSION_REPLAY_MAX_TAG_KEYS,
        maxKeyLength: SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
        maxValueLength: SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
      },
    );

    expect(Object.keys(result)).toHaveLength(SESSION_REPLAY_MAX_TAG_KEYS);
  });

  /*
   * #8197: product analytics scrubs a value that is an address here, so it
   * must see the value whole: cut first, an email past the cap is no longer
   * an email, and the scrubber would keep the part of it that fit.
   */
  it("hands readValue each value whole, with the cap, and holds what it returns to the cap", () => {
    const seen: Array<[string, number]> = [];
    const result: Record<string, string> = sanitizeSessionReplayStringMap(
      { long: "abcdefgh", seats: 12, beta: true },
      LIMITS,
      (value: string, maxValueLength: number): string => {
        seen.push([value, maxValueLength]);
        return `${value}-read`;
      },
    );

    expect(seen).toEqual([
      ["abcdefgh", 4],
      ["12", 4],
      ["true", 4],
    ]);
    expect(result).toEqual({ long: "abcd", seats: "12-r", beta: "true" });
  });

  it("does not hand readValue a value it drops, or a key past the cap", () => {
    const seen: Array<string> = [];

    sanitizeSessionReplayStringMap(
      { a: "1", b: null, c: { x: 1 }, d: "2", e: "3", f: "4" },
      LIMITS,
      (value: string): string => {
        seen.push(value);
        return value;
      },
    );

    expect(seen).toEqual(["1", "2", "3"]);
  });

  it("is what it always was without readValue", () => {
    expect(
      sanitizeSessionReplayStringMap({ long: "abcdefgh" }, LIMITS),
    ).toEqual({ long: "abcd" });
  });
});

describe("mergeSessionReplayStringMaps", () => {
  it("overwrites base entries with patch entries", () => {
    expect(
      mergeSessionReplayStringMaps({ a: "1", b: "2" }, { b: "3" }, LIMITS),
    ).toEqual({ a: "1", b: "3" });
  });

  it("sanitises both sides", () => {
    expect(
      mergeSessionReplayStringMaps(
        { abcdefgh: "123456789" },
        { b: 2, c: null },
        LIMITS,
      ),
    ).toEqual({ abcde: "1234", b: "2" });
  });

  it("keeps existing keys and drops the patch's surplus new keys at the cap", () => {
    expect(
      mergeSessionReplayStringMaps(
        { a: "1", b: "2" },
        { c: "3", d: "4", a: "9" },
        LIMITS,
      ),
    ).toEqual({ a: "9", b: "2", c: "3" });
  });

  it("tolerates a non-object on either side", () => {
    expect(mergeSessionReplayStringMaps(null, { a: "1" }, LIMITS)).toEqual({
      a: "1",
    });
    expect(mergeSessionReplayStringMaps({ a: "1" }, "nope", LIMITS)).toEqual({
      a: "1",
    });
  });
});

describe("isSessionReplayStringMap", () => {
  it("accepts a plain object whose values are all strings, including an empty one", () => {
    expect(isSessionReplayStringMap({})).toBe(true);
    expect(isSessionReplayStringMap({ a: "1" })).toBe(true);
  });

  it("rejects arrays, null, primitives and non-string values", () => {
    expect(isSessionReplayStringMap([])).toBe(false);
    expect(isSessionReplayStringMap(null)).toBe(false);
    expect(isSessionReplayStringMap("x")).toBe(false);
    expect(isSessionReplayStringMap({ a: 1 })).toBe(false);
    expect(isSessionReplayStringMap({ a: { b: "c" } })).toBe(false);
  });
});
