import LinkedTo, {
  LINKED_TO_QUERY_KEY,
  LinkedToMatch,
  MAX_LINKED_TO_IDS,
  MAX_LINKED_TO_RELATIONS,
} from "../../../Types/BaseDatabase/LinkedTo";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import SerializableObjectDictionary from "../../../Types/SerializableObjectDictionary";
import { describe, expect, test } from "@jest/globals";

/*
 * THE LINKED-RECORDS FILTER (LinkedTo) AS IT TRAVELS (#11073): what a
 * list's Affected Resources chip puts in its query, what the API takes as
 * JSON, and what it refuses before anything is read. The SQL it becomes is
 * QueryUtilLinkedTo's; which records it matches on a real database,
 * AffectedResourceFilterPostgres's.
 */

const CHECKOUT_MONITOR: string = "6b1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const API_MONITOR: string = "7c2e3f40-5b6c-4d7e-9f80-1b2c3d4e5f60";
const WEB_HOST: string = "8d3f4051-6c7d-4e8f-a091-2c3d4e5f6071";

// How a refused id is told, whatever the id was.
const INVALID_ID_MESSAGE: RegExp =
  /^Invalid ID for "linkedTo\.monitors" in the query: .+\. An ID is a UUID, such as "550e8400-e29b-41d4-a716-446655440000"\.$/;

// What building it throws, or undefined.
const errorOf: (build: () => unknown) => Error | undefined = (
  build: () => unknown,
): Error | undefined => {
  try {
    build();
  } catch (error) {
    return error as Error;
  }

  return undefined;
};

