/*
 * Importing an operator class FIRST is the whole point of this file.
 *
 * Includes, IncludesAll and IncludesNone import JSONFunctions (their fromJSON
 * deserializes the values inside them), and JSONFunctions imports the
 * dictionary that holds them — a cycle. While the dictionary was a plain
 * object literal, whichever side of the cycle initialized second captured the
 * other as `undefined`, so `{"_type":"Includes","value":[...]}` came back out
 * of JSONFunctions.deserialize as a plain object instead of an Includes. A
 * plain object reaching TypeORM is a silently wrong query rather than an
 * error, which is exactly the kind of failure worth pinning down.
 *
 * Jest gives each test file its own module registry, so this file's import
 * order genuinely reproduces the bad ordering.
 */

import Includes from "../../Types/BaseDatabase/Includes";
import IncludesAll from "../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../Types/BaseDatabase/IncludesNone";
import EqualTo from "../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../Types/BaseDatabase/InBetween";
import IsNull from "../../Types/BaseDatabase/IsNull";
import LessThan from "../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../Types/BaseDatabase/LessThanOrNull";
import NotContains from "../../Types/BaseDatabase/NotContains";
import NotEqual from "../../Types/BaseDatabase/NotEqual";
import NotNull from "../../Types/BaseDatabase/NotNull";
import Search from "../../Types/BaseDatabase/Search";
import StartsWith from "../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../Types/BaseDatabase/EndsWith";
import SerializableObjectDictionary from "../../Types/SerializableObjectDictionary";
import JSONFunctions from "../../Types/JSONFunctions";
import { JSONObject, ObjectType } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

describe("SerializableObjectDictionary registration", () => {
  /*
   * The regression itself. These three sit on the cycle, and this file imports
   * them before the dictionary — the order that used to leave them undefined.
   */
  test("the classes on the import cycle resolve", () => {
    expect(SerializableObjectDictionary[ObjectType.Includes]).toBe(Includes);
    expect(SerializableObjectDictionary[ObjectType.IncludesAll]).toBe(
      IncludesAll,
    );
    expect(SerializableObjectDictionary[ObjectType.IncludesNone]).toBe(
      IncludesNone,
    );
  });

  test("each entry resolves to the class it names", () => {
    expect(SerializableObjectDictionary[ObjectType.EqualTo]).toBe(EqualTo);
    expect(SerializableObjectDictionary[ObjectType.NotEqual]).toBe(NotEqual);
    expect(SerializableObjectDictionary[ObjectType.Search]).toBe(Search);
    expect(SerializableObjectDictionary[ObjectType.GreaterThan]).toBe(
      GreaterThan,
    );
    expect(SerializableObjectDictionary[ObjectType.IsNull]).toBe(IsNull);
    expect(SerializableObjectDictionary[ObjectType.NotNull]).toBe(NotNull);
  });

  test("entries stay resolvable when read more than once", () => {
    expect(SerializableObjectDictionary[ObjectType.Includes]).toBe(Includes);
    expect(SerializableObjectDictionary[ObjectType.Includes]).toBe(Includes);
  });

  test("an unknown type resolves to nothing rather than throwing", () => {
    expect(SerializableObjectDictionary["NotAThing"]).toBeUndefined();
  });
});

type RoundTripFunction = (value: unknown) => unknown;

/** JSON.stringify -> JSON.parse -> deserialize, exactly as a request does. */
const roundTrip: RoundTripFunction = (value: unknown): unknown => {
  const parsed: JSONObject = JSON.parse(JSON.stringify({ v: value }));

  return (JSONFunctions.deserialize(parsed) as JSONObject)["v"];
};

