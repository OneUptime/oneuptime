import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readNumber,
  readString,
  readStringArray,
} from "../../../Utils/SecurityEvent/NormalizerHelpers";

/*
 * Every normalizer leans on these helpers for the parts that silently
 * corrupt data when they drift: `attributes` is a Map(String,String)
 * ClickHouse column so flattening must always produce scalar strings; UDM
 * nests entities inside arrays so path reads must tolerate arrays mid-path;
 * timestamps arrive in four different epoch scales and picking the wrong
 * one puts an event 50,000 years out; and the content-hash eventUid is the
 * dedupe key for sources that send no id — if it wobbles between deliveries
 * of the same payload, duplicates multiply. These tests pin each contract.
 */
describe("NormalizerHelpers", () => {
  describe("flattenPayload", () => {
    test("nested objects become dot-notation keys", () => {
      const payload: JSONObject = {
        metadata: { event_type: "USER_LOGIN", nested: { deep: "value" } },
      };

      expect(flattenPayload(payload)).toEqual({
        "metadata.event_type": "USER_LOGIN",
        "metadata.nested.deep": "value",
      });
    });

    test("scalar arrays collapse to a comma-joined string", () => {
      const payload: JSONObject = {
        ip: ["10.0.0.1", "10.0.0.2"],
        ports: [80, 443],
      };

      expect(flattenPayload(payload)).toEqual({
        ip: "10.0.0.1,10.0.0.2",
        ports: "80,443",
      });
    });

    test("arrays of objects recurse with the index in the key", () => {
      const payload: JSONObject = {
        security_result: [{ severity: "LOW" }, { severity: "HIGH" }],
      };

      expect(flattenPayload(payload)).toEqual({
        "security_result.0.severity": "LOW",
        "security_result.1.severity": "HIGH",
      });
    });

    test("mixed arrays recurse per element", () => {
      const payload: JSONObject = { mixed: ["scalar", { key: "value" }] };

      expect(flattenPayload(payload)).toEqual({
        "mixed.0": "scalar",
        "mixed.1.key": "value",
      });
    });

    test("objects past the depth cap fall back to JSON.stringify", () => {
      const payload: JSONObject = { a: { b: { c: "d" } } };

      expect(flattenPayload(payload, 2)).toEqual({
        "a.b": JSON.stringify({ c: "d" }),
      });
    });

    test("null, undefined, empty arrays and empty objects emit nothing", () => {
      const payload: JSONObject = {
        gone: null,
        missing: undefined,
        emptyList: [],
        emptyObject: {},
        kept: "value",
      };

      expect(flattenPayload(payload)).toEqual({ kept: "value" });
    });

    test("scalars stringify", () => {
      const payload: JSONObject = { count: 42, active: true, label: "x" };

      expect(flattenPayload(payload)).toEqual({
        count: "42",
        active: "true",
        label: "x",
      });
    });
  });

  describe("readString", () => {
    test("reads a nested scalar by dot path", () => {
      const payload: JSONObject = { metadata: { id: "evt-1" } };

      expect(readString(payload, "metadata.id")).toBe("evt-1");
    });

    test("arrays along the path take the first element", () => {
      const payload: JSONObject = {
        security_result: [{ severity: "LOW" }, { severity: "HIGH" }],
      };

      expect(readString(payload, "security_result.severity")).toBe("LOW");
    });

    test("an array value returns its first scalar", () => {
      const payload: JSONObject = { ip: ["10.0.0.1", "10.0.0.2"] };

      expect(readString(payload, "ip")).toBe("10.0.0.1");
    });

    test("missing path, object value and null all read as empty string", () => {
      const payload: JSONObject = {
        metadata: { nested: { x: "y" } },
        gone: null,
      };

      expect(readString(payload, "does.not.exist")).toBe("");
      expect(readString(payload, "metadata.nested")).toBe("");
      expect(readString(payload, "gone")).toBe("");
    });

    test("numbers stringify", () => {
      const payload: JSONObject = { target: { port: 443 } };

      expect(readString(payload, "target.port")).toBe("443");
    });
  });

  describe("readNumber", () => {
    test("reads numbers and numeric strings", () => {
      const payload: JSONObject = { a: 42, b: "42", c: "4.5" };

      expect(readNumber(payload, "a")).toBe(42);
      expect(readNumber(payload, "b")).toBe(42);
      expect(readNumber(payload, "c")).toBe(4.5);
    });

    test("missing paths and non-numeric values -> null", () => {
      const payload: JSONObject = { a: "abc", b: "", c: true };

      expect(readNumber(payload, "a")).toBeNull();
      expect(readNumber(payload, "b")).toBeNull();
      expect(readNumber(payload, "c")).toBeNull();
      expect(readNumber(payload, "missing")).toBeNull();
    });
  });

  describe("readStringArray", () => {
    test("keeps scalars, drops objects and nulls, stringifies the rest", () => {
      const payload: JSONObject = { list: ["x", 1, null, { o: 1 }, true] };

      expect(readStringArray(payload, "list")).toEqual(["x", "1", "true"]);
    });

    test("a lone scalar wraps into a one-element array", () => {
      const payload: JSONObject = { host: "web-1" };

      expect(readStringArray(payload, "host")).toEqual(["web-1"]);
    });

    test("arrays along the path take the first element", () => {
      const payload: JSONObject = { a: [{ b: ["x", "y"] }, { b: ["z"] }] };

      expect(readStringArray(payload, "a.b")).toEqual(["x", "y"]);
    });

    test("missing path -> empty array", () => {
      expect(readStringArray({}, "nope")).toEqual([]);
    });
  });

  describe("parseEventTime", () => {
    // 2024-05-01T12:00:00Z in every scale the dialects use.
    const expectedMillis: number = 1714564800000;

    test("RFC3339 string", () => {
      expect(parseEventTime("2024-05-01T12:00:00Z")?.getTime()).toBe(
        expectedMillis,
      );
    });

    test("epoch seconds", () => {
      expect(parseEventTime(1714564800)?.getTime()).toBe(expectedMillis);
    });

    test("epoch millis", () => {
      expect(parseEventTime(1714564800000)?.getTime()).toBe(expectedMillis);
    });

    test("epoch micros", () => {
      expect(parseEventTime(1714564800000000)?.getTime()).toBe(expectedMillis);
    });

    test("epoch nanos", () => {
      expect(parseEventTime(1714564800000000000)?.getTime()).toBe(
        expectedMillis,
      );
    });

    test("numeric string routes through the epoch-scale logic", () => {
      expect(parseEventTime("1714564800")?.getTime()).toBe(expectedMillis);
    });

    test.each<[string]>([["garbage"], ["not a date"]])(
      "garbage string %s -> null",
      (input: string) => {
        expect(parseEventTime(input)).toBeNull();
      },
    );

    test("null, empty, zero and negative values -> null", () => {
      expect(parseEventTime(null)).toBeNull();
      expect(parseEventTime(undefined)).toBeNull();
      expect(parseEventTime("")).toBeNull();
      expect(parseEventTime("   ")).toBeNull();
      expect(parseEventTime(0)).toBeNull();
      expect(parseEventTime(-1714564800)).toBeNull();
    });
  });

  describe("buildObservables", () => {
    test("dedupes case-insensitively but keeps the first casing", () => {
      expect(buildObservables(["Alice", "alice", "ALICE", "bob"])).toEqual([
        "Alice",
        "bob",
      ]);
    });

    test("drops empties and trims whitespace", () => {
      expect(
        buildObservables(["", "  ", undefined, " host-1 ", "10.0.0.1"]),
      ).toEqual(["host-1", "10.0.0.1"]);
    });

    test("preserves input order", () => {
      expect(buildObservables(["b", "a", "c", "a"])).toEqual(["b", "a", "c"]);
    });
  });

  describe("contentHashEventUid", () => {
    test("same payload -> same uid with the sha256: prefix", () => {
      const payload: JSONObject = { metadata: { event_type: "USER_LOGIN" } };

      const first: string = contentHashEventUid(payload);
      const second: string = contentHashEventUid({
        metadata: { event_type: "USER_LOGIN" },
      });

      expect(first).toBe(second);
      expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    test("key order does not change the uid", () => {
      expect(contentHashEventUid({ a: "1", b: "2" })).toBe(
        contentHashEventUid({ b: "2", a: "1" }),
      );
    });

    test("different payloads -> different uids", () => {
      expect(contentHashEventUid({ a: "1" })).not.toBe(
        contentHashEventUid({ a: "2" }),
      );
    });
  });
});
