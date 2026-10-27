import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BasePermission from "../../../../Server/Types/Database/Permissions/BasePermission";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import UUIDColumnFilter, {
  EXAMPLE_UUID,
} from "../../../../Server/Types/Database/UUIDColumnFilter";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../../Types/BaseDatabase/IncludesAll";
import IncludesAnyOfGroups from "../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";
import { FindOperator, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * Production Postgres logged this about once a minute, for more than a day:
 *
 *   ERROR: invalid input syntax for type uuid: "[object Object]"
 *   STATEMENT: SELECT "Incident"."_id" ... WHERE ((("Incident"."projectId" = $1))
 *     AND ("Incident"."currentIncidentStateId" = $2)) ... LIMIT 25 OFFSET 0
 *
 * The single parentheses around currentIncidentStateId give it away: that
 * filter reached TypeORM as a plain value, not as an operator QueryUtil
 * built. A list request carried an object for the column - one the JSON
 * deserializer did not recognise, so it stayed a plain object - and the
 * column's transformer (ObjectID.toDatabase) made text of it with toString().
 * Postgres refused the statement and the API answered a 500. A rarer one
 * carried a workflow reference that never resolved:
 *
 *   invalid input syntax for type uuid: "{{local.components.monitor-find-o...
 *
 * UUIDColumnFilter is the fix, run by QueryUtil.serializeQuery: a serialized
 * ObjectID is its text, and any other value that is not an id is refused
 * with a 400 before Postgres is asked. These tests drive serializeQuery,
 * where every read's query passes. The same rules against a real Postgres
 * are in UUIDColumnFilterPostgres.test.ts.
 */

const STATE_ID: string = "5f0e8e3a-1f24-4a2f-9e4c-2b1d3c4e5f60";
const OTHER_STATE_ID: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const UNRESOLVED_REFERENCE: string =
  "{{local.components.monitor-find-one-1.returnValues.model._id}}";

type SerializeFunction = (
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
) => Record<string, any>;

const serialize: SerializeFunction = (
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
): Record<string, any> => {
  return QueryUtil.serializeQuery(modelType, query as any) as unknown as Record<
    string,
    any
  >;
};

type RefusalFunction = (
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
) => BadDataException;

// The exception serializeQuery refuses `query` with; fails when it does not.
const refusalOf: RefusalFunction = (
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
): BadDataException => {
  try {
    serialize(modelType, query);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return error as BadDataException;
  }

  throw new Error(`Expected ${JSON.stringify(query)} to be refused.`);
};

type RawSqlFunction = (operator: unknown, aliasPath: string) => string;

const rawSql: RawSqlFunction = (
  operator: unknown,
  aliasPath: string,
): string => {
  expect(operator).toBeInstanceOf(FindOperator);
  const getSql: ((aliasPath: string) => string) | undefined = (
    operator as FindOperator<unknown>
  ).getSql;

  if (!getSql) {
    throw new Error("Expected a Raw FindOperator with a SQL generator.");
  }

  return getSql(aliasPath);
};

type ParamsFunction = (operator: unknown) => Array<unknown>;

const params: ParamsFunction = (operator: unknown): Array<unknown> => {
  return Object.values(
    (
      operator as unknown as {
        objectLiteralParameters: Record<string, unknown>;
      }
    ).objectLiteralParameters,
  );
};

describe("UUIDColumnFilter.isUUIDText — the ids Postgres reads", () => {
  /*
   * uuid_in takes more than the canonical form. Every one of these is a
   * uuid Postgres answers a filter with, so refusing any of them would turn
   * a request that works today into a 400.
   */
  it.each([
    ["canonical", STATE_ID],
    ["upper case", STATE_ID.toUpperCase()],
    ["mixed case", "5F0E8E3A-1f24-4A2F-9e4c-2B1D3C4E5F60"],
    ["in braces", `{${STATE_ID}}`],
    ["without hyphens", STATE_ID.replace(/-/g, "")],
    [
      "a hyphen after every four digits",
      "5f0e-8e3a-1f24-4a2f-9e4c-2b1d-3c4e-5f60",
    ],
    ["a single hyphen", "5f0e8e3a1f24-4a2f9e4c2b1d3c4e5f60"],
    ["the zero id", "00000000-0000-0000-0000-000000000000"],
  ])("reads %s as a uuid", (_name: string, text: string) => {
    expect(UUIDColumnFilter.isUUIDText(text)).toBe(true);
  });

  it.each([
    ["empty text", ""],
    ["an object made text", "[object Object]"],
    ["an unresolved workflow reference", UNRESOLVED_REFERENCE],
    ["a leading space", ` ${STATE_ID}`],
    ["a trailing space", `${STATE_ID} `],
    ["an opening brace alone", `{${STATE_ID}`],
    ["a closing brace alone", `${STATE_ID}}`],
    ["two pairs of braces", `{{${STATE_ID}}}`],
    ["a leading hyphen", `-${STATE_ID.replace(/-/g, "")}`],
    ["a trailing hyphen", `${STATE_ID.replace(/-/g, "")}-`],
    ["two hyphens together", "5f0e8e3a--1f24-4a2f-9e4c-2b1d3c4e5f60"],
    ["a hyphen inside a group of four", "5f0e8e3a-1f2-44a2f-9e4c-2b1d3c4e5f60"],
    ["31 digits", STATE_ID.slice(0, -1)],
    ["33 digits", `${STATE_ID}0`],
    ["a digit that is not hex", STATE_ID.replace("5f0e", "5g0e")],
    ["a number made text", "42"],
    ["true made text", "true"],
  ])("refuses %s", (_name: string, text: string) => {
    expect(UUIDColumnFilter.isUUIDText(text)).toBe(false);
  });

  // A value of any length is answered at once: the length is read first.
  it("refuses a megabyte of hex digits without reading it", () => {
    const longText: string = "a".repeat(4 * 1024 * 1024);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(UUIDColumnFilter.isUUIDText(longText)).toBe(false);
      },
      limitInMs: 50,
    });
    expect(timed.inMs).toBeLessThan(50);
  });
});

