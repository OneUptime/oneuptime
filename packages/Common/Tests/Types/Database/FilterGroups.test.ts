import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import FilterGroups, {
  FILTER_GROUPS_QUERY_KEY,
  FilterGroup,
  FilterGroupsMatch,
  MAX_FILTER_GROUP_COLUMNS,
  MAX_FILTER_GROUPS,
} from "../../../Types/BaseDatabase/FilterGroups";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNoneOrNull from "../../../Types/BaseDatabase/IncludesNoneOrNull";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LinkedTo from "../../../Types/BaseDatabase/LinkedTo";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../Types/BaseDatabase/NotEqualOrNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import OwnedBy from "../../../Types/BaseDatabase/OwnedBy";
import Search from "../../../Types/BaseDatabase/Search";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import SerializableObjectDictionary from "../../../Types/SerializableObjectDictionary";
import { describe, expect, test } from "@jest/globals";

/*
 * THE FILTER OF SEVERAL GROUPS (FilterGroups) AS IT TRAVELS (#11211): what
 * a list's status chip puts in its query - a database's engine metrics, an
 * App Platforms environment's status, each read from two columns - what the
 * API takes as JSON, and what it refuses before anything is read. The SQL
 * it becomes is QueryUtilFilterGroups'; which records it matches on a real
 * database, ListFiltersPastTheCapPostgres's.
 */

const PROJECT_ID: string = "7d0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b";

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

// A database's three engine-metrics statuses, as the Databases chip asks for them.
const CONNECTED: FilterGroup = { otelCollectorStatus: "connected" };
const DISCONNECTED: FilterGroup = {
  otelCollectorStatus: new NotEqualOrNull("connected"),
  collectorLastSeenAt: new NotNull(),
};
const NOT_CONNECTED: FilterGroup = {
  otelCollectorStatus: new NotEqualOrNull("connected"),
  collectorLastSeenAt: new IsNull(),
};

