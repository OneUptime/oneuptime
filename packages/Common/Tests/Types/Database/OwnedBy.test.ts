import OwnedBy, {
  MAX_OWNED_BY_IDS,
  OWNED_BY_QUERY_KEY,
  OwnedByMatch,
} from "../../../Types/BaseDatabase/OwnedBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import SerializableObjectDictionary from "../../../Types/SerializableObjectDictionary";
import { describe, expect, test } from "@jest/globals";

/*
 * THE OWNERS FILTER (OwnedBy) AS IT TRAVELS: what a list's Owner chip puts in
 * its query, what the API takes as JSON, and what it refuses before anything
 * is read. The SQL it becomes is QueryHelperOwnedBy's; which records it
 * matches against a real database, OwnedByFilterPostgres's.
 */

const ADA: string = "0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60";
const GRACE: string = "1e5dac3f-7b40-4f2e-8c8b-3d6f9a2b4c71";
const SRE_TEAM: string = "2f6ebd40-8c51-4a3f-9d9c-4e7a0b3c5d82";
const PAYMENTS_TEAM: string = "3a7fce51-9d62-4b40-8eaa-5f8b1c4d6e93";

// How a refused team id is told, whatever the id was.
const INVALID_TEAM_ID_MESSAGE: RegExp =
  /^Invalid ID for "owners\.teamIds" in the query: .+\. An ID is a UUID, such as "550e8400-e29b-41d4-a716-446655440000"\.$/;

// What constructing it throws, or undefined.
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

