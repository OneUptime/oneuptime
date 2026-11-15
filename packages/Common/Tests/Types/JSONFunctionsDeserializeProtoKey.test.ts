import JSONFunctions from "../../Types/JSONFunctions";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "../../Models/AnalyticsModels/Log";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../Models/DatabaseModels/Incident";
import { readOwnValue } from "../../Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "../Helpers/InheritedNames";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #8222: A KEY NAMED __proto__ IN THE API'S JSON, AS deserialize READS IT.
 *
 * JSONFunctions.deserialize is what every answer of the API goes through in
 * the browser (HTTPResponse), and what the server reads a request body with
 * (BaseAPI, BaseModel.fromJSON). It skipped a key named "__proto__" at
 * every depth: assigned to the copy, an object under it would have become
 * the copy's prototype. That kept a telemetry attribute or a series label
 * named "__proto__", which the server stores and sends (serialize writes
 * every key as its own), off the Logs, Traces and Metrics pages.
 *
 * What it does now, and what these tests hold it to:
 *
 *   - the object it is handed (a model's columns, a request body, a
 *     response, each row of a list) never gets a "__proto__" key, whatever
 *     its value: no column is named so;
 *   - inside a value, a string, a number or a boolean under "__proto__" is
 *     kept, defined as the copy's own data property - never assigned, so no
 *     setter runs and no prototype changes;
 *   - an object, an array or null under "__proto__" is left out at every
 *     depth, as before: each could become a prototype, or a way to one, in
 *     code that copies or walks the value later with plain assignments.
 *
 * Each test then checks that nothing was written onto Object.prototype, and
 * the pollution attempts below try what a hostile body would.
 */

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();
const OBJECT_FUNCTION_KEYS: Array<string> =
  Object.getOwnPropertyNames(Object).sort();

afterEach(() => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
  expect(Object.getOwnPropertyNames(Object).sort()).toEqual(
    OBJECT_FUNCTION_KEYS,
  );
  expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  expect(({} as Record<string, unknown>)["isAdmin"]).toBeUndefined();
});

// As the browser and the server get it: a decoded JSON text.
function decode(text: string): JSONObject {
  return JSON.parse(text) as JSONObject;
}

function ownDescriptor(
  value: unknown,
  key: string,
): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(value, key);
}

function expectPlainObject(value: unknown): void {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
}

const PRIMITIVES: Array<string | number | boolean> = [
  "x",
  "",
  0,
  7.5,
  true,
  false,
];
const NOT_KEPT: Array<JSONValue> = [
  { polluted: "yes" },
  [],
  ["polluted"],
  [{ polluted: "yes" }],
  null,
];

describe("the object deserialize is handed never gets a __proto__ key", () => {
  test.each([...PRIMITIVES, ...NOT_KEPT] as Array<JSONValue>)(
    "a top-level __proto__ of %j is left out, and the copy is a plain object",
    (value: JSONValue) => {
      const result: JSONObject = JSONFunctions.deserialize(
        decode(`{"__proto__":${JSON.stringify(value)},"title":"x"}`),
      );

      expectPlainObject(result);
      expect(Object.keys(result)).toEqual(["title"]);
      expect(ownDescriptor(result, "__proto__")).toBeUndefined();
      expect((result as Record<string, unknown>)["polluted"]).toBeUndefined();
    },
  );

  test("each row of a list is such an object: a row's own __proto__ is left out", () => {
    const rows: JSONArray = JSONFunctions.deserializeArray([
      decode('{"__proto__":"x","_id":"1"}'),
      decode('{"__proto__":{"polluted":"yes"},"_id":"2"}'),
    ]);

    for (const row of rows) {
      expectPlainObject(row);
      expect(Object.keys(row)).toEqual(["_id"]);
    }
  });

  test("so is each item of a list deserializeValue is handed, and the value of a list", () => {
    const items: JSONValue = JSONFunctions.deserializeValue([
      decode('{"__proto__":"x","name":"a"}'),
    ] as unknown as JSONValue);

    expect(items).toEqual([{ name: "a" }]);
    expect(
      JSONFunctions.deserializeValue(decode('{"__proto__":"x","name":"a"}')),
    ).toEqual({ name: "a" });
  });
});