describe("serializeQuery — the production request: an object for currentIncidentStateId", () => {
  /*
   * The query BaseAPI.getList hands on, from the body a client sent: a
   * plain object stays a plain object through JSONFunctions.deserialize
   * unless it is a serialized type the deserializer knows.
   */
  const deserializedQuery: (body: JSONObject) => Record<string, unknown> = (
    body: JSONObject,
  ): Record<string, unknown> => {
    return JSONFunctions.deserialize(body) as Record<string, unknown>;
  };

  it.each([
    ["a record", { _id: STATE_ID }],
    ["a record named by id", { id: STATE_ID }],
    ["an empty object", {}],
    ["a filter operator the API does not know", { $eq: STATE_ID }],
    [
      "an ObjectID with the wrong type name",
      { _type: "objectid", value: STATE_ID },
    ],
  ])(
    "refuses %s with a 400 instead of asking Postgres for the uuid [object Object]",
    (_name: string, value: JSONObject) => {
      const query: Record<string, unknown> = deserializedQuery({
        projectId: { _type: "ObjectID", value: OTHER_STATE_ID },
        currentIncidentStateId: value,
      });

      // Still a plain object here: this is what reached TypeORM before.
      expect(query["currentIncidentStateId"]).toEqual(value);

      const refusal: BadDataException = refusalOf(Incident, query);

      expect(refusal.message).toContain(
        'Invalid ID for "currentIncidentStateId"',
      );
      expect(refusal.message).toContain(EXAMPLE_UUID);
      expect(refusal.message).toContain('{"_type": "ObjectID"');
      expect(refusal.message).not.toContain("[object Object]");
    },
  );

  it("refuses the text [object Object] too", () => {
    expect(
      refusalOf(Incident, { currentIncidentStateId: "[object Object]" })
        .message,
    ).toContain('in the query: "[object Object]". An ID is a UUID');
  });

  // The rarer production error: a workflow reference left as written.
  it("refuses a workflow reference that never resolved, and repeats it", () => {
    const refusal: BadDataException = refusalOf(Incident, {
      currentIncidentStateId: UNRESOLVED_REFERENCE,
    });

    expect(refusal.message).toBe(
      `Invalid ID for "currentIncidentStateId" in the query: "${UNRESOLVED_REFERENCE}". An ID is a UUID, such as "${EXAMPLE_UUID}".`,
    );
  });

  /*
   * Through the permission pipeline every read takes (ReadPermission ->
   * BasePermission.checkPermissions -> serializeQuery), so the refusal
   * happens before DatabaseService hands anything to TypeORM.
   */
  it("is refused by the read permission pipeline before any SQL is built", async () => {
    await expect(
      BasePermission.checkPermissions(
        Incident,
        {
          projectId: new ObjectID(OTHER_STATE_ID),
          currentIncidentStateId: { _id: STATE_ID },
        } as any,
        null,
        { isRoot: true },
        DatabaseRequestType.Read,
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("cuts a long value short in the message", () => {
    const refusal: BadDataException = refusalOf(Incident, {
      currentIncidentStateId: { note: "x".repeat(1024 * 1024) },
    });

    expect(refusal.message.length).toBeLessThan(500);
    expect(refusal.message).toContain("…");
  });
});

describe("serializeQuery — a serialized ObjectID is the id it holds", () => {
  it("turns a serialized ObjectID that arrived as a plain object into its text", () => {
    expect(
      serialize(Incident, {
        currentIncidentStateId: { _type: "ObjectID", value: STATE_ID },
      })["currentIncidentStateId"],
    ).toBe(STATE_ID);
  });

  it("unwraps a serialized ObjectID wrapped in another", () => {
    expect(
      serialize(Incident, {
        currentIncidentStateId: {
          _type: "ObjectID",
          value: { _type: "ObjectID", value: STATE_ID },
        },
      })["currentIncidentStateId"],
    ).toBe(STATE_ID);
  });

  it.each([
    ["no value", { _type: "ObjectID" }],
    ["empty text", { _type: "ObjectID", value: "" }],
    ["text that is no id", { _type: "ObjectID", value: "abc" }],
    ["an object", { _type: "ObjectID", value: { _id: STATE_ID } }],
  ])(
    "refuses a serialized ObjectID holding %s",
    (_name: string, value: JSONObject) => {
      expect(
        refusalOf(Incident, { currentIncidentStateId: value }).message,
      ).toContain('Invalid ID for "currentIncidentStateId"');
    },
  );

  /*
   * EqualTo.fromJSON keeps its value as it came, so a serialized ObjectID
   * inside a serialized EqualTo stayed a plain object, and QueryHelper bound
   * the text "[object Object]".
   */
  it.each([
    ["EqualTo", EqualTo, "Incident.currentIncidentStateId = :"],
    ["NotEqual", NotEqual, "Incident.currentIncidentStateId != :"],
    ["EqualToOrNull", EqualToOrNull, "IS NULL"],
  ])(
    "binds the id, not [object Object], for a serialized ObjectID inside %s",
    (_name: string, Operator: any, sql: string) => {
      const query: Record<string, unknown> = JSONFunctions.deserialize({
        currentIncidentStateId: {
          _type: _name,
          value: { _type: "ObjectID", value: STATE_ID },
        },
      } as JSONObject) as Record<string, unknown>;

      expect(query["currentIncidentStateId"]).toBeInstanceOf(Operator);

      const result: Record<string, any> = serialize(Incident, query);

      expect(
        rawSql(
          result["currentIncidentStateId"],
          "Incident.currentIncidentStateId",
        ),
      ).toContain(sql);
      expect(params(result["currentIncidentStateId"])).toEqual([STATE_ID]);
    },
  );

  it("turns every serialized ObjectID in a list into its text", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentStateId: [
        STATE_ID,
        { _type: "ObjectID", value: OTHER_STATE_ID },
        new ObjectID(STATE_ID),
      ],
    });

    expect(
      rawSql(
        result["currentIncidentStateId"],
        "Incident.currentIncidentStateId",
      ),
    ).toContain("IN (");
    expect(params(result["currentIncidentStateId"])).toEqual([
      [STATE_ID, OTHER_STATE_ID, STATE_ID],
    ]);
  });

  /*
   * A workflow writes a record's id it refers to in quotes as the JSON of
   * what the record holds there - indented, as VMAPI writes an object into a
   * string. Postgres was asked for the uuid "{\n  "_type": "ObjectID", ...".
   */
  it("reads a serialized ObjectID written as JSON text as its text", () => {
    expect(
      serialize(Incident, {
        currentIncidentStateId: JSON.stringify(
          { _type: "ObjectID", value: STATE_ID },
          null,
          2,
        ),
      })["currentIncidentStateId"],
    ).toBe(STATE_ID);

    expect(
      serialize(Incident, {
        currentIncidentStateId: ` {"_type":"ObjectID","value":"${STATE_ID}"} `,
      })["currentIncidentStateId"],
    ).toBe(STATE_ID);
  });

  it("reads that JSON text in a list, in Includes, and given for a relation", () => {
    const text: string = JSON.stringify({ _type: "ObjectID", value: STATE_ID });

    const result: Record<string, any> = serialize(Incident, {
      currentIncidentStateId: new Includes([text]),
      incidentSeverityId: [text],
      createdByUser: text,
    });

    expect(params(result["currentIncidentStateId"])).toEqual([[STATE_ID]]);
    expect(params(result["incidentSeverityId"])).toEqual([[STATE_ID]]);
    expect(result["createdByUser"]).toBeUndefined();
    expect(result["createdByUserId"]).toBe(STATE_ID);
  });

  it.each([
    ["a record", JSON.stringify({ _id: STATE_ID })],
    [
      "an ObjectID holding text that is no id",
      JSON.stringify({ _type: "ObjectID", value: "abc" }),
    ],
    ["JSON that does not parse", `{"_type": "ObjectID", "value": ${STATE_ID}}`],
    [
      "more text than an ObjectID's JSON",
      JSON.stringify({
        _type: "ObjectID",
        value: STATE_ID,
        note: "x".repeat(2000),
      }),
    ],
  ])("refuses JSON text of %s", (_name: string, text: string) => {
    expect(
      refusalOf(Incident, { currentIncidentStateId: text }).message,
    ).toContain('Invalid ID for "currentIncidentStateId"');
  });
});

describe("serializeQuery — ids that already worked are unchanged", () => {
  it("leaves an id as a plain equality value", () => {
    expect(
      serialize(Incident, { currentIncidentStateId: STATE_ID })[
        "currentIncidentStateId"
      ],
    ).toBe(STATE_ID);
  });

  it.each([
    ["upper case", STATE_ID.toUpperCase()],
    ["in braces", `{${STATE_ID}}`],
    ["without hyphens", STATE_ID.replace(/-/g, "")],
  ])(
    "leaves an id written %s as it is, for Postgres to read",
    (_name: string, id: string) => {
      expect(
        serialize(Incident, { currentIncidentStateId: id })[
          "currentIncidentStateId"
        ],
      ).toBe(id);
    },
  );

  it("still turns an ObjectID into an equality on its id", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentStateId: new ObjectID(STATE_ID),
    });

    expect(params(result["currentIncidentStateId"])).toEqual([STATE_ID]);
  });

  it("still reads Includes, IncludesNone and IncludesAll of ids", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentStateId: new Includes([STATE_ID, OTHER_STATE_ID]),
      incidentSeverityId: new IncludesNone([new ObjectID(STATE_ID)]),
      createdByUserId: new IncludesAll([STATE_ID]),
    });

    expect(params(result["currentIncidentStateId"])).toEqual([
      [STATE_ID, OTHER_STATE_ID],
    ]);
    expect(params(result["incidentSeverityId"])).toEqual([[STATE_ID]]);
    expect(params(result["createdByUserId"])).toEqual([[STATE_ID]]);
  });

  it("still compares ids with GreaterThan and InBetween", () => {
    const result: Record<string, any> = serialize(Incident, {
      _id: new GreaterThan(STATE_ID),
      currentIncidentStateId: new InBetween(STATE_ID, OTHER_STATE_ID),
    });

    expect(params(result["_id"])).toEqual([STATE_ID]);
    expect(params(result["currentIncidentStateId"])).toEqual([
      STATE_ID,
      OTHER_STATE_ID,
    ]);
  });

  // A partial id is a text match on the id cast to text, not a uuid.
  it("leaves text matches on an id alone", () => {
    const result: Record<string, any> = serialize(Incident, {
      _id: new Search("5f0e8e3a"),
      currentIncidentStateId: new StartsWith("5f0e"),
    });

    expect(rawSql(result["_id"], "Incident._id")).toContain(
      "CAST(Incident._id AS TEXT)",
    );
    expect(params(result["_id"])).toEqual(["%5f0e8e3a%"]);
    expect(params(result["currentIncidentStateId"])).toEqual(["5f0e%"]);
  });

  it("leaves null checks alone", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentStateId: new IsNull(),
      incidentSeverityId: new NotNull(),
      createdByUserId: null,
    });

    expect(rawSql(result["currentIncidentStateId"], "x")).toBe("(x IS NULL)");
    expect(rawSql(result["incidentSeverityId"], "x")).toBe("(x IS NOT NULL)");
    expect(rawSql(result["createdByUserId"], "x")).toBe("(x IS NULL)");
  });

  it("leaves an operator QueryHelper built alone", () => {
    const built: unknown = QueryHelper.any([STATE_ID]);

    expect(
      serialize(Incident, { currentIncidentStateId: built })[
        "currentIncidentStateId"
      ],
    ).toBe(built);
  });

  /*
   * The column's transformer has always written an empty id as NULL, and no
   * row equals NULL: an empty id matched nothing rather than failing. It
   * still matches nothing, and `_id` - no transformer, so it failed in
   * Postgres - now agrees.
   */
  it.each([["currentIncidentStateId"], ["_id"]])(
    "reads an empty %s as matching no record",
    (columnName: string) => {
      const result: Record<string, any> = serialize(Incident, {
        [columnName]: "",
      });

      expect(rawSql(result[columnName], `Incident.${columnName}`)).toBe(
        "TRUE = FALSE",
      );
    },
  );

  it("is a fixpoint: a query it has made is made again unchanged", () => {
    const first: Record<string, any> = serialize(Incident, {
      currentIncidentStateId: { _type: "ObjectID", value: STATE_ID },
      incidentSeverityId: STATE_ID,
    });
    const second: Record<string, any> = serialize(Incident, { ...first });

    expect(second["currentIncidentStateId"]).toBe(STATE_ID);
    expect(second["incidentSeverityId"]).toBe(STATE_ID);
  });
});

