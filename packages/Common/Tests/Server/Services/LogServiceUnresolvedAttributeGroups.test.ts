import "../TestingUtils/Init";
import {
  LogService,
  LogUnresolvedAttributeGroupResult,
  MAX_LOG_GROUP_VALUE_LENGTH,
} from "../../../Server/Services/LogService";
import Log from "../../../Models/AnalyticsModels/Log";
import Query from "../../../Server/Types/AnalyticsDatabase/Query";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Search from "../../../Types/BaseDatabase/Search";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Dictionary from "../../../Types/Dictionary";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Contract under test - the grouped count behind a Logs monitor whose
 * groups are resolved by a log ("interface.down" per interface, resolved
 * by "interface.up").
 *
 * One statement reads both kinds of log and answers, per group: how many
 * matching logs, and has a resolving log arrived since the last of them.
 * The statement's shape was run against ClickHouse 24.8 and 26.7 with the
 * rows described under "what the statement returns" below; this suite
 * pins that shape, that nothing the monitor's author typed reaches the
 * SQL as text, and how the rows are read.
 */

type CheckReadPermissionSpy = SpyInstance<
  (
    ...args: Parameters<typeof ModelPermission.checkReadPermission>
  ) => ReturnType<typeof ModelPermission.checkReadPermission>
>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-13T10:00:00.000Z"),
  new Date("2026-10-13T10:05:00.000Z"),
);

function withAttributes(
  query: Query<Log>,
  attributes: Dictionary<string | number | boolean>,
): Query<Log> {
  /*
   * Assigned, as a Logs monitor's step holds them: an object literal
   * checked against the attributes filter's recursive JSON type is too
   * deep for the compiler.
   */
  query.attributes = attributes;

  return query;
}

function problemQuery(): Query<Log> {
  return withAttributes(
    {
      projectId: PROJECT_ID,
      body: new Search<string>("down"),
      time: WINDOW,
    },
    { "event.name": "interface.down" },
  );
}

function resolvedByQuery(): Query<Log> {
  return withAttributes(
    {
      projectId: PROJECT_ID,
      time: WINDOW,
    },
    { "event.name": "interface.up" },
  );
}