// `count` distinct ids, in order.
const ids: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `11073000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  });
};

describe("LinkedTo - a filter by the records a record is linked to", () => {
  test("names each relation's records, and matches any of them unless told otherwise", () => {
    const filter: LinkedTo = new LinkedTo({
      relations: { monitors: [CHECKOUT_MONITOR], hosts: [WEB_HOST] },
    });

    expect(filter.match).toBe(LinkedToMatch.AnyOf);
    expect(filter.relations).toEqual({
      monitors: [CHECKOUT_MONITOR],
      hosts: [WEB_HOST],
    });
  });

  test("takes ObjectIDs as well as text, and names each record once, in lower case", () => {
    const filter: LinkedTo = new LinkedTo({
      relations: {
        monitors: [
          new ObjectID(CHECKOUT_MONITOR),
          CHECKOUT_MONITOR,
          CHECKOUT_MONITOR.toUpperCase(),
          API_MONITOR,
        ],
      },
    });

    expect(filter.relations).toEqual({
      monitors: [CHECKOUT_MONITOR, API_MONITOR],
    });
  });

  test("a relation named with no records is left out", () => {
    const filter: LinkedTo = new LinkedTo({
      relations: { monitors: [CHECKOUT_MONITOR], hosts: [] },
    });

    expect(Object.keys(filter.relations)).toEqual(["monitors"]);
  });

  test("owns its lists: changing what it was given or handed back changes nothing", () => {
    const monitors: Array<string> = [CHECKOUT_MONITOR];
    const filter: LinkedTo = new LinkedTo({ relations: { monitors } });

    monitors.push(API_MONITOR);
    filter.relations["monitors"]!.push(API_MONITOR);
    (
      (filter.toJSON()["relations"] as JSONObject)["monitors"] as Array<string>
    ).push(API_MONITOR);

    expect(filter.relations).toEqual({ monitors: [CHECKOUT_MONITOR] });
  });

  test("NoneOf matches the records linked to none of them", () => {
    expect(
      new LinkedTo({
        match: LinkedToMatch.NoneOf,
        relations: { monitors: [CHECKOUT_MONITOR] },
      }).match,
    ).toBe(LinkedToMatch.NoneOf);
  });
});

describe("what a LinkedTo refuses, before anything is read", () => {
  test("a filter naming no record at all", () => {
    for (const relations of [
      {},
      { monitors: [] },
      { monitors: [], hosts: [] },
    ]) {
      const error: Error | undefined = errorOf(() => {
        return new LinkedTo({ relations });
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(
        `"${LINKED_TO_QUERY_KEY}" in the query names at least one record, through one relation.`,
      );
    }
  });

  test("relations that are not a map of relation to ids", () => {
    for (const relations of [null, undefined, [], "monitors", 7]) {
      expect(
        errorOf(() => {
          return new LinkedTo({ relations: relations as never });
        })?.message,
      ).toBe(
        `"linkedTo" in the query names its relations, each with the IDs it should reach.`,
      );
    }
  });

  test("an id that is no id, told as every ID filter tells it", () => {
    for (const bad of ["not-an-id", "", "1; DROP TABLE", 7, null, {}]) {
      const error: Error | undefined = errorOf(() => {
        return new LinkedTo({
          relations: { monitors: [bad as never] },
        });
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toMatch(INVALID_ID_MESSAGE);
    }
  });

  test("a relation's ids that are not a list", () => {
    expect(
      errorOf(() => {
        return new LinkedTo({
          relations: { monitors: CHECKOUT_MONITOR as never },
        });
      })?.message,
    ).toBe(`"monitors" of "linkedTo" in the query is a list of IDs.`);
  });

  test("a relation that is not a column's name", () => {
    for (const relation of [
      "monitors; DROP TABLE",
      'monitors"',
      "monitors.name",
      "_id",
      "1monitors",
      "",
    ]) {
      const error: Error | undefined = errorOf(() => {
        return new LinkedTo({ relations: { [relation]: [CHECKOUT_MONITOR] } });
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toMatch(
        /^Invalid relation for "linkedTo" in the query: .*\. A relation is a column of the record, such as "monitors"\.$/,
      );
    }
  });

  test("a match it does not know", () => {
    expect(
      errorOf(() => {
        return new LinkedTo({
          match: "AllOf" as LinkedToMatch,
          relations: { monitors: [CHECKOUT_MONITOR] },
        });
      })?.message,
    ).toBe(
      `Invalid match for "linkedTo" in the query: "AllOf". It is one of AnyOf, NoneOf.`,
    );
  });

  test(`up to ${MAX_LINKED_TO_IDS} records, every relation together`, () => {
    const all: Array<string> = ids(MAX_LINKED_TO_IDS);

    expect(
      errorOf(() => {
        return new LinkedTo({
          relations: {
            monitors: all.slice(0, 600),
            hosts: all.slice(600),
          },
        });
      }),
    ).toBeUndefined();

    expect(
      errorOf(() => {
        return new LinkedTo({
          relations: {
            monitors: all.slice(0, 600),
            hosts: [...all.slice(600), ids(MAX_LINKED_TO_IDS + 1).pop()!],
          },
        });
      })?.message,
    ).toBe(
      `"linkedTo" names at most ${MAX_LINKED_TO_IDS} records, every relation together.`,
    );
  });

  test("a record named twice counts once toward the most", () => {
    const all: Array<string> = ids(MAX_LINKED_TO_IDS);

    expect(
      errorOf(() => {
        return new LinkedTo({ relations: { monitors: [...all, ...all] } });
      }),
    ).toBeUndefined();
  });

  test(`up to ${MAX_LINKED_TO_RELATIONS} relations`, () => {
    const relations: Record<string, Array<string>> = {};

    for (let index: number = 0; index <= MAX_LINKED_TO_RELATIONS; index++) {
      relations[`relation${index}`] = [CHECKOUT_MONITOR];
    }

    expect(
      errorOf(() => {
        return new LinkedTo({ relations });
      })?.message,
    ).toBe(`"linkedTo" names at most ${MAX_LINKED_TO_RELATIONS} relations.`);
  });
});

describe("a LinkedTo on the wire", () => {
  test("is written with its type, its match and its relations", () => {
    expect(
      new LinkedTo({
        match: LinkedToMatch.NoneOf,
        relations: { monitorId: [CHECKOUT_MONITOR] },
      }).toJSON(),
    ).toEqual({
      _type: ObjectType.LinkedTo,
      match: LinkedToMatch.NoneOf,
      relations: { monitorId: [CHECKOUT_MONITOR] },
    });
  });

  test("comes back as itself through the query's serializer, as ModelAPI sends it and the API reads it", () => {
    const query: JSONObject = {
      projectId: new ObjectID(API_MONITOR),
      [LINKED_TO_QUERY_KEY]: new LinkedTo({
        relations: {
          monitors: [CHECKOUT_MONITOR, API_MONITOR],
          hosts: [WEB_HOST],
        },
      }),
    } as unknown as JSONObject;

    const sent: JSONObject = JSON.parse(
      JSON.stringify(JSONFunctions.serialize(query)),
    ) as JSONObject;
    const read: JSONObject = JSONFunctions.deserialize(sent);
    const filter: unknown = read[LINKED_TO_QUERY_KEY];

    expect(filter).toBeInstanceOf(LinkedTo);
    expect((filter as LinkedTo).match).toBe(LinkedToMatch.AnyOf);
    expect((filter as LinkedTo).relations).toEqual({
      monitors: [CHECKOUT_MONITOR, API_MONITOR],
      hosts: [WEB_HOST],
    });
  });

  test("is found by its type in the dictionary every serialized value is read through", () => {
    expect(SerializableObjectDictionary[ObjectType.LinkedTo]).toBe(LinkedTo);
  });

  test("reads ObjectIDs as they are serialized", () => {
    const filter: LinkedTo = LinkedTo.fromJSON({
      _type: ObjectType.LinkedTo,
      relations: {
        monitors: [
          { _type: ObjectType.ObjectID, value: CHECKOUT_MONITOR },
        ] as unknown as Array<string>,
      },
    });

    expect(filter.relations).toEqual({ monitors: [CHECKOUT_MONITOR] });
    expect(filter.match).toBe(LinkedToMatch.AnyOf);
  });

  test("refuses JSON of another type, or with no relations", () => {
    expect(
      errorOf(() => {
        return LinkedTo.fromJSON({ _type: ObjectType.OwnedBy, relations: {} });
      }),
    ).toBeInstanceOf(BadDataException);

    for (const relations of [undefined, null, [], "monitors"]) {
      expect(
        errorOf(() => {
          return LinkedTo.fromJSON({
            _type: ObjectType.LinkedTo,
            relations: relations as never,
          });
        })?.message,
      ).toBe(
        `"linkedTo" in the query names its relations, each with the IDs it should reach.`,
      );
    }
  });

  test("refuses a relation whose ids are not a list, as JSON", () => {
    expect(
      errorOf(() => {
        return LinkedTo.fromJSON({
          _type: ObjectType.LinkedTo,
          relations: { monitors: CHECKOUT_MONITOR },
        });
      })?.message,
    ).toBe(`"monitors" of "linkedTo" in the query is a list of IDs.`);
  });
});