describe("serializeQuery — anything else on a uuid column is refused", () => {
  it.each([
    ["a number", 42],
    ["true", true],
    ["a Date", new Date("2026-01-01T00:00:00Z")],
    ["a model", new Incident()],
  ])("refuses %s", (_name: string, value: unknown) => {
    expect(
      refusalOf(Incident, { currentIncidentStateId: value }).message,
    ).toContain('Invalid ID for "currentIncidentStateId"');
  });

  it("names the type of a value that is no plain object", () => {
    expect(
      refusalOf(Incident, { currentIncidentStateId: new Incident() }).message,
    ).toContain("in the query: an instance of Incident. An ID is a UUID");
  });

  it.each([
    ["an ObjectID holding no id", new ObjectID("")],
    ["an ObjectID made of an object", new ObjectID({ _id: STATE_ID } as any)],
    ["an ObjectID holding text", new ObjectID("abc")],
  ])("refuses %s", (_name: string, value: ObjectID) => {
    expect(
      refusalOf(Incident, { currentIncidentStateId: value }).message,
    ).toContain(
      `in the query: the ObjectID "${value.toString()}". An ID is a UUID`,
    );
  });

  it.each([
    ["a list", [STATE_ID, {}]],
    ["Includes", new Includes([STATE_ID, "abc"])],
    ["IncludesNone", new IncludesNone(["abc"])],
    ["IncludesAll", new IncludesAll(["abc"])],
    ["EqualTo", new EqualTo("abc")],
    ["NotEqual", new NotEqual("")],
    ["EqualToOrNull", new EqualToOrNull("[object Object]")],
    ["GreaterThan", new GreaterThan(5)],
    ["InBetween", new InBetween(STATE_ID, "abc")],
  ])("refuses an id in %s that is not one", (_name: string, value: unknown) => {
    expect(
      refusalOf(Incident, { currentIncidentStateId: value }).message,
    ).toContain('Invalid ID for "currentIncidentStateId"');
  });

  // `_id` is a uuid column like any other, though it has no transformer.
  it("refuses an object for _id", () => {
    expect(refusalOf(Monitor, { _id: { id: STATE_ID } }).message).toContain(
      'Invalid ID for "_id"',
    );
  });
});

