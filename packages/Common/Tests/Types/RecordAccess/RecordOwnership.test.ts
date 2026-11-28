import { JSONObject } from "../../../Types/JSON";
import RecordOwnership, {
  RecordOwnershipResult,
} from "../../../Types/RecordAccess/RecordOwnership";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO OWNS THE RECORDS ON SCREEN, AS THE SERVER SENDS IT AND THE DASHBOARD
 * READS IT (#11436, Types/RecordAccess/RecordOwnership): the ids a request
 * names, the answer's JSON both ways, and an answer that cannot be read -
 * which locks nothing more than the reader's own permissions do.
 */

const RECORD_A: string = "11436000-0000-4000-8000-0000000001a1";
const RECORD_B: string = "11436000-0000-4000-8000-0000000001a2";
const TEAM: string = "11436000-0000-4000-8000-0000000001b1";

const ANSWER: RecordOwnershipResult = {
  tableName: "Monitor",
  tables: [
    {
      tableName: "Monitor",
      key: "_id",
      operations: ["read", "update", "delete"],
    },
    {
      tableName: "MonitorOwnerUser",
      key: "monitorId",
      operations: ["create", "update", "delete"],
    },
  ],
  records: {
    [RECORD_A]: { isOwnedByCaller: true, teamIds: [] },
    [RECORD_B]: { isOwnedByCaller: false, teamIds: [TEAM] },
  },
};

describe("the ids a request names", () => {
  test("each valid id once, in lower case", () => {
    expect(
      RecordOwnership.readRequestIds({
        ids: [RECORD_A.toUpperCase(), RECORD_A, RECORD_B, "not-an-id", ""],
      }),
    ).toEqual([RECORD_A, RECORD_B]);
  });

  test("no more than a list's page: the first 200", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 250; index++) {
      many.push(
        `11436000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      );
    }

    expect(RecordOwnership.readRequestIds({ ids: many })).toEqual(
      many.slice(0, RecordOwnership.MAX_RECORDS),
    );
    expect(RecordOwnership.MAX_RECORDS).toBe(200);
  });

  test("an empty list is a list: nothing to answer", () => {
    expect(RecordOwnership.readRequestIds({ ids: [] })).toEqual([]);
  });

  test.each([
    ["no body", undefined],
    ["a body that is a list", [RECORD_A]],
    ["no ids", { monitorIds: [RECORD_A] }],
    ["ids that are no list", { ids: RECORD_A }],
    ["an id that is no text", { ids: [RECORD_A, 7] }],
  ])(
    "%s names nothing in the shape it takes",
    (_name: string, body: unknown) => {
      expect(RecordOwnership.readRequestIds(body)).toBeNull();
    },
  );
});

describe("the answer, both ways", () => {
  test("toJSON and fromJSON give back what was answered", () => {
    expect(
      RecordOwnership.fromJSON(
        JSON.parse(JSON.stringify(RecordOwnership.toJSON(ANSWER))),
      ),
    ).toEqual(ANSWER);
  });

  test("ids are read in lower case, a team id once", () => {
    const json: JSONObject = RecordOwnership.toJSON(ANSWER);
    (json["records"] as JSONObject)[RECORD_A.toUpperCase()] = {
      isOwnedByCaller: false,
      teamIds: [TEAM.toUpperCase(), TEAM],
    };

    expect(RecordOwnership.fromJSON(json)?.records[RECORD_A]).toEqual({
      isOwnedByCaller: false,
      teamIds: [TEAM],
    });
  });

  test("an operation named twice is kept once", () => {
    const json: JSONObject = {
      ...RecordOwnership.toJSON(ANSWER),
      tables: [
        { tableName: "Monitor", key: "_id", operations: ["read", "read"] },
      ],
    };

    expect(RecordOwnership.fromJSON(json)?.tables).toEqual([
      { tableName: "Monitor", key: "_id", operations: ["read"] },
    ]);
  });

  test.each([
    ["no answer", null],
    ["a list", []],
    ["no table name", { ...RecordOwnership.toJSON(ANSWER), tableName: "" }],
    [
      "tables that are no list",
      { ...RecordOwnership.toJSON(ANSWER), tables: {} },
    ],
    [
      "records that are a list",
      { ...RecordOwnership.toJSON(ANSWER), records: [] },
    ],
    [
      "an operation it does not know",
      {
        ...RecordOwnership.toJSON(ANSWER),
        tables: [{ tableName: "Monitor", key: "_id", operations: ["approve"] }],
      },
    ],
    [
      "a table without its key",
      {
        ...RecordOwnership.toJSON(ANSWER),
        tables: [{ tableName: "Monitor", operations: ["read"] }],
      },
    ],
    [
      "an owner that is no yes or no",
      {
        ...RecordOwnership.toJSON(ANSWER),
        records: { [RECORD_A]: { isOwnedByCaller: "yes", teamIds: [] } },
      },
    ],
    [
      "teams that are no list",
      {
        ...RecordOwnership.toJSON(ANSWER),
        records: { [RECORD_A]: { isOwnedByCaller: false, teamIds: TEAM } },
      },
    ],
  ])("%s cannot be read, and locks nothing", (_name: string, json: unknown) => {
    expect(RecordOwnership.fromJSON(json)).toBeNull();
  });
});

describe("what the answer says of a table and a record", () => {
  test("a table it names; none it does not", () => {
    expect(RecordOwnership.getTable(ANSWER, "MonitorOwnerUser")?.key).toBe(
      "monitorId",
    );
    expect(RecordOwnership.getTable(ANSWER, "MonitorProbe")).toBeNull();
    expect(RecordOwnership.getTable(null, "Monitor")).toBeNull();
  });

  test("a record it answers, whatever its id's case; none it leaves out", () => {
    expect(RecordOwnership.getOwners(ANSWER, RECORD_B.toUpperCase())).toEqual({
      isOwnedByCaller: false,
      teamIds: [TEAM],
    });
    expect(
      RecordOwnership.getOwners(ANSWER, "11436000-0000-4000-8000-0000000001a9"),
    ).toBeNull();
    expect(RecordOwnership.getOwners(undefined, RECORD_A)).toBeNull();
  });

  test("its route, under each kind's own API", () => {
    expect(RecordOwnership.routePath).toBe("/record-ownership");
  });
});