describe("inside a value, a string, a number or a boolean under __proto__ is data", () => {
  test.each(PRIMITIVES)(
    "%j under __proto__ in a column's value is the value's own data property",
    (value: string | number | boolean) => {
      const result: JSONObject = JSONFunctions.deserialize(
        decode(
          `{"attributes":{"team":"payments","__proto__":${JSON.stringify(value)},"region":"eu"}}`,
        ),
      );
      const attributes: JSONObject = result["attributes"] as JSONObject;

      expectPlainObject(attributes);
      expect(Object.keys(attributes)).toEqual(["team", "__proto__", "region"]);
      expect(ownDescriptor(attributes, "__proto__")).toEqual({
        value: value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(readOwnValue(attributes, "__proto__")).toBe(value);
      expect(JSON.stringify(attributes)).toBe(
        `{"team":"payments","__proto__":${JSON.stringify(value)},"region":"eu"}`,
      );
    },
  );

  test("at every depth, and in a list inside a value", () => {
    const result: JSONObject = JSONFunctions.deserialize(
      decode(
        '{"a":{"__proto__":"one","b":{"__proto__":"two","c":{"__proto__":3}}},"rows":[{"__proto__":"four"},[{"__proto__":true}]]}',
      ),
    );
    const a: JSONObject = result["a"] as JSONObject;
    const b: JSONObject = a["b"] as JSONObject;
    const c: JSONObject = b["c"] as JSONObject;
    const rows: Array<JSONValue> = result["rows"] as Array<JSONValue>;

    for (const object of [a, b, c, rows[0], (rows[1] as Array<JSONValue>)[0]]) {
      expectPlainObject(object);
    }

    expect(readOwnValue(a, "__proto__")).toBe("one");
    expect(readOwnValue(b, "__proto__")).toBe("two");
    expect(readOwnValue(c, "__proto__")).toBe(3);
    expect(readOwnValue(rows[0] as JSONObject, "__proto__")).toBe("four");
    expect(
      readOwnValue((rows[1] as Array<JSONValue>)[0] as JSONObject, "__proto__"),
    ).toBe(true);
  });

  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s with text is kept as an own key inside a value, as at the top",
    (name: string) => {
      const result: JSONObject = JSONFunctions.deserialize(
        decode(
          `{"attributes":{${JSON.stringify(name)}:"own ${name}"},${JSON.stringify(name)}:"top"}`,
        ),
      );

      expect(readOwnValue(result["attributes"] as JSONObject, name)).toBe(
        `own ${name}`,
      );
      expectPlainObject(result["attributes"]);
      // At the top only __proto__ is left out; the other names are kept as they always were.
      expect(readOwnValue(result, name)).toBe(
        name === "__proto__" ? undefined : "top",
      );
      expectPlainObject(result);
    },
  );

  test("a value the API serialized comes back with its __proto__ key, as it was stored", () => {
    const stored: JSONObject = decode(
      '{"attributes":{"__proto__":"x","team":"a"},"seriesLabels":{"__proto__":"eu-1"}}',
    );
    const overTheWire: JSONObject = decode(
      JSON.stringify(JSONFunctions.serialize(stored)),
    );
    const read: JSONObject = JSONFunctions.deserialize(overTheWire);

    expect(readOwnValue(read["attributes"] as JSONObject, "__proto__")).toBe(
      "x",
    );
    expect(readOwnValue(read["seriesLabels"] as JSONObject, "__proto__")).toBe(
      "eu-1",
    );
    expect(Object.keys(read["attributes"] as JSONObject)).toEqual([
      "__proto__",
      "team",
    ]);
  });
});

describe("anything else under __proto__ is left out at every depth", () => {
  test.each(NOT_KEPT)(
    "%j under __proto__ in a value is left out, and the value stays a plain object",
    (value: JSONValue) => {
      const result: JSONObject = JSONFunctions.deserialize(
        decode(
          `{"attributes":{"__proto__":${JSON.stringify(value)},"team":"a"},"rows":[{"__proto__":${JSON.stringify(value)}}]}`,
        ),
      );
      const attributes: JSONObject = result["attributes"] as JSONObject;
      const row: JSONObject = (result["rows"] as Array<JSONObject>)[0]!;

      for (const object of [attributes, row]) {
        expectPlainObject(object);
        expect(ownDescriptor(object, "__proto__")).toBeUndefined();
        expect((object as Record<string, unknown>)["polluted"]).toBeUndefined();
      }

      expect(Object.keys(attributes)).toEqual(["team"]);
      expect(Object.keys(row)).toEqual([]);
    },
  );

  test("a getter named __proto__ is never called, and never copied", () => {
    let calls: number = 0;
    const hostile: Record<string, unknown> = {};

    Object.defineProperty(hostile, "__proto__", {
      enumerable: true,
      configurable: true,
      get: (): string => {
        calls++;
        return "from a getter";
      },
    });

    const result: JSONObject = JSONFunctions.deserialize({
      attributes: hostile as JSONObject,
    });

    expect(calls).toBe(0);
    expectPlainObject(result["attributes"]);
    expect(ownDescriptor(result["attributes"], "__proto__")).toBeUndefined();
  });

  test("a __proto__ an object only inherits is not its own, so it is not copied", () => {
    const parent: JSONObject = decode('{"__proto__":"the parent\'s"}');
    const child: JSONObject = Object.create(parent) as JSONObject;

    const result: JSONObject = JSONFunctions.deserialize({ attributes: child });

    expect(ownDescriptor(result["attributes"], "__proto__")).toBeUndefined();
    expectPlainObject(result["attributes"]);
  });
});

/*
 * What a hostile sender would try, through deserialize and then through
 * the kind of code that reads its result with plain assignments: a copy key
 * by key, a recursive merge into a fresh object, and a model's fromJSON.
 * Nothing may reach Object.prototype (afterEach), and no copy may gain a
 * prototype other than Object.prototype.
 */
describe("pollution attempts", () => {
  const ATTEMPTS: Array<string> = [
    '{"__proto__":{"polluted":"yes","isAdmin":true}}',
    '{"a":{"__proto__":{"polluted":"yes"}}}',
    '{"a":{"b":{"__proto__":{"polluted":"yes"}}}}',
    '{"a":[{"__proto__":{"polluted":"yes"}}]}',
    '{"a":{"__proto__":["polluted"]}}',
    '{"a":{"__proto__":null}}',
    '{"a":{"__proto__":"polluted"}}',
    '{"constructor":{"prototype":{"polluted":"yes"}}}',
    '{"a":{"constructor":{"prototype":{"polluted":"yes"}}}}',
    '{"a":{"__proto__":{"__proto__":{"polluted":"yes"}}}}',
    '[{"__proto__":{"polluted":"yes"}}]',
  ];

  // Copies every key with an assignment, as careless code would.
  function assignEveryKey(
    target: Record<string, unknown>,
    source: unknown,
  ): void {
    for (const key in source as Record<string, unknown>) {
      target[key] = (source as Record<string, unknown>)[key];
    }
  }

  // Merges recursively with plain reads and writes, as careless code would.
  function mergeInto(target: Record<string, unknown>, source: unknown): void {
    for (const key in source as Record<string, unknown>) {
      const value: unknown = (source as Record<string, unknown>)[key];

      if (value && typeof value === "object") {
        if (!target[key] || typeof target[key] !== "object") {
          target[key] = {};
        }

        mergeInto(target[key] as Record<string, unknown>, value);
      } else {
        target[key] = value;
      }
    }
  }

  function everyObjectIn(
    value: unknown,
    found: Array<unknown> = [],
  ): Array<unknown> {
    if (value && typeof value === "object") {
      found.push(value);

      for (const key of Object.keys(value)) {
        everyObjectIn((value as Record<string, unknown>)[key], found);
      }
    }

    return found;
  }

  test.each(ATTEMPTS)(
    "%s: deserialized, nothing has a prototype of the sender's",
    (text: string) => {
      const input: JSONValue = JSON.parse(text) as JSONValue;
      const result: JSONValue = Array.isArray(input)
        ? JSONFunctions.deserializeArray(input as JSONArray)
        : JSONFunctions.deserialize(input as JSONObject);

      for (const object of everyObjectIn(result)) {
        expect(
          Object.getPrototypeOf(object) === Object.prototype ||
            Object.getPrototypeOf(object) === Array.prototype,
        ).toBe(true);
      }
    },
  );

  test.each(ATTEMPTS)(
    "%s: deserialized and then copied key by key with assignments, still nothing",
    (text: string) => {
      const input: JSONValue = JSON.parse(text) as JSONValue;
      const result: JSONValue = Array.isArray(input)
        ? JSONFunctions.deserializeArray(input as JSONArray)
        : JSONFunctions.deserialize(input as JSONObject);

      for (const object of everyObjectIn(result)) {
        const copy: Record<string, unknown> = {};

        assignEveryKey(copy, object);

        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);

        // A sender's key may be the copy's own; it is never reached through a prototype.
        for (const key of ["polluted", "isAdmin"]) {
          expect({
            key,
            reachedThroughAPrototype:
              copy[key] !== undefined &&
              !Object.prototype.hasOwnProperty.call(copy, key),
          }).toEqual({ key, reachedThroughAPrototype: false });
        }
      }
    },
  );

  test.each(ATTEMPTS)(
    "%s: deserialized and then merged recursively into a fresh object, still nothing",
    (text: string) => {
      const input: JSONValue = JSON.parse(text) as JSONValue;
      const result: JSONValue = Array.isArray(input)
        ? JSONFunctions.deserializeArray(input as JSONArray)
        : JSONFunctions.deserialize(input as JSONObject);
      const target: Record<string, unknown> = {};

      mergeInto(target, result);

      for (const object of everyObjectIn(target)) {
        expect(
          Object.getPrototypeOf(object) === Object.prototype ||
            Object.getPrototypeOf(object) === Array.prototype,
        ).toBe(true);
      }
    },
  );

  test.each(
    ATTEMPTS.filter((text: string) => {
      return text.startsWith("{");
    }),
  )(
    "%s: as a request body read into a model, still nothing",
    (text: string) => {
      const incident: Incident = BaseModel.fromJSON<Incident>(
        JSON.parse(text) as JSONObject,
        Incident,
      ) as Incident;

      expect(incident).toBeInstanceOf(Incident);
      expect(Object.getPrototypeOf(incident)).toBe(Incident.prototype);
      expect((incident as unknown as Record<string, unknown>)["polluted"]).toBe(
        undefined,
      );
      expect((incident as unknown as Record<string, unknown>)["isAdmin"]).toBe(
        undefined,
      );
    },
  );
});

