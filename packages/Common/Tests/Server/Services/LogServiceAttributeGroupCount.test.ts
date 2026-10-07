import "../TestingUtils/Init";
import {
  LogAttributeGroupCountResult,
  LogService,
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
 * Contract under test - the grouped count behind a Logs monitor's Group By.
 *
 * The attribute keys come from whoever configures the monitor, so the
 * one property this statement must never lose is that they reach
 * ClickHouse as bound parameters, not as SQL text. The rest pins what the
 * evaluation relies on: one group per distinct combination, the busiest
 * groups first, totals that cover the groups the limit cut, the same
 * filter the ungrouped count uses, and a timeout that fails rather than
 * returning a partial set of groups.
 */

// ModelPermission.checkReadPermission spied on, as jest-mock's spyOn types it.
type CheckReadPermissionSpy = SpyInstance<
  (
    ...args: Parameters<typeof ModelPermission.checkReadPermission>
  ) => ReturnType<typeof ModelPermission.checkReadPermission>
>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function monitorQuery(): Query<Log> {
  const query: Query<Log> = {
    projectId: PROJECT_ID,
    body: new Search<string>("terminated"),
    time: new InBetween<Date>(
      new Date("2026-10-07T10:00:00.000Z"),
      new Date("2026-10-07T10:05:00.000Z"),
    ),
  };

  /*
   * Held the way a Logs monitor's step holds them
   * (MonitorStepLogMonitor.attributes); an object literal checked
   * against the attributes filter's recursive JSON type is too deep for
   * the compiler.
   */
  const attributes: Dictionary<string | number | boolean> = {
    log_component: "IPSec",
  };
  query.attributes = attributes;

  return query;
}

function statementFor(
  groupByAttributes: Array<string>,
  limit: number = 100,
): Statement {
  return new LogService().toAttributeGroupCountStatement({
    query: monitorQuery(),
    groupByAttributes,
    limit,
  });
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("LogService.toAttributeGroupCountStatement", () => {
  it("groups by each attribute, busiest group first", () => {
    const statement: Statement = statementFor(["con_name"]);

    expect(statement.query).toMatch(
      /^SELECT count\(\) AS groupCount, sum\(count\(\)\) OVER \(\) AS totalCount, count\(\) OVER \(\) AS totalGroupCount, substringUTF8\(attributes\[\{p0:String\}\], 1, 256\) AS __group_0 FROM \{p1:Identifier\}\.\{p2:Identifier\} WHERE TRUE /,
    );
    expect(statement.query).toContain(" GROUP BY __group_0 ");
    expect(statement.query).toContain(
      " ORDER BY groupCount DESC, __group_0 ASC ",
    );
    expect(statement.query_params["p0"]).toBe("con_name");
    expect(statement.query_params["p1"]).toBe("oneuptime");
    expect(statement.query_params["p2"]).toBe(new Log().tableName);
  });

  it("keeps several attributes in the order they were configured", () => {
    const statement: Statement = statementFor(["con_name", "gw_name"]);

    expect(statement.query).toContain(
      "substringUTF8(attributes[{p0:String}], 1, 256) AS __group_0, substringUTF8(attributes[{p1:String}], 1, 256) AS __group_1",
    );
    expect(statement.query).toContain(" GROUP BY __group_0, __group_1 ");
    expect(statement.query).toContain(
      " ORDER BY groupCount DESC, __group_0 ASC, __group_1 ASC ",
    );
    expect(statement.query_params["p0"]).toBe("con_name");
    expect(statement.query_params["p1"]).toBe("gw_name");
  });

  it("cuts long values in the query, so the cut values group together", () => {
    expect(MAX_LOG_GROUP_VALUE_LENGTH).toBe(256);
    expect(statementFor(["message"]).query).toContain(
      `substringUTF8(attributes[{p0:String}], 1, ${MAX_LOG_GROUP_VALUE_LENGTH}) AS __group_0`,
    );
  });

  it("binds a hostile attribute key as a parameter and never as SQL", () => {
    const hostileKeys: Array<string> = [
      "x'], 1) AS __group_0 FROM system.tables --",
      "con_name`) UNION ALL SELECT password FROM users --",
      "a') OR 1=1 --",
    ];

    const statement: Statement = statementFor(hostileKeys);

    for (const key of hostileKeys) {
      expect(statement.query).not.toContain(key);
      expect(paramValues(statement)).toContain(key);
    }

    // The aliases come from positions, never from the key text.
    expect(statement.query).toContain(
      " GROUP BY __group_0, __group_1, __group_2 ",
    );
  });

  it("binds the limit as a parameter", () => {
    const statement: Statement = statementFor(["con_name"], 101);

    expect(statement.query).toMatch(/ LIMIT \{p\d+:Int32\}/);
    expect(paramValues(statement)).toContain(101);
  });

  it("filters with the same WHERE the ungrouped monitor count uses", () => {
    const service: LogService = new LogService();
    const query: Query<Log> = monitorQuery();

    const grouped: Statement = service.toAttributeGroupCountStatement({
      query,
      groupByAttributes: ["con_name"],
      limit: 100,
    });
    const count: Statement = service.toCountStatement({
      query: monitorQuery(),
      props: { isRoot: true },
    });

    const whereOf: (sql: string) => string = (sql: string): string => {
      return sql
        .slice(sql.indexOf("WHERE TRUE"))
        .split(/ GROUP BY | SETTINGS /)[0]!
        .replace(/\{p\d+:/g, "{p:")
        .trim();
    };

    expect(whereOf(grouped.query)).toBe(whereOf(count.query));
    expect(grouped.query).toContain("retentionDate >= now()");

    // Same filter values, in the same order, after the group-by key.
    expect(paramValues(grouped).slice(3, -1)).toEqual(
      paramValues(count).slice(2),
    );
  });

  it("fails on a timeout instead of returning a partial set of groups", () => {
    const statement: Statement = statementFor(["con_name"]);

    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
    expect(statement.query).not.toContain("timeout_overflow_mode = 'break'");
    expect(statement.query).toContain("max_execution_time = 45");
    // A GROUP BY over the attributes map must visit every matching row.
    expect(statement.query).toContain("max_block_size = 8192");
  });

  it("refuses a statement with nothing to group by", () => {
    expect(() => {
      return statementFor([]);
    }).toThrow(BadDataException);
  });

  it("refuses a limit that is not a positive number", () => {
    for (const limit of [0, -1, Number.NaN]) {
      expect(() => {
        return statementFor(["con_name"], limit);
      }).toThrow(BadDataException);
    }
  });
});

describe("LogService.toAttributeGroupCountResult", () => {
  it("reads one group per row, with totals from the window columns", () => {
    const result: LogAttributeGroupCountResult =
      LogService.toAttributeGroupCountResult({
        groupByAttributes: ["con_name", "gw_name"],
        rows: [
          {
            groupCount: "5",
            totalCount: "9",
            totalGroupCount: "3",
            __group_0: "HQ-Branch1",
            __group_1: "WAN2",
          },
          {
            groupCount: 4,
            totalCount: 9,
            totalGroupCount: 3,
            __group_0: "Branch2",
            __group_1: "",
          },
        ],
      });

    expect(result).toEqual({
      groups: [
        { values: ["HQ-Branch1", "WAN2"], count: 5 },
        { values: ["Branch2", ""], count: 4 },
      ],
      totalCount: 9,
      totalGroupCount: 3,
    });
  });

  it("reads a missing value as an empty one", () => {
    const result: LogAttributeGroupCountResult =
      LogService.toAttributeGroupCountResult({
        groupByAttributes: ["con_name"],
        rows: [{ groupCount: 2, totalCount: 2, totalGroupCount: 1 }],
      });

    expect(result.groups).toEqual([{ values: [""], count: 2 }]);
  });

  it("is empty when no log matched", () => {
    expect(
      LogService.toAttributeGroupCountResult({
        groupByAttributes: ["con_name"],
        rows: [],
      }),
    ).toEqual({ groups: [], totalCount: 0, totalGroupCount: 0 });
  });

  it("never reads a garbled count as a number", () => {
    const result: LogAttributeGroupCountResult =
      LogService.toAttributeGroupCountResult({
        groupByAttributes: ["con_name"],
        rows: [
          {
            groupCount: "not-a-number",
            totalCount: null,
            totalGroupCount: { nested: true },
            __group_0: "a",
          } as unknown as JSONObject,
        ],
      });

    expect(result).toEqual({
      groups: [{ values: ["a"], count: 0 }],
      totalCount: 0,
      totalGroupCount: 0,
    });
  });
});

describe("LogService.countByAttributeGroups", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("checks read permission, runs the grouped statement and parses it", async () => {
    const service: LogService = new LogService();

    const permissionSpy: CheckReadPermissionSpy = jest.spyOn(
      ModelPermission,
      "checkReadPermission",
    );

    const executedStatements: Array<Statement> = [];

    jest
      .spyOn(service, "executeQuery")
      .mockImplementation(async (statement: Statement | string) => {
        executedStatements.push(statement as Statement);

        return {
          json: async () => {
            return {
              data: [
                {
                  groupCount: "3",
                  totalCount: "4",
                  totalGroupCount: "2",
                  __group_0: "HQ-Branch1",
                },
                {
                  groupCount: "1",
                  totalCount: "4",
                  totalGroupCount: "2",
                  __group_0: "Branch2",
                },
              ],
            };
          },
        } as never;
      });

    const result: LogAttributeGroupCountResult =
      await service.countByAttributeGroups({
        query: monitorQuery(),
        groupByAttributes: ["con_name"],
        limit: 100,
        props: { isRoot: true },
      });

    expect(permissionSpy).toHaveBeenCalledTimes(1);
    expect(executedStatements).toHaveLength(1);
    expect(executedStatements[0]!.query).toContain("GROUP BY __group_0");
    expect(executedStatements[0]!.query_params["p0"]).toBe("con_name");

    expect(result).toEqual({
      groups: [
        { values: ["HQ-Branch1"], count: 3 },
        { values: ["Branch2"], count: 1 },
      ],
      totalCount: 4,
      totalGroupCount: 2,
    });
  });
});
