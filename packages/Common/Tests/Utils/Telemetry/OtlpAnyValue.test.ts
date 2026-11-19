import { describe, expect, test } from "@jest/globals";
import {
  OTLP_ANY_VALUE_MAX_DEPTH,
  isOtlpKvlistValue,
  readOtlpAnyValue,
} from "../../../Utils/Telemetry/OtlpAnyValue";
import { JSONObject } from "../../../Types/JSON";

/*
 * An OTLP AnyValue as the plain value it carries (#9648): a map body - the
 * Docker Swarm agent's inventory record - read as the object it is, each
 * value's type kept, in the camelCase of OTLP/JSON and the snake_case of a
 * protobufjs decode, bounded in depth.
 */

describe("readOtlpAnyValue", () => {
  test("reads each scalar as its type", () => {
    expect(readOtlpAnyValue({ stringValue: "shop" })).toBe("shop");
    // int64 travels as a string in OTLP/JSON: a number all the same.
    expect(readOtlpAnyValue({ intValue: "42" })).toBe(42);
    expect(readOtlpAnyValue({ doubleValue: 0.5 })).toBe(0.5);
    expect(readOtlpAnyValue({ boolValue: true })).toBe(true);
    expect(readOtlpAnyValue({ boolValue: false })).toBe(false);
  });

  test("reads a map as an object, and a list as an array, all the way down", () => {
    expect(
      readOtlpAnyValue({
        kvlistValue: {
          values: [
            { key: "Name", value: { stringValue: "shop_data" } },
            { key: "Replicas", value: { intValue: "3" } },
            {
              key: "Labels",
              value: {
                kvlistValue: {
                  values: [{ key: "tier", value: { stringValue: "db" } }],
                },
              },
            },
            {
              key: "Ports",
              value: {
                arrayValue: {
                  values: [{ intValue: "80" }, { intValue: "443" }],
                },
              },
            },
          ],
        },
      }),
    ).toEqual({
      Name: "shop_data",
      Replicas: 3,
      Labels: { tier: "db" },
      Ports: [80, 443],
    });
  });

  test("reads the snake_case a protobuf decode writes", () => {
    expect(
      readOtlpAnyValue({
        kvlist_value: {
          values: [
            { key: "Name", value: { string_value: "logs" } },
            { key: "Size", value: { int_value: "1024" } },
            { key: "Ready", value: { bool_value: true } },
          ],
        },
      }),
    ).toEqual({ Name: "logs", Size: 1024, Ready: true });
  });

  test("skips a pair with no key and never writes __proto__", () => {
    const read: JSONObject = readOtlpAnyValue({
      kvlistValue: {
        values: [
          { value: { stringValue: "nameless" } },
          { key: "__proto__", value: { stringValue: "polluted" } },
          { key: "ok", value: { stringValue: "kept" } },
        ],
      },
    }) as JSONObject;

    expect(read).toEqual({ ok: "kept" });
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
  });

  test("reads nothing past its depth, and nothing that is no AnyValue", () => {
    let deep: JSONObject = { stringValue: "bottom" };
    for (
      let level: number = 0;
      level <= OTLP_ANY_VALUE_MAX_DEPTH + 1;
      level++
    ) {
      deep = { kvlistValue: { values: [{ key: "next", value: deep }] } };
    }
    expect(JSON.stringify(readOtlpAnyValue(deep))).not.toContain("bottom");

    expect(readOtlpAnyValue(null)).toBeNull();
    expect(readOtlpAnyValue("plain")).toBeNull();
    expect(readOtlpAnyValue({ intValue: "not a number" })).toBeNull();
  });
});

describe("isOtlpKvlistValue", () => {
  test("is true only for a map", () => {
    expect(isOtlpKvlistValue({ kvlistValue: { values: [] } })).toBe(true);
    expect(isOtlpKvlistValue({ kvlist_value: { values: [] } })).toBe(true);
    expect(isOtlpKvlistValue({ stringValue: "x" })).toBe(false);
    expect(isOtlpKvlistValue({ Name: "flat" })).toBe(false);
    expect(isOtlpKvlistValue(null)).toBe(false);
  });
});
