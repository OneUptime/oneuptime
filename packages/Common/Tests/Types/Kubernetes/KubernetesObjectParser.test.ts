import { JSONObject } from "../../../Types/JSON";
import {
  extractObjectFromLogBody,
  getArrayValues,
  getKvListAsRecord,
  getKvStringValue,
  getKvValue,
  getNestedKvValue,
  kvListToPlainObject,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import { describe, expect, test } from "@jest/globals";

/*
 * KubernetesObjectParser decodes OTLP kvlistValue payloads (the wire shape the
 * agent ships k8s objects in) into plain values. The OTLP encoding carries the
 * SAME field under camelCase (JSON transport) and snake_case (protobufjs
 * transport), and the parser must accept both — a regression that handled only
 * one encoding would silently drop half the fleet's data. These tests cover the
 * low-level kv helpers on both encodings plus the log-body entrypoint.
 */

// Build an OTLP kvlist from a list of [key, valueWrapper] pairs.
function kvList(entries: Array<[string, JSONObject]>): JSONObject {
  return {
    values: entries.map(([key, value]: [string, JSONObject]) => {
      return { key, value };
    }),
  };
}

describe("getKvValue", () => {
  test("reads a camelCase stringValue", () => {
    const list: JSONObject = kvList([["name", { stringValue: "web-1" }]]);
    expect(getKvValue(list, "name")).toBe("web-1");
  });

  test("reads a snake_case string_value", () => {
    const list: JSONObject = kvList([["name", { string_value: "web-1" }]]);
    expect(getKvValue(list, "name")).toBe("web-1");
  });

  test("stringifies int and bool values", () => {
    expect(
      getKvValue(kvList([["replicas", { intValue: 3 }]]), "replicas"),
    ).toBe("3");
    expect(getKvValue(kvList([["ready", { boolValue: true }]]), "ready")).toBe(
      "true",
    );
  });

  test("returns a nested kvlist as an object", () => {
    const nested: JSONObject = kvList([["app", { stringValue: "api" }]]);
    const list: JSONObject = kvList([["labels", { kvlistValue: nested }]]);
    expect(getKvValue(list, "labels")).toEqual(nested);
  });

  test("returns null for a missing key, missing values, or undefined list", () => {
    expect(getKvValue(kvList([["a", { stringValue: "1" }]]), "b")).toBeNull();
    expect(getKvValue({}, "a")).toBeNull();
    expect(getKvValue(undefined, "a")).toBeNull();
  });
});

describe("getKvStringValue", () => {
  test("returns the string value", () => {
    expect(getKvStringValue(kvList([["k", { stringValue: "v" }]]), "k")).toBe(
      "v",
    );
  });

  test("returns empty string when the value is a nested object or missing", () => {
    const list: JSONObject = kvList([["k", { kvlistValue: kvList([]) }]]);
    expect(getKvStringValue(list, "k")).toBe("");
    expect(getKvStringValue(list, "missing")).toBe("");
  });
});

describe("getNestedKvValue", () => {
  test("reads parent -> child", () => {
    const child: JSONObject = kvList([["name", { stringValue: "prod" }]]);
    const list: JSONObject = kvList([["metadata", { kvlistValue: child }]]);
    expect(getNestedKvValue(list, "metadata", "name")).toBe("prod");
  });

  test("returns empty string when the parent is absent or a string", () => {
    const list: JSONObject = kvList([["metadata", { stringValue: "flat" }]]);
    expect(getNestedKvValue(list, "metadata", "name")).toBe("");
    expect(getNestedKvValue(list, "missing", "name")).toBe("");
  });
});

describe("getKvListAsRecord", () => {
  test("flattens mixed scalar entries into a string record", () => {
    const list: JSONObject = kvList([
      ["app", { stringValue: "api" }],
      ["replicas", { intValue: 2 }],
      ["ready", { boolValue: false }],
    ]);
    expect(getKvListAsRecord(list)).toEqual({
      app: "api",
      replicas: "2",
      ready: "false",
    });
  });

  test("skips entries without a key or value and handles undefined", () => {
    expect(getKvListAsRecord(undefined)).toEqual({});
    const list: JSONObject = {
      values: [{ key: "", value: { stringValue: "x" } }],
    };
    expect(getKvListAsRecord(list)).toEqual({});
  });
});

describe("getArrayValues", () => {
  test("extracts kvlistValue items from an OTLP arrayValue", () => {
    const item1: JSONObject = kvList([["name", { stringValue: "c1" }]]);
    const item2: JSONObject = kvList([["name", { stringValue: "c2" }]]);
    const arrayValue: JSONObject = {
      values: [{ kvlistValue: item1 }, { kvlistValue: item2 }],
    };
    expect(getArrayValues(arrayValue)).toEqual([item1, item2]);
  });

  test("returns an empty array for undefined or empty input", () => {
    expect(getArrayValues(undefined)).toEqual([]);
    expect(getArrayValues({})).toEqual([]);
  });
});

describe("kvListToPlainObject", () => {
  test("converts values to their native JS types", () => {
    const list: JSONObject = kvList([
      ["name", { stringValue: "api" }],
      ["replicas", { intValue: "3" }],
      ["enabled", { boolValue: true }],
    ]);
    const plain: Record<string, unknown> = kvListToPlainObject(list);
    expect(plain["name"]).toBe("api");
    expect(plain["replicas"]).toBe(3); // number, not string
    expect(plain["enabled"]).toBe(true);
  });

  test("returns an empty object for undefined input", () => {
    expect(kvListToPlainObject(undefined)).toEqual({});
  });
});

describe("extractObjectFromLogBody", () => {
  test("returns null for invalid JSON", () => {
    expect(extractObjectFromLogBody("{ not json")).toBeNull();
  });

  test("returns null when there is no top-level kvlist", () => {
    expect(extractObjectFromLogBody(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  test("extracts the nested object under the 'object' key (watch mode)", () => {
    const inner: JSONObject = kvList([["kind", { stringValue: "Pod" }]]);
    const body: JSONObject = {
      kvlistValue: kvList([["object", { kvlistValue: inner }]]),
    };
    expect(extractObjectFromLogBody(JSON.stringify(body))).toEqual(inner);
  });

  test("treats the kvlist itself as the object when it has a kind (pull mode)", () => {
    const topList: JSONObject = kvList([["kind", { stringValue: "Node" }]]);
    const body: JSONObject = { kvlistValue: topList };
    expect(extractObjectFromLogBody(JSON.stringify(body))).toEqual(topList);
  });

  test("accepts the snake_case kvlist_value transport", () => {
    const topList: JSONObject = kvList([["kind", { string_value: "Pod" }]]);
    const body: JSONObject = { kvlist_value: topList };
    expect(extractObjectFromLogBody(JSON.stringify(body))).toEqual(topList);
  });
});
