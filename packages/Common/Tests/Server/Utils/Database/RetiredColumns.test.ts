import Models from "../../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import RetiredColumns, {
  RETIRED_COLUMNS,
  RetiredColumnsQuery,
} from "../../../../Server/Utils/Database/RetiredColumns";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IncludesNoneOrNull from "../../../../Types/BaseDatabase/IncludesNoneOrNull";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../../Types/BaseDatabase/LessThanOrNull";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../../Types/BaseDatabase/NotEqualOrNull";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import NotWildcard from "../../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO DELETED A RECORD, NAMED BY A REQUEST AFTER THE COLUMN WENT (#10469).
 *
 * deletedByUserId and the relation over it were on every model and nothing
 * wrote them, so 1809187480000-DropDeletedByUserColumns dropped them. A
 * client written before then still gets what it got: its select and sort
 * leave them out (and the API answers them as null), and a query reads them
 * as empty on every record. These hold the rule itself; the service and the
 * API apply it (DatabaseServiceRetiredColumns, BaseAPIRetiredColumns), and
 * RetiredColumnsPostgres holds each query operator to Postgres.
 */

const AN_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000d1";

const monitor: Monitor = new Monitor();

// A model that declares a column of a retired name: read as it declares it.
const declaresIt: { hasColumn: (name: string) => boolean } = {
  hasColumn: (name: string): boolean => {
    return name === "deletedByUserId";
  },
};

describe("the retired columns", () => {
  test("are who deleted a record, by id and by relation", () => {
    expect([...RETIRED_COLUMNS]).toEqual(["deletedByUserId", "deletedByUser"]);
  });

  test("are on no model now", () => {
    const declaring: Array<string> = [];

    for (const modelType of Models) {
      const model: DatabaseBaseModel = new modelType();

      for (const name of RETIRED_COLUMNS) {
        if (model.hasColumn(name)) {
          declaring.push(`${model.tableName}.${name}`);
        }
      }
    }

    expect(declaring).toEqual([]);
  });

  test("are retired on every model, and not on one that declares the name", () => {
    expect(RetiredColumns.isRetired(monitor, "deletedByUserId")).toBe(true);
    expect(RetiredColumns.isRetired(monitor, "deletedByUser")).toBe(true);
    expect(RetiredColumns.isRetired(new Incident(), "deletedByUser")).toBe(
      true,
    );
    expect(RetiredColumns.isRetired(monitor, "createdByUserId")).toBe(false);
    expect(RetiredColumns.isRetired(monitor, "deletedAt")).toBe(false);
    expect(RetiredColumns.isRetired(monitor, "somethingElse")).toBe(false);
    expect(RetiredColumns.isRetired(declaresIt, "deletedByUserId")).toBe(false);
  });
});

describe("a select, a sort or a write that names one", () => {
  test("names them in the order it does", () => {
    expect(
      RetiredColumns.getNamedIn(monitor, {
        deletedByUser: { name: true },
        name: true,
        deletedByUserId: true,
      }),
    ).toEqual(["deletedByUser", "deletedByUserId"]);
    expect(RetiredColumns.getNamedIn(monitor, { name: true })).toEqual([]);
  });

  test("names none in anything that is not an object of fields", () => {
    for (const value of [undefined, null, "deletedByUserId", 4, []]) {
      expect(RetiredColumns.getNamedIn(monitor, value)).toEqual([]);
    }

    expect(
      RetiredColumns.getNamedIn(monitor, ["deletedByUserId", "name"]),
    ).toEqual([]);
  });

  test("is copied without them, and the caller's own object stays as it was", () => {
    const select: JSONObject = {
      name: true,
      deletedByUserId: true,
      deletedByUser: { name: true },
    };

    const without: JSONObject = RetiredColumns.takeOut(monitor, select);

    expect(without).toEqual({ name: true });
    expect(without).not.toBe(select);
    expect(select).toEqual({
      name: true,
      deletedByUserId: true,
      deletedByUser: { name: true },
    });
  });

  test("is handed back as it is when it names none", () => {
    const sort: JSONObject = { name: "ASC" };

    expect(RetiredColumns.takeOut(monitor, sort)).toBe(sort);
    expect(RetiredColumns.takeOut(monitor, undefined)).toBeUndefined();
    expect(RetiredColumns.takeOut(monitor, null)).toBeNull();
  });

  test("keeps one on a model that declares the name", () => {
    const select: JSONObject = { deletedByUserId: true };

    expect(RetiredColumns.takeOut(declaresIt, select)).toBe(select);
  });

  test("a sort by one alone is no sort at all", () => {
    expect(
      RetiredColumns.takeOut(monitor, { deletedByUserId: "DESC" }),
    ).toEqual({});
  });
});

