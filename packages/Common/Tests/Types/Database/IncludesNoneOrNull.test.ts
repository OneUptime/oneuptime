import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IncludesNoneOrNull from "../../../Types/BaseDatabase/IncludesNoneOrNull";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * INCLUDESNONEORNULL, THE OPERATOR (#10581): none of these values, an empty
 * column included - what a list's "is not" of several means. How the server
 * writes it for Postgres and ClickHouse is pinned in
 * Tests/Server/Types/Database/IncludesNoneOrNullQuery.test.ts and
 * Tests/Server/Utils/AnalyticsDatabase/StatementGeneratorWhereOperators.test.ts.
 */

const ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_ID: string = "22222222-2222-4222-8222-222222222222";

// JSON.stringify -> JSON.parse -> deserialize, exactly as a request does.
const roundTrip: (value: unknown) => unknown = (value: unknown): unknown => {
  const parsed: JSONObject = JSON.parse(JSON.stringify({ v: value }));

  return (JSONFunctions.deserialize(parsed) as JSONObject)["v"];
};

describe("IncludesNoneOrNull", () => {
  it("holds the values it is given", () => {
    expect(new IncludesNoneOrNull(["a", "b"]).values).toEqual(["a", "b"]);
    expect(new IncludesNoneOrNull([1, 2]).values).toEqual([1, 2]);
  });

  it("gets and sets its values", () => {
    const operator: IncludesNoneOrNull = new IncludesNoneOrNull(["a"]);

    operator.values = ["c", "d"];

    expect(operator.values).toEqual(["c", "d"]);
  });

  it("is a query operator of its own, never a kind of IncludesNone", () => {
    const operator: IncludesNoneOrNull = new IncludesNoneOrNull(["a"]);

    expect(operator).toBeInstanceOf(QueryOperator);
    /*
     * A check written for IncludesNone that rebuilt the value as one - the
     * uuid check does, for every operator it reads - would drop the empty
     * rows again without a word.
     */
    expect(operator).not.toBeInstanceOf(IncludesNone);
  });

  it("is written for the wire under a type of its own", () => {
    expect(new IncludesNoneOrNull(["a", "b"]).toJSON()).toEqual({
      _type: "IncludesNoneOrNull",
      value: ["a", "b"],
    });
  });

  it("is read back from its JSON", () => {
    const operator: IncludesNoneOrNull = IncludesNoneOrNull.fromJSON({
      _type: "IncludesNoneOrNull",
      value: ["a", "b"],
    });

    expect(operator).toBeInstanceOf(IncludesNoneOrNull);
    expect(operator.values).toEqual(["a", "b"]);
  });

  it("is read back with no values when its JSON has none", () => {
    expect(
      IncludesNoneOrNull.fromJSON({ _type: "IncludesNoneOrNull" }).values,
    ).toEqual([]);
  });

  it("refuses JSON of another type, IncludesNone's among them", () => {
    for (const type of ["IncludesNone", "NotEqualOrNull", "InvalidType"]) {
      expect(() => {
        return IncludesNoneOrNull.fromJSON({ _type: type, value: [] });
      }).toThrow(BadDataException);
    }
  });

  it("survives a request's round trip as itself, its ids as ObjectIDs", () => {
    const result: unknown = roundTrip(
      new IncludesNoneOrNull([new ObjectID(ID), new ObjectID(OTHER_ID)]),
    );

    expect(result).toBeInstanceOf(IncludesNoneOrNull);

    const values: Array<unknown> = (result as IncludesNoneOrNull)
      .values as Array<unknown>;

    expect(values).toHaveLength(2);
    expect(values[0]).toBeInstanceOf(ObjectID);
    expect(
      values.map((value: unknown): string => {
        return String(value);
      }),
    ).toEqual([ID, OTHER_ID]);
  });

  it("survives a round trip with text and numbers as they were", () => {
    expect(
      (roundTrip(new IncludesNoneOrNull(["a", "b"])) as IncludesNoneOrNull)
        .values,
    ).toEqual(["a", "b"]);
    expect(
      (roundTrip(new IncludesNoneOrNull([3, 4])) as IncludesNoneOrNull).values,
    ).toEqual([3, 4]);
  });

  it("survives a round trip with nothing in it", () => {
    const result: unknown = roundTrip(new IncludesNoneOrNull([]));

    expect(result).toBeInstanceOf(IncludesNoneOrNull);
    expect((result as IncludesNoneOrNull).values).toEqual([]);
  });
});