describe("serializeQuery — the ids of a relation filter", () => {
  /*
   * An id given for a relation is written to the relation's key
   * (currentIncidentState -> currentIncidentStateId), so it is a filter on
   * a uuid column all the same.
   */
  it("writes an id given for a relation to its key, as before", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentState: STATE_ID,
    });

    expect(result["currentIncidentState"]).toBeUndefined();
    expect(result["currentIncidentStateId"]).toBe(STATE_ID);
  });

  it("writes a serialized ObjectID given for a relation to its key as its text", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentState: { _type: "ObjectID", value: STATE_ID },
    });

    expect(result["currentIncidentStateId"]).toBe(STATE_ID);
  });

  it("refuses text for a relation that is not an id", () => {
    expect(
      refusalOf(Incident, { currentIncidentState: "Resolved" }).message,
    ).toContain('Invalid ID for "currentIncidentState"');
  });

  it("holds a filter on the related records' ids to the same rule", () => {
    expect(
      refusalOf(Incident, { currentIncidentState: { _id: { id: STATE_ID } } })
        .message,
    ).toContain('Invalid ID for "currentIncidentState._id"');

    expect(
      serialize(Incident, {
        currentIncidentState: { _id: { _type: "ObjectID", value: STATE_ID } },
      })["currentIncidentState"],
    ).toEqual({ _id: STATE_ID });
  });

  it("leaves a filter on the related records' other columns alone", () => {
    expect(
      serialize(Incident, {
        currentIncidentState: { isResolvedState: true, name: "Resolved" },
      })["currentIncidentState"],
    ).toEqual({ isResolvedState: true, name: "Resolved" });
  });

  it("reads the ids of a many-to-many list, each as an id or as the record", () => {
    const result: Record<string, any> = serialize(Incident, {
      monitors: [STATE_ID, { _id: OTHER_STATE_ID }],
    });

    expect(params(result["monitors"]["_id"])).toEqual([
      [STATE_ID, OTHER_STATE_ID],
    ]);
  });

  it("reads serialized ObjectIDs in Includes on a many-to-many relation", () => {
    const result: Record<string, any> = serialize(Incident, {
      monitors: new Includes([
        { _type: "ObjectID", value: STATE_ID } as unknown as string,
      ]),
    });

    expect(params(result["monitors"]["_id"])).toEqual([[STATE_ID]]);
  });

  /*
   * A comparison on a relation compares its key, a uuid column, so it is
   * held to the rule as one: it used to pass through unread, and Postgres
   * was asked for the uuid "abc".
   */
  it.each([
    ["EqualTo", new EqualTo("abc")],
    ["NotEqual", new NotEqual("[object Object]")],
    ["EqualToOrNull", new EqualToOrNull(UNRESOLVED_REFERENCE)],
    ["GreaterThan", new GreaterThan(42)],
    ["InBetween", new InBetween(STATE_ID, "abc")],
  ])(
    "refuses an id in %s on a relation that is not one",
    (_name: string, value: unknown) => {
      expect(
        refusalOf(Incident, { currentIncidentState: value }).message,
      ).toContain('Invalid ID for "currentIncidentState" in the query');
    },
  );

  it("compares a relation with the id a serialized ObjectID holds", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentState: new NotEqual(
        JSON.stringify({ _type: "ObjectID", value: STATE_ID }),
      ),
    });

    expect(params(result["currentIncidentState"])).toEqual([STATE_ID]);
  });

  it("leaves a comparison on a relation that already worked as it was", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentState: new EqualTo(STATE_ID),
      incidentSeverity: new NotEqual(OTHER_STATE_ID.toUpperCase()),
    });

    expect(params(result["currentIncidentState"])).toEqual([STATE_ID]);
    expect(params(result["incidentSeverity"])).toEqual([
      OTHER_STATE_ID.toUpperCase(),
    ]);
  });

  it("leaves null checks and text matches on a relation alone", () => {
    const result: Record<string, any> = serialize(Incident, {
      currentIncidentState: new IsNull(),
      incidentSeverity: new NotNull(),
      createdByUser: new Search("5f0e"),
    });

    expect(rawSql(result["currentIncidentState"], "x")).toBe("(x IS NULL)");
    expect(rawSql(result["incidentSeverity"], "x")).toBe("(x IS NOT NULL)");
    expect(params(result["createdByUser"])).toEqual(["%5f0e%"]);
  });

  it.each([
    ["a list", { monitors: ["abc"] }],
    ["a list of records", { monitors: [{ name: "api" }] }],
    ["Includes", { monitors: new Includes(["abc"]) }],
    ["IncludesNone", { labels: new IncludesNone(["abc"]) }],
    ["IncludesAll", { labels: new IncludesAll([UNRESOLVED_REFERENCE]) }],
    ["IncludesAnyOfGroups", { labels: new IncludesAnyOfGroups([["abc"]]) }],
  ])(
    "refuses an id in %s on a relation that is not one",
    (_name: string, query: Record<string, unknown>) => {
      expect(refusalOf(Incident, query).message).toContain("Invalid ID for");
    },
  );
});