describe("a query's condition, read as the column empty on every record", () => {
  /*
   * What Postgres answers for a column that is NULL (QueryHelper): IS NULL,
   * and the operators that add OR <column> IS NULL, hold; a comparison with
   * a value, NOT NULL and a match do not. RetiredColumnsPostgres runs each.
   */
  const HOLDS: Array<[string, unknown]> = [
    ["no condition", undefined],
    ["null", null],
    ["IsNull", new IsNull()],
    ["EqualToOrNull", new EqualToOrNull(AN_ID)],
    ["NotEqualOrNull", new NotEqualOrNull(AN_ID)],
    ["GreaterThanOrNull", new GreaterThanOrNull(AN_ID)],
    ["LessThanOrNull", new LessThanOrNull(AN_ID)],
    ["IncludesNoneOrNull", new IncludesNoneOrNull([AN_ID])],
    ["NotContains", new NotContains("d1")],
    ["NotWildcard", new NotWildcard("*d1")],
  ];

  const HOLDS_FOR_NONE: Array<[string, unknown]> = [
    ["an id as text", AN_ID],
    ["an ObjectID", new ObjectID(AN_ID)],
    ["EqualTo", new EqualTo(AN_ID)],
    ["NotEqual", new NotEqual(AN_ID)],
    ["NotNull", new NotNull()],
    ["Includes", new Includes([AN_ID])],
    ["IncludesNone", new IncludesNone([AN_ID])],
    ["Search", new Search("d1")],
    ["StartsWith", new StartsWith("0193")],
    ["EndsWith", new EndsWith("d1")],
    ["Wildcard", new Wildcard("*d1")],
    ["GreaterThan", new GreaterThan(AN_ID)],
    ["GreaterThanOrEqual", new GreaterThanOrEqual(AN_ID)],
    ["LessThan", new LessThan(AN_ID)],
    ["LessThanOrEqual", new LessThanOrEqual(AN_ID)],
    ["InBetween", new InBetween(AN_ID, AN_ID)],
    ["a list of ids", [AN_ID]],
    ["a relation's fields", { name: "Alex" }],
    ["an empty text", ""],
    ["false", false],
  ];

  test.each(HOLDS)(
    "%s holds for every record",
    (_name: string, condition: unknown) => {
      expect(RetiredColumns.holdsForEmpty(condition)).toBe(true);
    },
  );

  test.each(HOLDS_FOR_NONE)(
    "%s holds for none",
    (_name: string, condition: unknown) => {
      expect(RetiredColumns.holdsForEmpty(condition)).toBe(false);
    },
  );

  test("reads the same as the JSON a client sends, before and after it is deserialized", () => {
    for (const [name, condition] of [...HOLDS, ...HOLDS_FOR_NONE]) {
      if (condition === undefined) {
        continue;
      }

      const json: JSONValue = JSONFunctions.serializeValue(
        condition as JSONValue,
      );

      expect([name, RetiredColumns.holdsForEmpty(json)]).toEqual([
        name,
        RetiredColumns.holdsForEmpty(condition),
      ]);
      expect([
        name,
        RetiredColumns.holdsForEmpty(JSONFunctions.deserializeValue(json)),
      ]).toEqual([name, RetiredColumns.holdsForEmpty(condition)]);
    }
  });
});

describe("a query that names one", () => {
  test("that holds for every record is the rest of the query", () => {
    const query: JSONObject = {
      name: "API",
      deletedByUserId: new IsNull() as unknown as JSONObject,
    };

    const read: RetiredColumnsQuery<JSONObject> = RetiredColumns.readQuery(
      monitor,
      query,
    );

    expect(read.matchesNothing).toBe(false);
    expect(read.query).toEqual({ name: "API" });
    // The caller's query is not changed.
    expect(Object.keys(query)).toEqual(["name", "deletedByUserId"]);
  });

  test("that holds for none matches nothing, whatever else it asks", () => {
    for (const condition of [AN_ID, new EqualTo(AN_ID), new NotNull()]) {
      const read: RetiredColumnsQuery<JSONObject> = RetiredColumns.readQuery(
        monitor,
        { name: "API", deletedByUserId: condition as unknown as JSONObject },
      );

      expect(read.matchesNothing).toBe(true);
      expect(read.query).toEqual({ name: "API" });
    }
  });

  test("on both names matches nothing when either holds for none", () => {
    expect(
      RetiredColumns.readQuery(monitor, {
        deletedByUserId: null,
        deletedByUser: { name: "Alex" },
      }).matchesNothing,
    ).toBe(true);
    expect(
      RetiredColumns.readQuery(monitor, {
        deletedByUserId: null,
        deletedByUser: null,
      }),
    ).toEqual({ query: {}, matchesNothing: false });
  });

  test("that names none is the query it was, the same object", () => {
    const query: JSONObject = { name: "API" };
    const read: RetiredColumnsQuery<JSONObject> = RetiredColumns.readQuery(
      monitor,
      query,
    );

    expect(read.query).toBe(query);
    expect(read.matchesNothing).toBe(false);
    expect(RetiredColumns.readQuery(monitor, undefined)).toEqual({
      query: undefined,
      matchesNothing: false,
    });
  });

  test("on a model that declares the name is the query it was", () => {
    const query: JSONObject = { deletedByUserId: AN_ID };

    expect(RetiredColumns.readQuery(declaresIt, query)).toEqual({
      query: query,
      matchesNothing: false,
    });
  });
});

