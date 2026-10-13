import stableStringify from "../../Utils/StableStringify";
import { describe, expect, test } from "@jest/globals";

/*
 * The one stable JSON writer: what an SLO rule's criteria identity and a
 * criteria filter's match history key are made from. A value read back from
 * Postgres (jsonb reorders keys) must come out exactly as it went in.
 */
describe("stableStringify", () => {
  test("sorts object keys at every depth", () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[1,2]},"b":1}',
    );
  });

  test("is the same for a value whose keys came back in another order", () => {
    const written: Record<string, unknown> = {
      checkOn: "Response Body",
      filterType: "Not Contains",
      value: "App Title",
      options: { first: 1, second: 2 },
    };

    const readBack: Record<string, unknown> = JSON.parse(
      JSON.stringify({
        options: { second: 2, first: 1 },
        value: "App Title",
        filterType: "Not Contains",
        checkOn: "Response Body",
      }),
    );

    expect(stableStringify(readBack)).toBe(stableStringify(written));
  });

  test("leaves out keys whose value is undefined, as JSON.stringify does", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
    expect(stableStringify({ a: 1, b: undefined })).toBe(
      stableStringify({ a: 1 }),
    );
  });

  test("keeps the order of an array, which is part of its value", () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
  });

  test("writes plain values as JSON, and undefined as null", () => {
    expect(stableStringify("a")).toBe('"a"');
    expect(stableStringify(5)).toBe("5");
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify([undefined])).toBe("[null]");
  });
});