/*
 * Issue #8488, decided: an object under "constructor" or "prototype" is
 * data, kept at every depth as it always was - a project may store one in
 * a JSON column, and much JSON never passes through deserialize anyway. It
 * is the value's own key, never the Object function or Object.prototype; a
 * merge or a deep set over such a value reads and writes its target's own
 * keys (readOwnValue, writeOwnValue), as EventOverlayScope.addPredicate does.
 */
describe("an object under constructor or prototype is data", () => {
  test("kept at every depth as the value's own, holding what was sent", () => {
    const result: JSONObject = JSONFunctions.deserialize(
      decode(
        '{"constructor":{"name":"top"},"a":{"constructor":{"prototype":{"polluted":"yes"}}},"prototype":{"b":1}}',
      ),
    );
    const nested: unknown = readOwnValue(
      readOwnValue(result, "a") as JSONObject,
      "constructor",
    );

    expect(readOwnValue(result, "constructor")).toEqual({ name: "top" });
    expect(readOwnValue(result, "prototype")).toEqual({ b: 1 });
    expect(nested).not.toBe(Object);
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
    expect(readOwnValue(nested as JSONObject, "prototype")).toEqual({
      polluted: "yes",
    });
    expect(readOwnValue(nested as JSONObject, "prototype")).not.toBe(
      Object.prototype,
    );
  });
});