describe("OwnedBy - a filter by the people and teams that own a record", () => {
  test("names people and teams, and matches any of them unless told otherwise", () => {
    const filter: OwnedBy = new OwnedBy({
      userIds: [ADA],
      teamIds: [SRE_TEAM],
    });

    expect(filter.match).toBe(OwnedByMatch.AnyOf);
    expect(filter.userIds).toEqual([ADA]);
    expect(filter.teamIds).toEqual([SRE_TEAM]);
  });

  test("takes ObjectIDs as well as text, and names each owner once", () => {
    const filter: OwnedBy = new OwnedBy({
      userIds: [new ObjectID(ADA), ADA, ADA.toUpperCase(), GRACE],
      teamIds: [new ObjectID(SRE_TEAM), SRE_TEAM],
    });

    expect(filter.userIds).toEqual([ADA, GRACE]);
    expect(filter.teamIds).toEqual([SRE_TEAM]);
  });

  test("owns its lists: changing what it was given or handed back changes nothing", () => {
    const userIds: Array<string> = [ADA];
    const filter: OwnedBy = new OwnedBy({ userIds: userIds });

    userIds.push(GRACE);
    filter.userIds.push(GRACE);
    (filter.toJSON()["userIds"] as Array<string>).push(GRACE);

    expect(filter.userIds).toEqual([ADA]);
  });

  test.each([
    [OwnedByMatch.AnyOf, { userIds: [ADA] }],
    [OwnedByMatch.AnyOf, { teamIds: [SRE_TEAM] }],
    [OwnedByMatch.NoneOf, { userIds: [ADA], teamIds: [PAYMENTS_TEAM] }],
    [OwnedByMatch.AnyOwner, {}],
    [OwnedByMatch.NoOwner, {}],
  ] as Array<[OwnedByMatch, JSONObject]>)(
    "%s round trips through the API's JSON",
    (match: OwnedByMatch, owners: JSONObject) => {
      const filter: OwnedBy = new OwnedBy({ ...owners, match: match });
      const serialized: JSONObject = JSONFunctions.serialize({
        [OWNED_BY_QUERY_KEY]: filter,
      });

      expect(serialized[OWNED_BY_QUERY_KEY]).toEqual({
        _type: ObjectType.OwnedBy,
        match: match,
        userIds: owners["userIds"] || [],
        teamIds: owners["teamIds"] || [],
      });

      // As the request body reaches the server: plain JSON, then rebuilt.
      const deserialized: JSONObject = JSONFunctions.deserialize(
        JSON.parse(JSON.stringify(serialized)),
      ) as JSONObject;
      const rebuilt: OwnedBy = deserialized[OWNED_BY_QUERY_KEY] as OwnedBy;

      expect(rebuilt).toBeInstanceOf(OwnedBy);
      expect(rebuilt.match).toBe(match);
      expect(rebuilt.userIds).toEqual(filter.userIds);
      expect(rebuilt.teamIds).toEqual(filter.teamIds);
    },
  );

  test("is registered for the API's JSON, so a request's filter is never a plain object", () => {
    expect(Object.values(ObjectType)).toContain("OwnedBy");
    expect(SerializableObjectDictionary[ObjectType.OwnedBy]).toBe(OwnedBy);
  });

  test("reads the API's JSON as a person writes it: no match is any of them", () => {
    const rebuilt: OwnedBy = OwnedBy.fromJSON({
      _type: ObjectType.OwnedBy,
      teamIds: [SRE_TEAM, PAYMENTS_TEAM],
    });

    expect(rebuilt.match).toBe(OwnedByMatch.AnyOf);
    expect(rebuilt.userIds).toEqual([]);
    expect(rebuilt.teamIds).toEqual([SRE_TEAM, PAYMENTS_TEAM]);
  });

  test("reads ids sent as serialized ObjectIDs too", () => {
    const rebuilt: OwnedBy = OwnedBy.fromJSON({
      _type: ObjectType.OwnedBy,
      userIds: [new ObjectID(ADA).toJSON()],
    });

    expect(rebuilt.userIds).toEqual([ADA]);
  });

  test("toString is its JSON, so a table notices when its owners change", () => {
    const first: string = JSON.stringify({
      owners: new OwnedBy({ teamIds: [SRE_TEAM] }),
    });
    const same: string = JSON.stringify({
      owners: new OwnedBy({ teamIds: [SRE_TEAM] }),
    });
    const other: string = JSON.stringify({
      owners: new OwnedBy({ teamIds: [PAYMENTS_TEAM] }),
    });

    expect(first).toBe(same);
    expect(first).not.toBe(other);
    expect(new OwnedBy({ teamIds: [SRE_TEAM] }).toString()).toContain(
      SRE_TEAM,
    );
  });

  describe("refused before anything is read", () => {
    test.each([OwnedByMatch.AnyOf, OwnedByMatch.NoneOf])(
      "%s with nobody named",
      (match: OwnedByMatch) => {
        const error: Error | undefined = errorOf(() => {
          return new OwnedBy({ match: match, userIds: [], teamIds: [] });
        });

        expect(error).toBeInstanceOf(BadDataException);
        expect(error?.message).toBe(
          `"owners" with match ${match} names at least one person (userIds) or team (teamIds).`,
        );
      },
    );

    test.each([OwnedByMatch.AnyOwner, OwnedByMatch.NoOwner])(
      "%s with people or teams named",
      (match: OwnedByMatch) => {
        for (const owners of [{ userIds: [ADA] }, { teamIds: [SRE_TEAM] }]) {
          const error: Error | undefined = errorOf(() => {
            return new OwnedBy({ match: match, ...owners });
          });

          expect(error).toBeInstanceOf(BadDataException);
          expect(error?.message).toBe(
            `"owners" with match ${match} asks whether a record has owners at all, so it names no people or teams.`,
          );
        }
      },
    );

    test("a match that is none of the four", () => {
      const error: Error | undefined = errorOf(() => {
        return OwnedBy.fromJSON({
          _type: ObjectType.OwnedBy,
          match: "AllOf",
          userIds: [ADA],
        });
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(
        'Invalid match for "owners" in the query: "AllOf". It is one of AnyOf, NoneOf, AnyOwner, NoOwner.',
      );
    });

    test.each([
      ["not a uuid", "monitor-1"],
      ["empty", ""],
      ["a number", 42],
      ["an object", { _id: ADA }],
      ["a reference a workflow left unresolved", "{{local.variables.teamId}}"],
    ] as Array<[string, unknown]>)(
      "an id that is %s, named in the words every ID filter uses",
      (_case: string, id: unknown) => {
        const error: Error | undefined = errorOf(() => {
          return OwnedBy.fromJSON({
            _type: ObjectType.OwnedBy,
            teamIds: [SRE_TEAM, id as string],
          });
        });

        expect(error).toBeInstanceOf(BadDataException);
        expect(error?.message).toMatch(INVALID_TEAM_ID_MESSAGE);
      },
    );

    test("a list of ids that is no list", () => {
      const error: Error | undefined = errorOf(() => {
        return OwnedBy.fromJSON({
          _type: ObjectType.OwnedBy,
          userIds: ADA,
        });
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(
        '"userIds" of "owners" in the query is a list of IDs.',
      );
    });

    test("a refused id is repeated only in part, however long it is", () => {
      const error: Error | undefined = errorOf(() => {
        return new OwnedBy({ userIds: ["x".repeat(100000)] });
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error!.message.length).toBeLessThan(300);
    });

    test(`more than ${MAX_OWNED_BY_IDS} people and teams together`, () => {
      const ids: Array<string> = Array.from(
        { length: MAX_OWNED_BY_IDS + 1 },
        () => {
          return ObjectID.generate().toString();
        },
      );

      const error: Error | undefined = errorOf(() => {
        return new OwnedBy({
          userIds: ids.slice(0, 600),
          teamIds: ids.slice(600),
        });
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(
        `"owners" names at most ${MAX_OWNED_BY_IDS} people and teams together.`,
      );

      // Exactly the limit is fine.
      expect(
        new OwnedBy({
          userIds: ids.slice(0, 600),
          teamIds: ids.slice(600, MAX_OWNED_BY_IDS),
        }).teamIds,
      ).toHaveLength(MAX_OWNED_BY_IDS - 600);
    });

    test("JSON of another type", () => {
      expect(
        errorOf(() => {
          return OwnedBy.fromJSON({ _type: ObjectType.Includes, value: [] });
        }),
      ).toBeInstanceOf(BadDataException);
    });
  });
});
