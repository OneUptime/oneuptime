import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { describe, expect, test } from "@jest/globals";

/*
 * The Wildcard / NotWildcard operator classes and their trip over the wire.
 *
 * A query operator that is not registered in SerializableObjectDictionary
 * does not throw on the way back in — it stays a plain `{_type, value}`
 * object, and on a Map(String,String) column the compiler then reads that
 * WRAPPER as the filter and emits `attributes['_type'] = 'Wildcard'`. So the
 * round-trip is not a formality; it is the difference between a working
 * filter and a silently wrong one.
 */

describe("Wildcard - construction", () => {
  test("a single glob is stored as a list of one", () => {
    expect(new Wildcard("a*").values).toEqual(["a*"]);
  });

  test("a list of globs is kept in order", () => {
    expect(new Wildcard(["a*", "b*"]).values).toEqual(["a*", "b*"]);
  });

  test("value returns the first glob for the common single case", () => {
    expect(new Wildcard("a*").value).toBe("a*");
  });

  test("value on an empty operator is the empty string, not undefined", () => {
    expect(new Wildcard([]).value).toBe("");
  });

  test("values can be replaced after construction", () => {
    const operator: Wildcard<string> = new Wildcard("a*");
    operator.values = ["c*"];

    expect(operator.toPatterns()).toEqual(["c%"]);
  });
});

describe("Wildcard - toString", () => {
  test("a single glob reads as itself", () => {
    expect(new Wildcard("a*").toString()).toBe("a*");
  });

  test("several globs read as the any-of syntax that produced them", () => {
    /*
     * A readable toString is a safety net: if an operator ever slips into a
     * string-coercing code path it degrades to a filter a human can recognise
     * instead of to "[object Object]".
     */
    expect(new Wildcard(["a*", "b"]).toString()).toBe("(a* OR b)");
  });
});

describe("Wildcard - toPatterns", () => {
  test("each glob becomes its LIKE pattern", () => {
    expect(new Wildcard(["a*", "*b", "c?d"]).toPatterns()).toEqual([
      "a%",
      "%b",
      "c_d",
    ]);
  });

  test("a value with no glob is an exact-match pattern", () => {
    expect(new Wildcard("abc").toPatterns()).toEqual(["abc"]);
  });
});

describe("Wildcard - JSON round-trip", () => {
  test("toJSON carries the type tag and the glob list", () => {
    expect(new Wildcard(["a*", "b"]).toJSON()).toEqual({
      _type: ObjectType.Wildcard,
      value: ["a*", "b"],
    });
  });

  test("fromJSON restores the operator", () => {
    const restored: Wildcard<string> = Wildcard.fromJSON({
      _type: ObjectType.Wildcard,
      value: ["a*"],
    });

    expect(restored).toBeInstanceOf(Wildcard);
    expect(restored.values).toEqual(["a*"]);
  });

  test("fromJSON accepts the scalar shape an older client might send", () => {
    const restored: Wildcard<string> = Wildcard.fromJSON({
      _type: ObjectType.Wildcard,
      value: "a*",
    });

    expect(restored.values).toEqual(["a*"]);
  });

  test("fromJSON refuses a mismatched type tag", () => {
    expect(() => {
      return Wildcard.fromJSON({ _type: ObjectType.Search, value: "a*" });
    }).toThrow(BadDataException);
  });

  test("a whole query round-trips through serialize / deserialize", () => {
    const serialized: JSONObject = JSONFunctions.serialize({
      attributes: { "platform.team": new Wildcard("a*") },
    });
    const restored: JSONObject = JSONFunctions.deserialize(serialized);
    const attributes: JSONObject = restored["attributes"] as JSONObject;

    expect(attributes["platform.team"]).toBeInstanceOf(Wildcard);
    expect(
      (attributes["platform.team"] as unknown as Wildcard<string>).toPatterns(),
    ).toEqual(["a%"]);
  });

  test("JSON.stringify alone also produces the wire shape", () => {
    /*
     * The aggregation endpoints are POSTed with a plain body rather than
     * through JSONFunctions.serialize, so the operator has to survive a bare
     * stringify too.
     */
    expect(JSON.parse(JSON.stringify(new Wildcard("a*")))).toEqual({
      _type: "Wildcard",
      value: ["a*"],
    });
  });
});

describe("NotWildcard", () => {
  test("carries its own type tag so compilers can tell the two apart", () => {
    expect(new NotWildcard("a*").toJSON()).toEqual({
      _type: ObjectType.NotWildcard,
      value: ["a*"],
    });
  });

  test("compiles the same patterns as its positive twin", () => {
    expect(new NotWildcard(["a*", "*b"]).toPatterns()).toEqual(
      new Wildcard(["a*", "*b"]).toPatterns(),
    );
  });

  test("round-trips to its own class, not to Wildcard", () => {
    const restored: JSONObject = JSONFunctions.deserialize(
      JSONFunctions.serialize({ k: new NotWildcard("a*") }),
    );

    expect(restored["k"]).toBeInstanceOf(NotWildcard);
    expect(restored["k"]).not.toBeInstanceOf(Wildcard);
  });

  test("fromJSON refuses a Wildcard payload", () => {
    expect(() => {
      return NotWildcard.fromJSON({
        _type: ObjectType.Wildcard,
        value: ["a*"],
      });
    }).toThrow(BadDataException);
  });
});