describe("query operators survive a serialize/deserialize round trip", () => {
  test("Includes keeps its class and its values", () => {
    const result: unknown = roundTrip(new Includes(["x", "y"]));

    expect(result).toBeInstanceOf(Includes);
    expect((result as Includes).values).toEqual(["x", "y"]);
  });

  test("IncludesNone keeps its class and its values", () => {
    const result: unknown = roundTrip(new IncludesNone(["x"]));

    expect(result).toBeInstanceOf(IncludesNone);
    expect((result as IncludesNone).values).toEqual(["x"]);
  });

  test("IncludesAll keeps its class and its values", () => {
    const result: unknown = roundTrip(new IncludesAll(["x", "y"]));

    expect(result).toBeInstanceOf(IncludesAll);
  });

  test("an empty membership list survives", () => {
    const result: unknown = roundTrip(new Includes([]));

    expect(result).toBeInstanceOf(Includes);
    expect((result as Includes).values).toEqual([]);
  });

  test("ObjectIDs inside a membership list come back as ObjectIDs", () => {
    const id: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
    const result: unknown = roundTrip(new Includes([id]));

    expect(result).toBeInstanceOf(Includes);
    expect((result as Includes).values[0]).toBeInstanceOf(ObjectID);
  });

  test("the comparison operators keep their class and value", () => {
    expect(roundTrip(new NotEqual<string>("a"))).toBeInstanceOf(NotEqual);
    expect(roundTrip(new EqualTo<string>("a"))).toBeInstanceOf(EqualTo);
    expect(roundTrip(new EqualToOrNull<string>("a"))).toBeInstanceOf(
      EqualToOrNull,
    );
    expect(roundTrip(new GreaterThan<number>(1))).toBeInstanceOf(GreaterThan);
    expect(roundTrip(new GreaterThanOrEqual<number>(1))).toBeInstanceOf(
      GreaterThanOrEqual,
    );
    expect(roundTrip(new LessThan<number>(1))).toBeInstanceOf(LessThan);
    expect(roundTrip(new LessThanOrEqual<number>(1))).toBeInstanceOf(
      LessThanOrEqual,
    );
    expect(roundTrip(new GreaterThanOrNull<number>(1))).toBeInstanceOf(
      GreaterThanOrNull,
    );
    expect(roundTrip(new LessThanOrNull<number>(1))).toBeInstanceOf(
      LessThanOrNull,
    );
  });

  test("the text operators keep their class", () => {
    expect(roundTrip(new Search("a"))).toBeInstanceOf(Search);
    expect(roundTrip(new NotContains("a"))).toBeInstanceOf(NotContains);
    expect(roundTrip(new StartsWith("a"))).toBeInstanceOf(StartsWith);
    expect(roundTrip(new EndsWith("a"))).toBeInstanceOf(EndsWith);
  });

  test("the null checks keep their class", () => {
    expect(roundTrip(new IsNull())).toBeInstanceOf(IsNull);
    expect(roundTrip(new NotNull())).toBeInstanceOf(NotNull);
  });

  test("InBetween keeps both of its bounds", () => {
    const result: unknown = roundTrip(new InBetween<number>(1, 5));

    expect(result).toBeInstanceOf(InBetween);
    expect((result as InBetween<number>).startValue).toBe(1);
    expect((result as InBetween<number>).endValue).toBe(5);
  });

  test("a numeric comparison keeps its number, not a string of it", () => {
    const result: unknown = roundTrip(new GreaterThan<number>(42));

    expect((result as GreaterThan<number>).value).toBe(42);
  });

  test("plain values are left exactly as they are", () => {
    expect(roundTrip("plain")).toBe("plain");
    expect(roundTrip(7)).toBe(7);
    expect(roundTrip(true)).toBe(true);
    expect(roundTrip(null)).toBeNull();
  });

  test("a whole query of mixed operators deserializes together", () => {
    const query: JSONObject = JSON.parse(
      JSON.stringify({
        name: new Search("acme"),
        tags: new Includes(["a", "b"]),
        count: new GreaterThan<number>(3),
        deletedAt: new IsNull(),
        isEnabled: true,
      }),
    );

    const result: JSONObject = JSONFunctions.deserialize(query) as JSONObject;

    expect(result["name"]).toBeInstanceOf(Search);
    expect(result["tags"]).toBeInstanceOf(Includes);
    expect(result["count"]).toBeInstanceOf(GreaterThan);
    expect(result["deletedAt"]).toBeInstanceOf(IsNull);
    expect(result["isEnabled"]).toBe(true);
  });
});
