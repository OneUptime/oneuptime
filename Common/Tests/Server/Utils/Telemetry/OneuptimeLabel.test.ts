import {
  ONEUPTIME_LABEL_ATTRIBUTE_PREFIX,
  extractOneuptimeLabelNames,
} from "../../../../Server/Utils/Telemetry/OneuptimeLabel";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * extractOneuptimeLabelNames walks a list of OTel resource attributes and
 * turns any key prefixed with `oneuptime.label.` into a `<dimension>:<value>`
 * label name. The function is pure — it only reaches into the JSON attribute
 * shape — so every case here is a plain input/output assertion with no
 * network, DB, clock, or randomness involved.
 *
 * The OTel attribute shape the function reads is:
 *   { key: "oneuptime.label.team", value: { stringValue: "payments" } }
 * The two builders below construct exactly that shape so the intent of each
 * test stays readable, while deliberately-malformed cases are spelled out
 * inline with explicit casts.
 */

/*
 * MAX_LABEL_NAME_LENGTH is a private const in the source (not exported). The
 * tests reference the literal 100 through this local so the boundary cases
 * read clearly and stay in one place; it mirrors the source constant.
 */
const MAX_LABEL_NAME_LENGTH: number = 100;

/*
 * Build a well-formed OTel string attribute whose key already carries the
 * `oneuptime.label.` prefix. `dimension` is the part after the prefix.
 */
function labelAttribute(dimension: string, stringValue: string): JSONObject {
  return {
    key: `${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}${dimension}`,
    value: { stringValue: stringValue },
  };
}

/*
 * Build an attribute with a fully explicit key (no prefix helper), used for
 * the prefix-matching cases where the raw key string is the thing under test.
 */
function rawAttribute(key: string, stringValue: string): JSONObject {
  return {
    key: key,
    value: { stringValue: stringValue },
  };
}

