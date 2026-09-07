import { describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import {
  TelemetryScopeAttributeValue,
  getFilterAttributes,
  getFilterNumberValues,
  getFilterSearchValue,
  getFilterStringValues,
  isEmptyFilterValue,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetryQueryFilterValues";

/*
 * These readers sit between a STORED monitor query and every viewer that
 * hosts one. The shapes they have to cope with are not hypothetical: a
 * telemetry monitor builds `new Includes([...])`, the worker persists the
 * blob through JSON.stringify, and whether the reader sees an operator
 * INSTANCE or the plain `{ _type: "Includes", value: [...] }` object depends
 * on whether the page ran JSONFunctions.deserialize first. A reader that
 * handles one and not the other loses an incident's scope on one surface
 * while keeping it on another — silently, because a scope that fails open
 * just shows more rows.
 *
 * So every case below is asserted in BOTH shapes.
 */

const SERVICE_ID: string = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
).toString();
const OTHER_SERVICE_ID: string = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
).toString();

/** Persist the way the worker does, restore WITHOUT deserializing. */
function serialized(value: unknown): unknown {
  return JSONFunctions.anyObjectToJSONObject({
    value: value,
  } as JSONObject)["value"];
}

/** Persist and restore the way a page that deserializes does. */
function roundTripped(value: unknown): unknown {
  return (
    JSONFunctions.deserialize(
      JSONFunctions.anyObjectToJSONObject({ value: value } as JSONObject),
    ) as JSONObject
  )["value"];
}

describe("getFilterStringValues", () => {
  test("reads an Includes of ObjectIDs in both stored shapes", () => {
    const filter: Includes = new Includes([
      new ObjectID(SERVICE_ID),
      new ObjectID(OTHER_SERVICE_ID),
    ]);

    for (const shape of [filter, serialized(filter), roundTripped(filter)]) {
      expect(getFilterStringValues(shape)).toEqual([
        SERVICE_ID,
        OTHER_SERVICE_ID,
      ]);
    }
  });

  test("reads a bare string, a number and a single ObjectID", () => {
    expect(getFilterStringValues("checkout")).toEqual(["checkout"]);
    expect(getFilterStringValues(42)).toEqual(["42"]);
    expect(getFilterStringValues(new ObjectID(SERVICE_ID))).toEqual([
      SERVICE_ID,
    ]);
    expect(getFilterStringValues(serialized(new ObjectID(SERVICE_ID)))).toEqual(
      [SERVICE_ID],
    );
  });

  test("reads a plain array, and dedupes while preserving order", () => {
    expect(getFilterStringValues(["b", "a", "b"])).toEqual(["b", "a"]);
  });

  test("drops blank and non-scalar members rather than emitting empties", () => {
    expect(getFilterStringValues(["a", "", "   ", null, {}, "b"])).toEqual([
      "a",
      "b",
    ]);
  });

  test("returns nothing for the shapes it cannot read", () => {
    expect(getFilterStringValues(null)).toEqual([]);
    expect(getFilterStringValues(undefined)).toEqual([]);
    expect(getFilterStringValues(new Search<string>("boom"))).toEqual([]);
    expect(
      getFilterStringValues(new InBetween<Date>(new Date(1), new Date(2))),
    ).toEqual([]);
  });
});

describe("isEmptyFilterValue", () => {
  /*
   * The distinction this draws is the whole reason it exists: an EMPTY
   * membership scopes nothing and is a no-op the monitor happened to store,
   * while an unreadable value is scope we failed to carry and must report.
   * Conflating them either spams a hint on every incident or hides a real
   * widening.
   */
  test("an empty membership is empty, in both stored shapes", () => {
    const empty: Includes = new Includes([]);

    expect(isEmptyFilterValue(empty)).toBe(true);
    expect(isEmptyFilterValue(serialized(empty))).toBe(true);
    expect(isEmptyFilterValue([])).toBe(true);
    expect(isEmptyFilterValue("")).toBe(true);
    expect(isEmptyFilterValue("   ")).toBe(true);
  });

  test("a populated or unreadable value is not empty", () => {
    expect(isEmptyFilterValue(new Includes(["a"]))).toBe(false);
    expect(isEmptyFilterValue("a")).toBe(false);
    expect(isEmptyFilterValue(new Search<string>("a"))).toBe(false);
  });
});