function statementFor(
  groupByAttributes: Array<string>,
  limits: { limit?: number; resolvedLimit?: number } = {},
): Statement {
  return new LogService().toUnresolvedAttributeGroupStatement({
    query: problemQuery(),
    resolvedByQuery: resolvedByQuery(),
    groupByAttributes,
    limit: limits.limit ?? 100,
    resolvedLimit: limits.resolvedLimit ?? 5000,
  });
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

// The statement with every parameter placeholder made anonymous.
function shapeOf(statement: Statement): string {
  return statement.query.replace(/\{p\d+:/g, "{p:");
}

describe("LogService.toUnresolvedAttributeGroupStatement", () => {
  it("reads matching and resolving logs in one statement, and says per group whether it is resolved", () => {
    const shape: string = shapeOf(
      statementFor(["networkDevice.name", "network.interface.name"]),
    );

    expect(shape).toMatch(
      /^SELECT countIf\(__isProblem = 1\) AS groupCount, maxIf\(time, __isProblem = 0\) > maxIf\(time, __isProblem = 1\) AS isResolved, sum\(groupCount\) OVER \(PARTITION BY isResolved\) AS totalCount, count\(\) OVER \(PARTITION BY isResolved\) AS totalGroupCount, __group_0, __group_1 FROM \(SELECT time, 1 AS __isProblem, /,
    );
    expect(shape).toContain(
      " UNION ALL SELECT time, 0 AS __isProblem, substringUTF8(attributes[{p:String}], 1, 256) AS __group_0, substringUTF8(attributes[{p:String}], 1, 256) AS __group_1 FROM {p:Identifier}.{p:Identifier} WHERE TRUE ",
    );
    expect(shape).toContain(") GROUP BY __group_0, __group_1 ");
  });

  it("a group is resolved only by a resolving log strictly newer than its last matching log", () => {
    /*
     * ">" and not ">=": two logs at the very same instant leave the group
     * open. The order they happened in is not known, and an alert left
     * open is seen, while one closed by mistake is not.
     */
    const statement: Statement = statementFor(["con_name"]);

    expect(statement.query).toContain(
      "maxIf(time, __isProblem = 0) > maxIf(time, __isProblem = 1) AS isResolved",
    );
    expect(statement.query).not.toContain(">=  maxIf");
    expect(statement.query).not.toContain(") >= maxIf(");
  });

  it("orders open groups first, the busiest of them first, and keeps the first rows of each side", () => {
    const statement: Statement = statementFor(["con_name", "gw_name"], {
      limit: 100,
      resolvedLimit: 5000,
    });

    expect(statement.query).toContain(
      " ORDER BY isResolved ASC, groupCount DESC, __group_0 ASC, __group_1 ASC ",
    );
    // LIMIT BY: a burst on one side can never crowd out the other.
    expect(statement.query).toMatch(/ LIMIT \{p\d+:Int32\} BY isResolved/);
    expect(paramValues(statement)).toContain(5000);
  });

  it("asks for as many rows a side as the larger of the two limits", () => {
    expect(
      paramValues(statementFor(["con_name"], { limit: 100, resolvedLimit: 7 })),
    ).toContain(100);
    expect(
      paramValues(statementFor(["con_name"], { limit: 100, resolvedLimit: 7 })),
    ).not.toContain(7);
  });

  it("each side is filtered by its own query, with the retention filter on both", () => {
    const statement: Statement = statementFor(["con_name"]);
    const [problemSide, resolvingSide] = statement.query.split(" UNION ALL ");

    expect(problemSide).toContain("retentionDate >= now()");
    expect(resolvingSide).toContain("retentionDate >= now()");

    const params: Array<unknown> = paramValues(statement);

    expect(params).toContain("interface.down");
    expect(params).toContain("interface.up");

    /*
     * The text filter is the problem's alone: the body column is searched
     * once, on the matching side. (Column names are bound as identifiers,
     * so they are read from the parameters, not from the SQL text.)
     */
    expect(
      params.filter((value: unknown) => {
        return value === "body";
      }),
    ).toHaveLength(1);
    expect(problemSide).toContain(" ILIKE ");
    expect(resolvingSide).not.toContain(" ILIKE ");

    // Both sides are scoped to the project and to the window.
    expect(
      params.filter((value: unknown) => {
        return String(value) === PROJECT_ID.toString();
      }),
    ).toHaveLength(2);
    expect(
      params.filter((value: unknown) => {
        return value === "time";
      }).length,
    ).toBe(4);
  });

  it("the matching side is filtered with the same WHERE the plain grouped count uses", () => {
    const service: LogService = new LogService();

    const unresolved: Statement = service.toUnresolvedAttributeGroupStatement({
      query: problemQuery(),
      resolvedByQuery: resolvedByQuery(),
      groupByAttributes: ["con_name"],
      limit: 100,
      resolvedLimit: 5000,
    });
    const grouped: Statement = service.toAttributeGroupCountStatement({
      query: problemQuery(),
      groupByAttributes: ["con_name"],
      limit: 100,
    });

    const whereOf: (sql: string) => string = (sql: string): string => {
      return sql
        .slice(sql.indexOf("WHERE TRUE"))
        .split(/ UNION ALL | GROUP BY | SETTINGS /)[0]!
        .replace(/\{p\d+:/g, "{p:")
        .trim();
    };

    expect(whereOf(unresolved.query)).toBe(whereOf(grouped.query));
  });

  it("binds group-by keys as parameters on both sides, and never as SQL", () => {
    const hostileKeys: Array<string> = [
      "x'], 1) AS __group_0 FROM system.tables --",
      "con_name`) UNION ALL SELECT password FROM users --",
      "a') OR 1=1 --",
    ];

    const statement: Statement = statementFor(hostileKeys);

    for (const key of hostileKeys) {
      expect(statement.query).not.toContain(key);
      // Once on each side of the UNION.
      expect(
        paramValues(statement).filter((value: unknown) => {
          return value === key;
        }),
      ).toHaveLength(2);
    }

    expect(statement.query).toContain(
      ") GROUP BY __group_0, __group_1, __group_2 ",
    );
  });

  it("binds a hostile Resolved By value as a parameter and never as SQL", () => {
    const hostile: string = "up' OR 1=1) UNION ALL SELECT 1 --";

    const statement: Statement =
      new LogService().toUnresolvedAttributeGroupStatement({
        query: problemQuery(),
        resolvedByQuery: withAttributes(
          { projectId: PROJECT_ID, time: WINDOW },
          { "event.name": hostile, "x'] = '' OR '1'='1": "v" },
        ),
        groupByAttributes: ["con_name"],
        limit: 100,
        resolvedLimit: 5000,
      });

    expect(statement.query).not.toContain(hostile);
    expect(statement.query).not.toContain("OR '1'='1");
    expect(paramValues(statement)).toContain(hostile);
    expect(paramValues(statement)).toContain("x'] = '' OR '1'='1");
  });

  it("cuts long values in the query, so the cut values group together on both sides", () => {
    const statement: Statement = statementFor(["message"]);

    expect(
      statement.query.split(`, 1, ${MAX_LOG_GROUP_VALUE_LENGTH}) AS __group_0`),
    ).toHaveLength(3);
  });

  it("fails on a timeout instead of returning a partial set of groups", () => {
    const statement: Statement = statementFor(["con_name"]);

    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
    expect(statement.query).not.toContain("timeout_overflow_mode = 'break'");
    expect(statement.query).toContain("max_execution_time = 45");
  });

  it("refuses a statement with nothing to group by", () => {
    expect(() => {
      return statementFor([]);
    }).toThrow(BadDataException);
  });

  it("refuses a limit that is not a positive number, on either side", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => {
        return statementFor(["con_name"], { limit: bad });
      }).toThrow(BadDataException);
      expect(() => {
        return statementFor(["con_name"], { resolvedLimit: bad });
      }).toThrow(BadDataException);
    }
  });
});

describe("LogService.toUnresolvedAttributeGroupResult - what the statement returns", () => {
  /*
   * The rows ClickHouse returned for these logs, grouped by device and
   * interface, with the limit at 2 a side:
   *
   *   sw1 Gi0/1   down 10:00:01, up 10:00:02            resolved
   *   sw1 Gi0/2   down 10:00:01, up 10:00:02, down :03  open, 2 logs
   *   sw2 Gi0/1   down 10:00:04                         open, 1 log
   *   sw2 Gi0/9   up 10:00:05                           resolved
   *   sw3 Gi0/1   down and up, both at 10:00:06         open (cut by the limit)
   *
   * 24.8 quotes UInt64 as strings and 26.7 does not; both are read.
   */
  const ROWS_FROM_26_7: Array<JSONObject> = [
    {
      groupCount: 2,
      isResolved: 0,
      totalCount: 4,
      totalGroupCount: 3,
      __group_0: "sw1",
      __group_1: "Gi0/2",
    },
    {
      groupCount: 1,
      isResolved: 0,
      totalCount: 4,
      totalGroupCount: 3,
      __group_0: "sw2",
      __group_1: "Gi0/1",
    },
    {
      groupCount: 1,
      isResolved: 1,
      totalCount: 1,
      totalGroupCount: 2,
      __group_0: "sw1",
      __group_1: "Gi0/1",
    },
    {
      groupCount: 0,
      isResolved: 1,
      totalCount: 1,
      totalGroupCount: 2,
      __group_0: "sw2",
      __group_1: "Gi0/9",
    },
  ];

  const ROWS_FROM_24_8: Array<JSONObject> = ROWS_FROM_26_7.map(
    (row: JSONObject): JSONObject => {
      return {
        ...row,
        groupCount: String(row["groupCount"]),
        totalCount: String(row["totalCount"]),
        totalGroupCount: String(row["totalGroupCount"]),
      };
    },
  );

  const GROUP_BY: Array<string> = [
    "networkDevice.name",
    "network.interface.name",
  ];

  it.each([
    ["ClickHouse 26.7", ROWS_FROM_26_7],
    ["ClickHouse 24.8", ROWS_FROM_24_8],
  ])(
    "splits %s's rows into open groups and resolved ones",
    (_version: string, rows: Array<JSONObject>) => {
      const result: LogUnresolvedAttributeGroupResult =
        LogService.toUnresolvedAttributeGroupResult({
          rows: rows,
          groupByAttributes: GROUP_BY,
          limit: 100,
        });

      expect(result).toEqual({
        groups: [
          { values: ["sw1", "Gi0/2"], count: 2 },
          { values: ["sw2", "Gi0/1"], count: 1 },
        ],
        resolvedGroups: [
          ["sw1", "Gi0/1"],
          ["sw2", "Gi0/9"],
        ],
        // Every open group, counting the one the row limit cut.
        totalCount: 4,
        totalGroupCount: 3,
      });
    },
  );

  it("keeps at most `limit` open groups, and still every resolved one", () => {
    const result: LogUnresolvedAttributeGroupResult =
      LogService.toUnresolvedAttributeGroupResult({
        rows: ROWS_FROM_26_7,
        groupByAttributes: GROUP_BY,
        limit: 1,
      });

    expect(result.groups).toEqual([{ values: ["sw1", "Gi0/2"], count: 2 }]);
    expect(result.resolvedGroups).toHaveLength(2);
    // The total still says how many there were.
    expect(result.totalGroupCount).toBe(3);
  });

  it("reads a resolved flag sent as a number, a string or a boolean", () => {
    for (const flag of [1, "1", true]) {
      const result: LogUnresolvedAttributeGroupResult =
        LogService.toUnresolvedAttributeGroupResult({
          rows: [
            {
              groupCount: 3,
              isResolved: flag,
              totalCount: 3,
              totalGroupCount: 1,
              __group_0: "sw1",
            },
          ],
          groupByAttributes: ["networkDevice.name"],
          limit: 100,
        });

      expect({ flag, result }).toEqual({
        flag,
        result: {
          groups: [],
          resolvedGroups: [["sw1"]],
          totalCount: 0,
          totalGroupCount: 0,
        },
      });
    }

    for (const flag of [0, "0", false, undefined, null]) {
      expect(
        LogService.toUnresolvedAttributeGroupResult({
          rows: [
            {
              groupCount: 3,
              isResolved: flag as never,
              totalCount: 3,
              totalGroupCount: 1,
              __group_0: "sw1",
            },
          ],
          groupByAttributes: ["networkDevice.name"],
          limit: 100,
        }).groups,
      ).toEqual([{ values: ["sw1"], count: 3 }]);
    }
  });

  it("no rows is no groups on either side", () => {
    expect(
      LogService.toUnresolvedAttributeGroupResult({
        rows: [],
        groupByAttributes: GROUP_BY,
        limit: 100,
      }),
    ).toEqual({
      groups: [],
      resolvedGroups: [],
      totalCount: 0,
      totalGroupCount: 0,
    });
  });

  it("a group value the logs did not carry is the empty string", () => {
    const result: LogUnresolvedAttributeGroupResult =
      LogService.toUnresolvedAttributeGroupResult({
        rows: [
          {
            groupCount: 1,
            isResolved: 0,
            totalCount: 1,
            totalGroupCount: 1,
            __group_0: "sw1",
          },
          { groupCount: 0, isResolved: 1, __group_0: null, __group_1: "" },
        ],
        groupByAttributes: GROUP_BY,
        limit: 100,
      });

    expect(result.groups).toEqual([{ values: ["sw1", ""], count: 1 }]);
    expect(result.resolvedGroups).toEqual([["", ""]]);
  });
});

describe("LogService.countUnresolvedAttributeGroups", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("checks read permission for both queries, and runs the statement built from what the checks hand back", async () => {
    const service: LogService = new LogService();

    const checkReadPermission: CheckReadPermissionSpy = jest
      .spyOn(ModelPermission, "checkReadPermission")
      .mockImplementation((async (
        _modelType: unknown,
        query: Query<Log>,
      ): Promise<unknown> => {
        // What a real check does for a tenant: scope the query.
        return { query: { ...query, projectId: PROJECT_ID }, select: null };
      }) as never) as unknown as CheckReadPermissionSpy;

    let executed: Statement | undefined;

    jest.spyOn(service, "executeQuery").mockImplementation((async (
      statement: Statement,
    ): Promise<unknown> => {
      executed = statement;

      return {
        json: async (): Promise<unknown> => {
          return {
            data: [
              {
                groupCount: "2",
                isResolved: 0,
                totalCount: "2",
                totalGroupCount: "1",
                __group_0: "sw1",
              },
              { groupCount: "0", isResolved: 1, __group_0: "sw2" },
            ],
          };
        },
      };
    }) as never);

    const result: LogUnresolvedAttributeGroupResult =
      await service.countUnresolvedAttributeGroups({
        query: withAttributes(
          { time: WINDOW },
          { "event.name": "interface.down" },
        ),
        resolvedByQuery: withAttributes(
          { time: WINDOW },
          { "event.name": "interface.up" },
        ),
        groupByAttributes: ["networkDevice.name"],
        limit: 100,
        resolvedLimit: 5000,
        props: { isRoot: true },
      });

    expect(checkReadPermission).toHaveBeenCalledTimes(2);
    expect(executed).toBeDefined();
    // Both sides carry the project the permission check scoped them to.
    expect(
      paramValues(executed as Statement).filter((value: unknown) => {
        return String(value) === PROJECT_ID.toString();
      }),
    ).toHaveLength(2);
    expect(result).toEqual({
      groups: [{ values: ["sw1"], count: 2 }],
      resolvedGroups: [["sw2"]],
      totalCount: 2,
      totalGroupCount: 1,
    });
  });
});