describe("FilterGroups - the records one of several filters matches", () => {
  test("holds its groups, and matches any of them unless told otherwise", () => {
    const filter: FilterGroups = new FilterGroups({
      groups: [CONNECTED, NOT_CONNECTED],
    });

    expect(filter.match).toBe(FilterGroupsMatch.AnyOf);
    expect(filter.groups).toHaveLength(2);
    expect(filter.groups[0]).toEqual({ otelCollectorStatus: "connected" });
    expect(filter.groups[1]!["otelCollectorStatus"]).toBeInstanceOf(
      NotEqualOrNull,
    );
    expect(filter.groups[1]!["collectorLastSeenAt"]).toBeInstanceOf(IsNull);
  });

  test("NoneOf: the records no group matches", () => {
    expect(
      new FilterGroups({
        match: FilterGroupsMatch.NoneOf,
        groups: [CONNECTED],
      }).match,
    ).toBe(FilterGroupsMatch.NoneOf);
  });

  test("names every column a group compares, each once, in the order named", () => {
    expect(
      new FilterGroups({ groups: [CONNECTED, DISCONNECTED, NOT_CONNECTED] })
        .columns,
    ).toEqual(["otelCollectorStatus", "collectorLastSeenAt"]);
  });

  test("hands out copies: changing what it gave back changes nothing", () => {
    const filter: FilterGroups = new FilterGroups({ groups: [CONNECTED] });

    filter.groups[0]!["otelCollectorStatus"] = "disconnected";
    delete filter.groups[0]!["otelCollectorStatus"];

    expect(filter.groups).toEqual([{ otelCollectorStatus: "connected" }]);
  });

  test("keeps no group it was handed: changing the group afterwards changes nothing", () => {
    const group: FilterGroup = { otelCollectorStatus: "connected" };
    const filter: FilterGroups = new FilterGroups({ groups: [group] });

    group["otelCollectorStatus"] = "disconnected";
    group["name"] = "orders";

    expect(filter.groups).toEqual([{ otelCollectorStatus: "connected" }]);
  });

  test.each([
    ["text", "connected"],
    ["a number", 5432],
    ["a switch", false],
    ["an id", new ObjectID(PROJECT_ID)],
    ["EqualTo", new EqualTo("connected")],
    ["EqualToOrNull", new EqualToOrNull("disconnected")],
    ["NotEqual", new NotEqual("connected")],
    ["NotEqualOrNull", new NotEqualOrNull("connected")],
    ["IsNull", new IsNull()],
    ["NotNull", new NotNull()],
    ["Includes", new Includes(["connected", "disconnected"])],
    ["IncludesNoneOrNull", new IncludesNoneOrNull(["connected"])],
  ])("compares a column with %s", (_case: string, value: unknown) => {
    const filter: FilterGroups = new FilterGroups({
      groups: [{ otelCollectorStatus: value as never }],
    });

    expect(filter.groups[0]!["otelCollectorStatus"]).toBe(value);
  });

  test.each([
    ["nothing", undefined],
    ["null (IsNull says it)", null],
    ["a list (Includes says it)", ["connected"]],
    ["a filter on a related record", { name: "checkout" }],
    ["a number that is no number", Number.NaN],
    ["an endless number", Number.POSITIVE_INFINITY],
    ["a search", new Search("conn")],
    ["a comparison it does not hold", new GreaterThan(5)],
    ["a filter by owners", new OwnedBy({ userIds: [PROJECT_ID] })],
    [
      "a filter by linked records",
      new LinkedTo({ relations: { monitors: [PROJECT_ID] } }),
    ],
    [
      "a filter of several groups",
      new FilterGroups({ groups: [{ otelCollectorStatus: "connected" }] }),
    ],
    [
      "a multi-field search",
      new MultiSearch({ fields: ["name"], value: "orders" }),
    ],
    ["a date", new Date()],
  ])("refuses to compare a column with %s", (_case: string, value: unknown) => {
    const error: Error | undefined = errorOf(() => {
      return new FilterGroups({
        groups: [{ otelCollectorStatus: value as never }],
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      `"otelCollectorStatus" of "filterGroups" in the query compares the column with a value (text, a number, true or false, an ID) or with EqualTo, EqualToOrNull, NotEqual, NotEqualOrNull, IsNull, NotNull, Includes or IncludesNoneOrNull.`,
    );
  });

  test.each([
    ["no groups", []],
    ["groups that are no list", { otelCollectorStatus: "connected" }],
    ["nothing", undefined],
  ])("refuses %s", (_case: string, groups: unknown) => {
    expect(
      errorOf(() => {
        return new FilterGroups({ groups: groups as never });
      })?.message,
    ).toBe(`"filterGroups" in the query holds at least one group of filters.`);
  });

  test.each([
    ["a list", [CONNECTED]],
    ["text", "connected"],
    ["nothing", null],
    ["an operator", new IsNull()],
    ["an id", new ObjectID(PROJECT_ID)],
  ])("refuses a group that is %s", (_case: string, group: unknown) => {
    expect(
      errorOf(() => {
        return new FilterGroups({ groups: [CONNECTED, group as never] });
      })?.message,
    ).toBe(
      `Group 2 of "filterGroups" in the query is a filter: each column with what it must hold.`,
    );
  });

  test("refuses a group that names no column", () => {
    expect(
      errorOf(() => {
        return new FilterGroups({ groups: [{}] });
      })?.message,
    ).toBe(`Group 1 of "filterGroups" in the query names no column.`);
  });

  test.each([
    ["a relation's column", "monitor.name"],
    ["a quoted name", 'name"; DROP TABLE "Monitor'],
    ["an underscore first", "_id"],
    ["a space", "otel collector status"],
    ["a digit first", "1name"],
    ["an empty name", ""],
  ])("refuses %s as a column", (_case: string, column: string) => {
    const error: Error | undefined = errorOf(() => {
      return new FilterGroups({ groups: [{ [column]: "connected" }] });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toMatch(
      /^Invalid column for "filterGroups" in the query: .*\. A column is one of the record's own, such as "name"\.$/,
    );
  });

  test(`holds at most ${MAX_FILTER_GROUPS} groups`, () => {
    const groups: Array<FilterGroup> = Array.from(
      { length: MAX_FILTER_GROUPS },
      (): FilterGroup => {
        return { ...CONNECTED };
      },
    );

    expect(new FilterGroups({ groups }).groups).toHaveLength(MAX_FILTER_GROUPS);
    expect(
      errorOf(() => {
        return new FilterGroups({ groups: [...groups, CONNECTED] });
      })?.message,
    ).toBe(`"filterGroups" holds at most ${MAX_FILTER_GROUPS} groups.`);
  });

  test(`names at most ${MAX_FILTER_GROUP_COLUMNS} columns in a group`, () => {
    const group: FilterGroup = {};

    for (let index: number = 0; index < MAX_FILTER_GROUP_COLUMNS; index++) {
      group[`column${index}`] = "x";
    }

    expect(
      Object.keys(new FilterGroups({ groups: [group] }).groups[0]!),
    ).toHaveLength(MAX_FILTER_GROUP_COLUMNS);

    group["oneTooMany"] = "x";

    expect(
      errorOf(() => {
        return new FilterGroups({ groups: [group] });
      })?.message,
    ).toBe(
      `A group of "filterGroups" names at most ${MAX_FILTER_GROUP_COLUMNS} columns.`,
    );
  });

  test("refuses a match it does not know", () => {
    expect(
      errorOf(() => {
        return new FilterGroups({
          match: "AllOf" as FilterGroupsMatch,
          groups: [CONNECTED],
        });
      })?.message,
    ).toBe(
      `Invalid match for "filterGroups" in the query: "AllOf". It is one of AnyOf, NoneOf.`,
    );
  });
});

describe("a FilterGroups on the wire", () => {
  test("is written with its type, its match and each group as the query's serializer writes it", () => {
    expect(
      new FilterGroups({
        match: FilterGroupsMatch.NoneOf,
        groups: [CONNECTED, NOT_CONNECTED],
      }).toJSON(),
    ).toEqual({
      _type: ObjectType.FilterGroups,
      match: FilterGroupsMatch.NoneOf,
      groups: [
        { otelCollectorStatus: "connected" },
        {
          otelCollectorStatus: {
            _type: ObjectType.NotEqualOrNull,
            value: "connected",
          },
          collectorLastSeenAt: { _type: ObjectType.IsNull, value: null },
        },
      ],
    });
  });

  test("comes back as itself through the query's serializer, as ModelAPI sends it and the API reads it", () => {
    const query: JSONObject = {
      projectId: new ObjectID(PROJECT_ID),
      isArchived: false,
      [FILTER_GROUPS_QUERY_KEY]: new FilterGroups({
        match: FilterGroupsMatch.NoneOf,
        groups: [
          CONNECTED,
          DISCONNECTED,
          {
            projectId: new ObjectID(PROJECT_ID),
            port: 5432,
            isArchived: true,
            dbSystem: new Includes(["postgresql", "mysql"]),
            otelCollectorStatus: new IncludesNoneOrNull(["connected"]),
            collectorLastSeenAt: new IsNull(),
            name: new EqualToOrNull("orders"),
            hostname: new NotEqual("db.internal"),
            description: new EqualTo("primary"),
          },
        ],
      }),
    } as unknown as JSONObject;

    const sent: JSONObject = JSON.parse(
      JSON.stringify(JSONFunctions.serialize(query)),
    ) as JSONObject;
    const read: JSONObject = JSONFunctions.deserialize(sent);
    const filter: unknown = read[FILTER_GROUPS_QUERY_KEY];

    expect(filter).toBeInstanceOf(FilterGroups);
    expect((filter as FilterGroups).match).toBe(FilterGroupsMatch.NoneOf);

    const [connected, disconnected, everything] = (filter as FilterGroups)
      .groups as [FilterGroup, FilterGroup, FilterGroup];

    expect(connected).toEqual({ otelCollectorStatus: "connected" });
    expect(disconnected["otelCollectorStatus"]).toBeInstanceOf(NotEqualOrNull);
    expect(
      (disconnected["otelCollectorStatus"] as NotEqualOrNull<string>).value,
    ).toBe("connected");
    expect(disconnected["collectorLastSeenAt"]).toBeInstanceOf(NotNull);

    expect(everything["projectId"]).toBeInstanceOf(ObjectID);
    expect(everything["projectId"]!.toString()).toBe(PROJECT_ID);
    expect(everything["port"]).toBe(5432);
    expect(everything["isArchived"]).toBe(true);
    expect(everything["dbSystem"]).toBeInstanceOf(Includes);
    expect((everything["dbSystem"] as Includes).values).toEqual([
      "postgresql",
      "mysql",
    ]);
    expect(everything["otelCollectorStatus"]).toBeInstanceOf(
      IncludesNoneOrNull,
    );
    expect(everything["collectorLastSeenAt"]).toBeInstanceOf(IsNull);
    expect(everything["name"]).toBeInstanceOf(EqualToOrNull);
    expect(everything["hostname"]).toBeInstanceOf(NotEqual);
    expect(everything["description"]).toBeInstanceOf(EqualTo);

    // The rest of the query comes back as it was sent.
    expect(read["isArchived"]).toBe(false);
  });

  test("is found by its type in the dictionary every serialized value is read through", () => {
    expect(SerializableObjectDictionary[ObjectType.FilterGroups]).toBe(
      FilterGroups,
    );
  });

  test("reads AnyOf when the JSON names no match", () => {
    const filter: FilterGroups = FilterGroups.fromJSON({
      _type: ObjectType.FilterGroups,
      groups: [{ otelCollectorStatus: "connected" }],
    });

    expect(filter.match).toBe(FilterGroupsMatch.AnyOf);
  });

  test("refuses JSON of another type, or with no groups", () => {
    expect(
      errorOf(() => {
        return FilterGroups.fromJSON({
          _type: ObjectType.LinkedTo,
          groups: [],
        });
      }),
    ).toBeInstanceOf(BadDataException);

    for (const groups of [undefined, null, {}, "connected"]) {
      expect(
        errorOf(() => {
          return FilterGroups.fromJSON({
            _type: ObjectType.FilterGroups,
            groups: groups as never,
          });
        })?.message,
      ).toBe(
        `"filterGroups" in the query holds at least one group of filters.`,
      );
    }
  });

  test("refuses a group that is no filter, as JSON", () => {
    expect(
      errorOf(() => {
        return FilterGroups.fromJSON({
          _type: ObjectType.FilterGroups,
          groups: [["connected"]] as never,
        });
      })?.message,
    ).toBe(
      `Group 1 of "filterGroups" in the query is a filter: each column with what it must hold.`,
    );
  });

  test("refuses, as JSON, an operator a group may not hold", () => {
    const error: Error | undefined = errorOf(() => {
      return FilterGroups.fromJSON({
        _type: ObjectType.FilterGroups,
        groups: [
          {
            name: { _type: ObjectType.Search, value: "orders" },
          },
        ],
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain(`"name" of "filterGroups" in the query`);
  });
});