describe("getFilterSearchValue", () => {
  test("reads a Search in both stored shapes", () => {
    const filter: Search<string> = new Search<string>("OutOfMemory");

    for (const shape of [filter, serialized(filter), roundTripped(filter)]) {
      expect(getFilterSearchValue(shape)).toBe("OutOfMemory");
    }
  });

  test("is null for anything that is not a Search", () => {
    /*
     * The caller uses null to mean "this is an exact-match filter", so a
     * false positive here would turn a span-name equality into a substring
     * match and widen an incident's list.
     */
    expect(getFilterSearchValue(new Includes(["a"]))).toBeNull();
    expect(getFilterSearchValue("a")).toBeNull();
    expect(getFilterSearchValue(null)).toBeNull();
    expect(getFilterSearchValue(undefined)).toBeNull();
  });

  test("an empty Search is null, not an empty substring", () => {
    // `new Search("")` matches everything; reporting it as scope would lie.
    expect(getFilterSearchValue(new Search<string>(""))).toBeNull();
    expect(getFilterSearchValue(new Search<string>("   "))).toBeNull();
  });
});

describe("getFilterNumberValues", () => {
  test("reads SpanStatus members through both stored shapes", () => {
    const filter: Includes = new Includes([1, 2]);

    for (const shape of [filter, serialized(filter), roundTripped(filter)]) {
      expect(getFilterNumberValues(shape)).toEqual([1, 2]);
    }
  });

  test("reads decimal strings, which is what a JSON round trip can leave", () => {
    expect(getFilterNumberValues(new Includes(["0", "2"]))).toEqual([0, 2]);
  });

  test("drops non-numeric members rather than coercing them to NaN", () => {
    // A NaN in the list would compile to a predicate that matches nothing.
    expect(getFilterNumberValues(new Includes(["2", "error"]))).toEqual([2]);
  });
});

describe("getFilterAttributes", () => {
  test("reads a scalar attribute record, keeping value types", () => {
    const attributes: Dictionary<TelemetryScopeAttributeValue> =
      getFilterAttributes({
        "http.route": "/checkout",
        "http.status_code": 500,
        "error.escaped": true,
      });

    expect(attributes).toEqual({
      "http.route": "/checkout",
      "http.status_code": 500,
      "error.escaped": true,
    });
  });

  test("survives the store/load round trip a monitor's attributes take", () => {
    const stored: unknown = roundTripped({
      "http.route": "/checkout",
      "http.status_code": 500,
    });

    expect(getFilterAttributes(stored)).toEqual({
      "http.route": "/checkout",
      "http.status_code": 500,
    });
  });

  test("drops non-scalar values and blank keys", () => {
    expect(
      getFilterAttributes({
        good: "yes",
        nested: { a: 1 },
        list: ["a"],
        "  ": "blank key",
      }),
    ).toEqual({ good: "yes" });
  });

  test("is empty for an operator or a non-record", () => {
    /*
     * An operator stored under `attributes` is not an attribute map. Reading
     * its internals as attribute keys would invent filters the monitor never
     * expressed.
     */
    expect(getFilterAttributes(new Includes(["a"]))).toEqual({});
    expect(getFilterAttributes(new Search<string>("a"))).toEqual({});
    expect(getFilterAttributes(serialized(new Includes(["a"])))).toEqual({});
    expect(getFilterAttributes(new ObjectID(SERVICE_ID))).toEqual({});
    expect(getFilterAttributes(["a"])).toEqual({});
    expect(getFilterAttributes(null)).toEqual({});
  });
});