/*
 * The rule above refuses text that is not a uuid, which is only right for a
 * column Postgres stores as a uuid: on a text column the same value would be
 * a filter that matches nothing, not an error. Every ObjectID column of every
 * model is a uuid today; a model that stored ids as text would make the
 * refusal wrong for it, so it fails here first.
 */
describe("every ObjectID column is a Postgres uuid", () => {
  const columnArgs: Array<ColumnMetadataArgs> = getMetadataArgsStorage()
    .columns as Array<ColumnMetadataArgs>;

  /*
   * The Postgres type of a model's column, read from the TypeORM decorator
   * on the model or the class it extends (`_id` is DatabaseBaseModel's):
   * null for a property with no column, "(not declared)" for a column that
   * leaves TypeORM to guess.
   */
  const getColumnType: (
    modelType: DatabaseBaseModelType,
    propertyName: string,
  ) => string | null = (
    modelType: DatabaseBaseModelType,
    propertyName: string,
  ): string | null => {
    for (
      let target: unknown = modelType;
      target && target !== Function.prototype;
      target = Object.getPrototypeOf(target)
    ) {
      const column: ColumnMetadataArgs | undefined = columnArgs.find(
        (args: ColumnMetadataArgs) => {
          return args.target === target && args.propertyName === propertyName;
        },
      );

      if (column) {
        return column.options.type
          ? String(column.options.type)
          : "(not declared)";
      }
    }

    return null;
  };

  it("finds the ObjectID columns, so the scan itself is known to work", () => {
    const incident: BaseModel = new Incident();

    expect(incident.getTableColumnMetadata("currentIncidentStateId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(getColumnType(Incident, "currentIncidentStateId")).toBe("uuid");
    expect(getColumnType(Incident, "_id")).toBe("uuid");
  });

  it("has no ObjectID column stored as anything but a uuid", () => {
    const offenders: Array<string> = [];
    let scanned: number = 0;

    for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
      const model: BaseModel = new modelType();

      for (const columnName of model.getTableColumns().columns) {
        const column: TableColumnMetadata =
          model.getTableColumnMetadata(columnName);

        if (column?.type !== TableColumnType.ObjectID) {
          continue;
        }

        const columnType: string | null = getColumnType(modelType, columnName);

        // A property with no Postgres column is never part of a WHERE.
        if (columnType === null) {
          continue;
        }

        scanned++;

        if (columnType !== "uuid") {
          offenders.push(`${modelType.name}.${columnName} (${columnType})`);
        }
      }
    }

    expect(scanned).toBeGreaterThan(1000);
    expect(offenders).toEqual([]);
  });
});

/*
 * WRITES. A create's record and an update's data are held to the rule a
 * filter is held to (DatabaseService runs normalizeWrittenValue on each
 * column before any hook). These pin the rule itself; the paths that reach
 * it - the REST API, a workflow's steps - are in
 * Tests/Server/API/UUIDColumnApiPaths.test.ts.
 */
describe("normalizeWrittenValue - an id a write gives", () => {
  const incident: BaseModel = new Incident();

  const written: (columnName: string, value: unknown) => unknown = (
    columnName: string,
    value: unknown,
  ): unknown => {
    return UUIDColumnFilter.normalizeWrittenValue({
      columnName: columnName,
      column: incident.getTableColumnMetadata(columnName),
      value: value,
    });
  };

  // The exception a write of `value` to `columnName` is refused with.
  const writeRefusalOf: (
    columnName: string,
    value: unknown,
  ) => BadDataException = (
    columnName: string,
    value: unknown,
  ): BadDataException => {
    try {
      written(columnName, value);
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return error as BadDataException;
    }

    throw new Error(`Expected ${String(value)} to be refused.`);
  };

  describe("to an ID column", () => {
    // What Postgres reads as a uuid is written exactly as it came.
    it.each([
      ["canonical", STATE_ID],
      ["upper case", STATE_ID.toUpperCase()],
      ["in braces", `{${STATE_ID}}`],
      ["without hyphens", STATE_ID.replace(/-/g, "")],
    ])("keeps an id written %s as it came", (_name: string, id: string) => {
      expect(written("currentIncidentStateId", id)).toBe(id);
    });

    it("keeps an ObjectID as the very ObjectID it was", () => {
      const id: ObjectID = new ObjectID(STATE_ID);

      expect(written("currentIncidentStateId", id)).toBe(id);
    });

    /*
     * The JSON text is what a workflow writes for a quoted reference to a
     * record's id, and it used to reach Postgres as the uuid
     * "{\n  "_type": "ObjectID", ...".
     */
    it.each([
      ["as an object", { _type: "ObjectID", value: STATE_ID }],
      [
        "as its JSON text",
        JSON.stringify({ _type: "ObjectID", value: STATE_ID }, null, 2),
      ],
      [
        "wrapped in another",
        { _type: "ObjectID", value: { _type: "ObjectID", value: STATE_ID } },
      ],
    ])(
      "writes a serialized ObjectID sent %s as the id it holds",
      (_name: string, value: unknown) => {
        expect(written("currentIncidentStateId", value)).toBe(STATE_ID);
      },
    );

    // An empty id has always been written as NULL by the column's transformer.
    it.each([
      ["no value", undefined],
      ["a clear", null],
      ["an empty text", ""],
    ])("leaves %s as it is", (_name: string, value: unknown) => {
      expect(written("currentIncidentStateId", value)).toBe(value);
    });

    it.each([
      ["text that is no id", "abc"],
      ["an object made text", "[object Object]"],
      ["an unresolved workflow reference", UNRESOLVED_REFERENCE],
      ["a number", 42],
      ["true", true],
      ["a record", { _id: STATE_ID }],
      ["an empty object", {}],
      ["a list", [STATE_ID]],
      ["an ObjectID holding text that is no id", new ObjectID("abc")],
      ["a serialized ObjectID holding no id", { _type: "ObjectID", value: "" }],
      ["a Date", new Date("2026-01-01T00:00:00Z")],
    ])("refuses %s, naming the column", (_name: string, value: unknown) => {
      const refusal: BadDataException = writeRefusalOf(
        "currentIncidentStateId",
        value,
      );

      expect(refusal.message).toContain(
        'Invalid ID for "currentIncidentStateId" in the data:',
      );
      expect(refusal.message).toContain(EXAMPLE_UUID);
    });

    it("repeats a refused text, cut short", () => {
      expect(writeRefusalOf("currentIncidentStateId", "abc").message).toBe(
        `Invalid ID for "currentIncidentStateId" in the data: "abc". An ID is a UUID, such as "${EXAMPLE_UUID}".`,
      );
      expect(
        writeRefusalOf("currentIncidentStateId", "x".repeat(100000)).message
          .length,
      ).toBeLessThan(400);
    });

    /*
     * save() turns a create that carries an existing row's id into an update
     * of that row, so the record's own id is never rewritten - whatever it
     * holds, it is written as it came (a create may not carry one but
     * OneUptime's own).
     */
    it("never rewrites the record's own _id", () => {
      const text: string = JSON.stringify({
        _type: "ObjectID",
        value: STATE_ID,
      });
      const id: ObjectID = new ObjectID(STATE_ID);

      expect(written("_id", text)).toBe(text);
      expect(written("_id", id)).toBe(id);
      expect(written("_id", "abc")).toBe("abc");
    });

    it("leaves a column that holds no id alone", () => {
      expect(written("title", "abc")).toBe("abc");
      expect(written("title", "[object Object]")).toBe("[object Object]");
      expect(written("isVisibleOnStatusPage", "abc")).toBe("abc");
    });
  });

  describe("to a relation", () => {
    it("keeps a record named by an id, or as a record with one, as it came", () => {
      const record: JSONObject = { _id: STATE_ID, name: "Acknowledged" };
      const model: BaseModel = new Incident();
      model._id = OTHER_STATE_ID;

      const list: Array<unknown> = [STATE_ID, record, model];

      expect(written("currentIncidentState", STATE_ID)).toBe(STATE_ID);
      expect(written("currentIncidentState", record)).toBe(record);
      expect(record).toEqual({ _id: STATE_ID, name: "Acknowledged" });
      // The very list, when nothing in it was written another way.
      expect(written("monitors", list)).toBe(list);
      expect(list).toEqual([STATE_ID, record, model]);
      expect(model._id).toBe(OTHER_STATE_ID);
    });

    it("writes a serialized ObjectID it names a record by as the id it holds", () => {
      const text: string = JSON.stringify({
        _type: "ObjectID",
        value: STATE_ID,
      });
      const record: JSONObject = { _id: text };
      const plain: JSONObject = { id: { _type: "ObjectID", value: STATE_ID } };

      expect(written("currentIncidentState", text)).toBe(STATE_ID);
      expect(written("monitors", [record, plain])).toEqual([
        { _id: STATE_ID },
        { id: STATE_ID },
      ]);
    });

    // A record with no id - one the write itself would create - names none.
    it("leaves a record given with no id alone", () => {
      const record: JSONObject = { name: "Acknowledged" };

      expect(written("currentIncidentState", record)).toBe(record);
      expect(written("monitors", [record, null, ""])).toEqual([
        record,
        null,
        "",
      ]);
    });

    it.each([
      ["currentIncidentState", "Resolved"],
      ["currentIncidentState", { _id: "abc" }],
      ["currentIncidentState", { id: "[object Object]" }],
      ["currentIncidentState", new ObjectID("abc")],
      ["monitors", [STATE_ID, "abc"]],
      ["monitors", [{ _id: UNRESOLVED_REFERENCE }]],
    ])(
      "refuses %s naming a record by %p, naming the relation",
      (columnName: string, value: unknown) => {
        expect(writeRefusalOf(columnName, value).message).toContain(
          `Invalid ID for "${columnName}" in the data:`,
        );
      },
    );

    /*
     * A write may take a plain record's `id` rather than its `_id`
     * (DatabaseService.sanitizeCreateOrUpdate takes a text `id` when `_id`
     * is not text), so both are read.
     */
    it("reads a plain record's id as well as its _id", () => {
      const record: JSONObject = {
        _id: new ObjectID(STATE_ID) as unknown as string,
        id: OTHER_STATE_ID,
      };

      expect(written("monitors", [record])).toEqual([record]);
      expect(
        writeRefusalOf("monitors", [{ _id: STATE_ID, id: "abc" }]).message,
      ).toContain('Invalid ID for "monitors" in the data: "abc". An ID is');
    });

    it("refuses a model whose _id is no id", () => {
      const model: BaseModel = new Incident();
      model._id = "abc";

      expect(writeRefusalOf("monitors", [model]).message).toContain(
        'Invalid ID for "monitors" in the data: "abc". An ID is',
      );
    });
  });
});
