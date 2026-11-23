import MetricService, {
  MonitorCheckSummaryRow,
} from "../../../Server/Services/MetricService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The one statement a counted window reads (#10355): a bounded range of one
 * monitor's rows, on the table's own sort key, grouped per probe (and disk),
 * every value from a criteria a bound parameter.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const START: Date = new Date("2026-11-20T04:00:00.000Z");
const END: Date = new Date("2026-11-20T12:00:00.000Z");

describe("MetricService.summarizeMonitorChecks", () => {
  let statements: Array<Statement> = [];
  let rows: Array<JSONObject> = [];

  beforeEach(() => {
    statements = [];
    rows = [];

    jest
      .spyOn(MetricService, "executeQuery")
      .mockImplementation(
        async (statement: Statement | string): Promise<never> => {
          statements.push(statement as Statement);

          return {
            json: async (): Promise<{ data: Array<JSONObject> }> => {
              return { data: rows };
            },
          } as never;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function summarize(
    overrides: Partial<Parameters<typeof MetricService.summarizeMonitorChecks>[0]> = {},
  ): Promise<Array<MonitorCheckSummaryRow>> {
    return MetricService.summarizeMonitorChecks({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      metricName: "oneuptime.monitor.online",
      windowStart: START,
      windowEnd: END,
      groupByAttributeKeys: ["probeId"],
      condition: { comparison: "ne", threshold: 1 },
      ...overrides,
    });
  }

  test("reads one monitor's series over the window, on the sort key, grouped per probe", async () => {
    await summarize();

    expect(statements).toHaveLength(1);

    const query: string = statements[0]!.query;
    const params: Record<string, unknown> = statements[0]!.query_params;

    // The sort key, in order: projectId, name, primaryEntityId, time.
    expect(query).toMatch(
      /WHERE projectId = \{p\d+:String\} AND name = \{p\d+:String\} AND primaryEntityId = \{p\d+:String\} AND time >= \{p\d+:DateTime64\(9\)\} AND time <= \{p\d+:DateTime64\(9\)\} AND isNotNull\(value\)/,
    );
    expect(Object.values(params)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        "oneuptime.monitor.online",
        MONITOR_ID.toString(),
        "probeId",
        1,
      ]),
    );

    // Grouped, counted and ordered in the database: one row a probe.
    expect(query).toContain("GROUP BY g0");
    expect(query).toContain("count() AS checkCount");
    /*
     * The value column is Nullable; each check's state is read as a
     * value, or arraySum refuses it on ClickHouse (26.7: "array
     * aggregation function cannot be performed on type Nullable").
     */
    expect(query).toContain("toUInt8(assumeNotNull(value) !=");
    expect(query).not.toContain("toUInt8(value ");
    expect(query).toContain("AND isNotNull(value)");
    expect(query).toContain(
      "arraySum(arrayMap((a, b) -> a != b, arrayPopBack(states), arrayPopFront(states))) AS changeCount",
    );
    expect(query).toContain("arraySort(x -> x.1, groupArray((time, ");
    // Bounded like any read: a time limit, and expired rows left out.
    expect(query).toContain("max_execution_time = 45");
    expect(query).toContain("retentionDate >= now()");
  });

  test("a match history is read under its filter key, and a disk series grouped per disk", async () => {
    await summarize({
      metricName: "oneuptime.monitor.criteria.filter.match",
      attributes: { filterKey: "abc" },
    });

    expect(statements[0]!.query).toMatch(
      /AND attributes\[\{p\d+:String\}\] = \{p\d+:String\}/,
    );
    expect(Object.values(statements[0]!.query_params)).toEqual(
      expect.arrayContaining(["filterKey", "abc"]),
    );

    await summarize({ groupByAttributeKeys: ["probeId", "diskPath"] });

    expect(statements[1]!.query).toContain("GROUP BY g0, g1");
  });

  test.each([
    ["gt", ">"],
    ["gte", ">="],
    ["lt", "<"],
    ["lte", "<="],
    ["eq", "="],
    ["ne", "!="],
  ] as const)(
    "the comparison %s is written as %s, with its number a parameter",
    async (comparison: "gt" | "gte" | "lt" | "lte" | "eq" | "ne", operator: string) => {
      await summarize({ condition: { comparison: comparison, threshold: 300 } });

      expect(statements[0]!.query).toContain(
        `toUInt8(assumeNotNull(value) ${operator} {`,
      );
      expect(statements[0]!.query).not.toContain("300");
      expect(Object.values(statements[0]!.query_params)).toContain(300);
    },
  );

  test("a comparison outside the list, or no number, is refused before anything is read", async () => {
    await expect(
      summarize({
        condition: { comparison: "or 1=1" as never, threshold: 1 },
      }),
    ).rejects.toThrow("A check is counted against a comparison with a number.");

    await expect(
      summarize({ condition: { comparison: "gt", threshold: NaN } }),
    ).rejects.toThrow();

    expect(statements).toHaveLength(0);
  });

  test("reads each group's row back: counts as numbers, times on UTC's clock", async () => {
    rows = [
      {
        g0: "probe-a",
        checkCount: "481",
        matchCount: "31",
        changeCount: "12",
        firstAt: "2026-11-20 04:00:30.000000000",
        lastAt: "2026-11-20 11:59:30.000000000",
        firstState: 0,
        lastState: 1,
      },
    ];

    expect(await summarize()).toEqual([
      {
        group: { probeId: "probe-a" },
        checkCount: 481,
        matchCount: 31,
        changeCount: 12,
        firstAt: new Date("2026-11-20T04:00:30.000Z"),
        lastAt: new Date("2026-11-20T11:59:30.000Z"),
        firstMatched: false,
        lastMatched: true,
      },
    ]);
  });
});