describe("the pages that read the API's JSON", () => {
  test("a log row's attribute named __proto__ reaches the Logs page's model, through HTTPResponse as a list reads it", () => {
    const body: JSONObject = decode(
      JSON.stringify({
        data: [
          {
            _id: "8b0e8f2a-1111-4111-8111-111111111111",
            body: "request failed",
            attributes: { team: "payments", "http.route": "/checkout" },
          },
        ],
        count: 1,
        skip: 0,
        limit: 10,
      }).replace('"team":"payments"', '"__proto__":"x","team":"payments"'),
    );

    // As the server sent it: the attribute is in the raw JSON.
    expect(
      readOwnValue(
        ((body["data"] as JSONArray)[0]!["attributes"] as JSONObject) || {},
        "__proto__",
      ),
    ).toBe("x");

    const response: HTTPResponse<JSONArray> = new HTTPResponse<JSONArray>(
      200,
      body,
      {},
    );
    const logs: Array<Log> = AnalyticsBaseModel.fromJSONArray<Log>(
      response.data as Array<JSONObject>,
      Log,
    );

    expect(response.count).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toBeInstanceOf(Log);
    expect(Object.getPrototypeOf(logs[0])).toBe(Log.prototype);

    const attributes: JSONObject = logs[0]!.attributes as JSONObject;

    expectPlainObject(attributes);
    // As the log's details panel lists them: its keys, sorted, and each one's value.
    expect(
      Object.keys(attributes)
        .sort((left: string, right: string): number => {
          return left.localeCompare(right);
        })
        .map((key: string): [string, unknown] => {
          return [key, attributes[key]];
        }),
    ).toEqual([
      ["__proto__", "x"],
      ["http.route", "/checkout"],
      ["team", "payments"],
    ]);
  });

  test("a single answer keeps a nested __proto__ value, never a top-level one", () => {
    const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
      200,
      decode(
        '{"__proto__":{"polluted":"yes"},"seriesLabels":{"__proto__":"eu-1","region":"eu"}}',
      ),
      {},
    );
    const data: JSONObject = response.data as JSONObject;

    expectPlainObject(data);
    expect(Object.keys(data)).toEqual(["seriesLabels"]);
    expect(readOwnValue(data["seriesLabels"] as JSONObject, "__proto__")).toBe(
      "eu-1",
    );
  });

  test("an incident's series labels keep a label named __proto__, read into the model as the incident page reads it", () => {
    const incident: Incident = BaseModel.fromJSON<Incident>(
      decode(
        '{"_id":"8b0e8f2a-2222-4222-8222-222222222222","title":"API latency","seriesLabels":{"__proto__":"eu-1","region":"eu"}}',
      ),
      Incident,
    ) as Incident;

    expect(Object.getPrototypeOf(incident)).toBe(Incident.prototype);
    expect(incident.title).toBe("API latency");

    const labels: JSONObject = incident.seriesLabels as unknown as JSONObject;

    expectPlainObject(labels);
    expect(Object.keys(labels)).toEqual(["__proto__", "region"]);
    expect(readOwnValue(labels, "__proto__")).toBe("eu-1");
  });

  test("a request body's own top-level __proto__ never becomes a column or the model's prototype", () => {
    const incident: Incident = BaseModel.fromJSON<Incident>(
      decode('{"__proto__":{"title":"injected"},"description":"real"}'),
      Incident,
    ) as Incident;

    expect(Object.getPrototypeOf(incident)).toBe(Incident.prototype);
    expect(incident.title).toBeUndefined();
    expect(incident.description).toBe("real");
  });
});