describe("extractOneuptimeLabelNames", () => {
  describe("the exported prefix constant", () => {
    test("is the documented `oneuptime.label.` string with a trailing dot", () => {
      expect(ONEUPTIME_LABEL_ATTRIBUTE_PREFIX).toBe("oneuptime.label.");
    });
  });

  describe("guard clauses / non-iterable inputs return an empty array", () => {
    test("undefined input returns []", () => {
      expect(extractOneuptimeLabelNames(undefined)).toEqual([]);
    });

    test("null input returns [] (defensive: type says JSONArray, runtime may differ)", () => {
      const nullInput: JSONArray = null as unknown as JSONArray;

      expect(extractOneuptimeLabelNames(nullInput)).toEqual([]);
    });

    test("a non-array value returns [] via the Array.isArray guard", () => {
      const objectInput: JSONArray = {
        key: `${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}team`,
      } as unknown as JSONArray;

      expect(extractOneuptimeLabelNames(objectInput)).toEqual([]);
    });

    test("an empty array returns []", () => {
      expect(extractOneuptimeLabelNames([])).toEqual([]);
    });
  });

  describe("happy path", () => {
    test("a single labelled attribute becomes `<dimension>:<value>`", () => {
      const attributes: JSONArray = [labelAttribute("team", "payments")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual(["team:payments"]);
    });

    test("a dimension containing dots is preserved verbatim", () => {
      const attributes: JSONArray = [labelAttribute("team.env", "prod")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual(["team.env:prod"]);
    });

    test("multiple labelled attributes are returned in first-seen order", () => {
      const attributes: JSONArray = [
        labelAttribute("team", "payments"),
        labelAttribute("env", "prod"),
        labelAttribute("region", "us-east"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([
        "team:payments",
        "env:prod",
        "region:us-east",
      ]);
    });

    test("a numeric-looking string value is kept as a string label", () => {
      const attributes: JSONArray = [labelAttribute("tier", "123")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual(["tier:123"]);
    });
  });

  describe("prefix matching", () => {
    test("keys without the prefix are skipped", () => {
      const attributes: JSONArray = [
        rawAttribute("service.name", "checkout"),
        rawAttribute("host.name", "node-1"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("the prefix must be at the START — an embedded prefix does not match", () => {
      const attributes: JSONArray = [
        rawAttribute(
          `resource.${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}team`,
          "payments",
        ),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("prefix matching is case-sensitive", () => {
      const attributes: JSONArray = [
        rawAttribute("ONEUPTIME.LABEL.team", "payments"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("the prefix without its trailing dot is not a match", () => {
      const attributes: JSONArray = [rawAttribute("oneuptime.label", "team")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a key equal to the bare prefix yields an empty dimension and is skipped", () => {
      const attributes: JSONArray = [
        rawAttribute(ONEUPTIME_LABEL_ATTRIBUTE_PREFIX, "payments"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a dimension that is pure whitespace is skipped after trimming", () => {
      const attributes: JSONArray = [labelAttribute("   ", "payments")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("surrounding whitespace on the dimension is trimmed away", () => {
      const attributes: JSONArray = [labelAttribute("  team  ", "payments")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual(["team:payments"]);
    });
  });

  describe("key type guard", () => {
    test("a non-string key (number) is skipped", () => {
      const attributes: JSONArray = [
        {
          key: 42,
          value: { stringValue: "payments" },
        } as unknown as JSONObject,
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a missing key is skipped", () => {
      const attributes: JSONArray = [
        { value: { stringValue: "payments" } } as unknown as JSONObject,
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a null key is skipped (typeof null is not 'string')", () => {
      const attributes: JSONArray = [
        {
          key: null,
          value: { stringValue: "payments" },
        } as unknown as JSONObject,
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a null attribute element is coerced to {} and skipped", () => {
      const attributes: JSONArray = [
        null as unknown as JSONObject,
        labelAttribute("team", "payments"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual(["team:payments"]);
    });
  });

  describe("value extraction", () => {
    test("a missing value wrapper is skipped", () => {
      const attributes: JSONArray = [
        {
          key: `${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}team`,
        } as unknown as JSONObject,
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a non-string stringValue (number) is skipped", () => {
      const attributes: JSONArray = [
        {
          key: `${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}team`,
          value: { stringValue: 5 },
        } as unknown as JSONObject,
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a null stringValue is skipped", () => {
      const attributes: JSONArray = [
        {
          key: `${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}team`,
          value: { stringValue: null },
        } as unknown as JSONObject,
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("an OTel intValue (no stringValue) does not become a label", () => {
      const attributes: JSONArray = [
        {
          key: `${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}count`,
          value: { intValue: 7 },
        } as unknown as JSONObject,
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a raw (non-wrapped) string value is skipped — only the OTel stringValue shape counts", () => {
      const attributes: JSONArray = [
        {
          key: `${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}team`,
          value: "payments",
        } as unknown as JSONObject,
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("an empty-string value is skipped", () => {
      const attributes: JSONArray = [labelAttribute("team", "")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("a whitespace-only value is skipped after trimming", () => {
      const attributes: JSONArray = [labelAttribute("team", "   \t  ")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([]);
    });

    test("surrounding whitespace on the value is trimmed away", () => {
      const attributes: JSONArray = [labelAttribute("team", "  payments  ")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual(["team:payments"]);
    });

    test("internal whitespace inside the value is preserved", () => {
      const attributes: JSONArray = [labelAttribute("team", "pay ments")];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([
        "team:pay ments",
      ]);
    });
  });

  describe("label-name identity / no collapsing across dimensions", () => {
    test("same value under different dimensions produces two distinct labels", () => {
      const attributes: JSONArray = [
        labelAttribute("team", "prod"),
        labelAttribute("env", "prod"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([
        "team:prod",
        "env:prod",
      ]);
    });
  });

  describe("deduplication", () => {
    test("two identical attributes collapse to a single label", () => {
      const attributes: JSONArray = [
        labelAttribute("team", "payments"),
        labelAttribute("team", "payments"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual(["team:payments"]);
    });

    test("dedup keeps the first occurrence's position in the result order", () => {
      const attributes: JSONArray = [
        labelAttribute("team", "payments"),
        labelAttribute("env", "prod"),
        labelAttribute("team", "payments"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([
        "team:payments",
        "env:prod",
      ]);
    });
  });

  describe("length cap / truncation at MAX_LABEL_NAME_LENGTH", () => {
    test("a label exactly MAX_LABEL_NAME_LENGTH long is kept whole", () => {
      /*
       * "team:" is 5 chars, so a 95-char value yields a 100-char label — the
       * boundary is `> MAX`, so exactly 100 must NOT be truncated.
       */
      const value: string = "a".repeat(MAX_LABEL_NAME_LENGTH - "team:".length);
      const attributes: JSONArray = [labelAttribute("team", value)];

      const result: Array<string> = extractOneuptimeLabelNames(attributes);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(MAX_LABEL_NAME_LENGTH);
      expect(result[0]).toBe(`team:${value}`);
    });

    test("a label one over the cap is truncated to exactly MAX_LABEL_NAME_LENGTH", () => {
      const value: string = "a".repeat(
        MAX_LABEL_NAME_LENGTH - "team:".length + 1,
      );
      const attributes: JSONArray = [labelAttribute("team", value)];

      const result: Array<string> = extractOneuptimeLabelNames(attributes);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(MAX_LABEL_NAME_LENGTH);
      expect(result[0]).toBe(
        `team:${value}`.substring(0, MAX_LABEL_NAME_LENGTH),
      );
    });

    test("truncation can make two distinct long values collide into one label", () => {
      /*
       * Both labels share their first MAX_LABEL_NAME_LENGTH characters
       * ("team:" + 95 'a's) and only differ afterwards, so the cap makes them
       * identical and the Set collapses them to a single entry.
       */
      const sharedPrefix: string = "a".repeat(
        MAX_LABEL_NAME_LENGTH - "team:".length,
      );
      const attributes: JSONArray = [
        labelAttribute("team", `${sharedPrefix}${"b".repeat(20)}`),
        labelAttribute("team", `${sharedPrefix}${"c".repeat(20)}`),
      ];

      const result: Array<string> = extractOneuptimeLabelNames(attributes);

      expect(result).toEqual([`team:${sharedPrefix}`]);
      expect(result[0]).toHaveLength(MAX_LABEL_NAME_LENGTH);
    });

    test("distinct short values that fit under the cap are NOT collapsed", () => {
      const attributes: JSONArray = [
        labelAttribute("team", "payments"),
        labelAttribute("team", "billing"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([
        "team:payments",
        "team:billing",
      ]);
    });
  });

  describe("mixed / realistic resource attribute lists", () => {
    test("only the valid labelled attributes survive a mixed list", () => {
      const attributes: JSONArray = [
        rawAttribute("service.name", "checkout"),
        labelAttribute("team", "payments"),
        rawAttribute("host.name", "node-1"),
        {
          key: `${ONEUPTIME_LABEL_ATTRIBUTE_PREFIX}count`,
          value: { intValue: 3 },
        } as unknown as JSONObject,
        labelAttribute("env", "  staging  "),
        labelAttribute("", "ignored"),
      ];

      expect(extractOneuptimeLabelNames(attributes)).toEqual([
        "team:payments",
        "env:staging",
      ]);
    });

    test("does not mutate the input attribute list", () => {
      const attributes: JSONArray = [
        labelAttribute("team", "payments"),
        rawAttribute("service.name", "checkout"),
      ];
      const snapshot: string = JSON.stringify(attributes);

      extractOneuptimeLabelNames(attributes);

      expect(JSON.stringify(attributes)).toBe(snapshot);
    });

    test("returns a fresh array on each call", () => {
      const attributes: JSONArray = [labelAttribute("team", "payments")];

      const first: Array<string> = extractOneuptimeLabelNames(attributes);
      const second: Array<string> = extractOneuptimeLabelNames(attributes);

      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });
});