/*
 * Through a relation, a query and a sort name the related record's fields
 * ({ project: { deletedByUserId: null } }): the related record held the
 * same nothing, one level deep as the API reads a relation.
 */
describe("a query or a sort through a relation that names one", () => {
  test("a query that holds for none there matches nothing", () => {
    for (const condition of [AN_ID, new EqualTo(AN_ID), new NotNull()]) {
      expect(
        RetiredColumns.readQuery(monitor, {
          project: { deletedByUserId: condition as unknown as JSONObject },
        }).matchesNothing,
      ).toBe(true);
    }
  });

  test("a query that holds for every record there keeps the rest of the relation's fields", () => {
    const query: JSONObject = {
      name: "API",
      project: {
        name: "Acme",
        deletedByUserId: new IsNull() as unknown as JSONObject,
      },
    };

    expect(RetiredColumns.readQuery(monitor, query)).toEqual({
      query: { name: "API", project: { name: "Acme" } },
      matchesNothing: false,
    });
    // The caller's query, and its relation's fields, are as they were.
    expect(Object.keys(query["project"] as JSONObject)).toEqual([
      "name",
      "deletedByUserId",
    ]);
  });

  test("a relation left with no field to match is no condition", () => {
    expect(
      RetiredColumns.readQuery(monitor, {
        name: "API",
        project: { deletedByUserId: null },
      }),
    ).toEqual({ query: { name: "API" }, matchesNothing: false });
  });

  test("a sort keeps the relation's other fields, and drops a relation left with none", () => {
    expect(
      RetiredColumns.takeOutOfSort(monitor, {
        project: { deletedByUserId: "ASC", name: "DESC" },
        name: "ASC",
      }),
    ).toEqual({ project: { name: "DESC" }, name: "ASC" });
    expect(
      RetiredColumns.takeOutOfSort(monitor, {
        project: { deletedByUserId: "ASC" },
      }),
    ).toEqual({});
  });

  test("an operator, an id, a field that is no relation, and a sort that names none are left as they are", () => {
    const query: JSONObject = {
      name: new Search("API") as unknown as JSONObject,
      projectId: new ObjectID(AN_ID) as unknown as JSONObject,
      customFields: { deletedByUserId: AN_ID },
    };

    expect(RetiredColumns.readQuery(monitor, query)).toEqual({
      query: query,
      matchesNothing: false,
    });

    const sort: JSONObject = { project: { name: "ASC" } };

    expect(RetiredColumns.takeOutOfSort(monitor, sort)).toBe(sort);
  });
});

describe("an answer to a select that named one", () => {
  test("answers each record's as null, as the API did", () => {
    const records: Array<JSONObject> = [
      { _id: "a", name: "API" },
      { _id: "b", name: "Web" },
    ];

    expect(
      RetiredColumns.answerAsNull(records, [
        "deletedByUserId",
        "deletedByUser",
      ]),
    ).toBe(records);
    expect(records).toEqual([
      { _id: "a", name: "API", deletedByUserId: null, deletedByUser: null },
      { _id: "b", name: "Web", deletedByUserId: null, deletedByUser: null },
    ]);
  });

  test("answers one record's too, and changes nothing when the select named none", () => {
    const record: JSONObject = { _id: "a" };

    RetiredColumns.answerAsNull(record, ["deletedByUserId"]);
    expect(record).toEqual({ _id: "a", deletedByUserId: null });

    const untouched: JSONObject = { _id: "b" };
    RetiredColumns.answerAsNull(untouched, []);
    expect(untouched).toEqual({ _id: "b" });
  });
});
