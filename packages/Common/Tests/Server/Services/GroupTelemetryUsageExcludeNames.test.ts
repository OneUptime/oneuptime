import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import { LogService } from "../../../Server/Services/LogService";
import { MetricService } from "../../../Server/Services/MetricService";
import { SpanService } from "../../../Server/Services/SpanService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import SessionReplayBudgetMetricTypeUtil from "../../../Utils/SessionReplay/SessionReplayBudgetMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * The metrics billing scan is the only place OneUptime's own session replay
 * budget rows can be told apart from a RUM application's web vitals: both are
 * keyed to the application with primaryEntityType RealUserMonitor, so the
 * (primaryEntityId, primaryEntityType) grouping merges them and only their
 * names differ. These tests pin the SQL the scan generates - the exclusion
 * sits inside the WHERE, binds the names as a parameter, and leaves the
 * statement byte-for-byte unchanged when there is nothing to exclude - with no
 * ClickHouse in the loop, the same way SessionReplayMetering.test.ts pins the
 * replay scan.
 */

const PROJECT_ID: ObjectID = new ObjectID("6512f3a9b7c4d2e108f5a3b9");
const START_OF_DAY: Date = new Date("2026-09-28T00:00:00.000Z");
const END_OF_DAY: Date = new Date("2026-09-28T23:59:59.999Z");

/*
 * The statement as the scan generated it before excludeNames existed,
 * captured from that code, up to the trailing SETTINGS clause (which belongs
 * to QuerySettingsHelper and is pinned there).
 */
const PRE_EXCLUSION_QUERY: string =
  "SELECT primaryEntityId AS primaryEntityId, primaryEntityType AS primaryEntityType, count() AS rowCount, sum(byteSize(*)) AS estimatedBytes FROM {p0:Identifier}.{p1:Identifier} WHERE projectId = {p2:String} AND {p3:Identifier} >= {p4:DateTime64(9)} AND {p5:Identifier} <= {p6:DateTime64(9)} GROUP BY primaryEntityId, primaryEntityType";

const BUDGET_METRIC_NAMES: Array<string> =
  SessionReplayBudgetMetricTypeUtil.getAll();

type UsageRow = {
  primaryEntityId: string;
  primaryEntityType: string | null;
  rowCount: number;
  estimatedBytes: number;
};

interface CapturedScan {
  // Null when the scan refused before reaching ClickHouse.
  query: string | null;
  params: Record<string, unknown> | null;
  result: Array<UsageRow>;
}

/*
 * Runs the real groupTelemetryUsageByService with executeQuery replaced, so
 * the generated statement is captured instead of sent. `excludeNames` is
 * passed only when the key is present, so "absent" and "undefined" are
 * separate cases.
 */
async function captureUsageScan<TBaseModel extends AnalyticsBaseModel>(
  service: AnalyticsDatabaseService<TBaseModel>,
  options: {
    excludeNames?: Array<string> | undefined;
    responseRows?: Array<JSONObject> | undefined;
  } = {},
): Promise<CapturedScan> {
  const captured: CapturedScan = { query: null, params: null, result: [] };

  service.executeQuery = ((statement: Statement): Promise<unknown> => {
    captured.query = statement.query;
    captured.params = statement.query_params;

    return Promise.resolve({
      json: (): Promise<{ data: Array<JSONObject> }> => {
        return Promise.resolve({ data: options.responseRows || [] });
      },
    });
  }) as unknown as typeof service.executeQuery;

  captured.result = await service.groupTelemetryUsageByService({
    projectId: PROJECT_ID,
    timestampColumnName: "time",
    startDate: START_OF_DAY,
    endDate: END_OF_DAY,
    ...("excludeNames" in options
      ? { excludeNames: options.excludeNames }
      : {}),
  });

  return captured;
}

function queryBeforeSettings(query: string | null): string {
  expect(query).not.toBeNull();

  const settingsIndex: number = query!.indexOf(" SETTINGS ");
  expect(settingsIndex).toBeGreaterThan(-1);

  return query!.slice(0, settingsIndex);
}

describe("groupTelemetryUsageByService without excludeNames", () => {
  test("generates exactly the statement it did before the option existed", async () => {
    const scan: CapturedScan = await captureUsageScan(new MetricService());

    expect(queryBeforeSettings(scan.query)).toBe(PRE_EXCLUSION_QUERY);
    expect(scan.query).not.toContain("NOT IN");

    // Same parameters too - p0 is the configured database name.
    expect(Object.keys(scan.params!).sort()).toEqual(
      ["p0", "p1", "p2", "p3", "p4", "p5", "p6"].sort(),
    );
    expect(scan.params!["p1"]).toBe("MetricItemV3");
    expect(scan.params!["p2"]).toBe(PROJECT_ID.toString());
    expect(scan.params!["p3"]).toBe("time");
    expect(scan.params!["p5"]).toBe("time");
  });

  test.each([
    ["an empty list", []],
    ["an explicit undefined", undefined],
  ])(
    "treats %s as absent: the same statement, the same parameters",
    async (_name: string, excludeNames: Array<string> | undefined) => {
      const absent: CapturedScan = await captureUsageScan(new MetricService());
      const given: CapturedScan = await captureUsageScan(new MetricService(), {
        excludeNames,
      });

      expect(given.query).toBe(absent.query);
      expect(given.params).toEqual(absent.params);
    },
  );

  test("still scans a table with no name column when there is nothing to exclude", async () => {
    const scan: CapturedScan = await captureUsageScan(new LogService(), {
      excludeNames: [],
    });

    expect(scan.query).not.toBeNull();
    expect(scan.query).not.toContain("NOT IN");
    expect(scan.params!["p1"]).toBe("LogItemV3");
  });
});

describe("groupTelemetryUsageByService with excludeNames", () => {
  test("adds `AND name NOT IN` inside the WHERE: after the time window, before GROUP BY", async () => {
    const scan: CapturedScan = await captureUsageScan(new MetricService(), {
      excludeNames: BUDGET_METRIC_NAMES,
    });

    const query: string = scan.query!;

    expect(query).toContain(
      "AND {p5:Identifier} <= {p6:DateTime64(9)} AND name NOT IN {p7:Array(String)} GROUP BY primaryEntityId, primaryEntityType SETTINGS ",
    );
    expect(query.indexOf(" WHERE ")).toBeLessThan(query.indexOf("NOT IN"));
    expect(query.indexOf("NOT IN")).toBeLessThan(query.indexOf(" GROUP BY "));
    expect(query.indexOf(" GROUP BY ")).toBeLessThan(
      query.indexOf(" SETTINGS "),
    );

    // Exactly one exclusion clause, and nothing else about the scan moved.
    expect(query.split("NOT IN")).toHaveLength(2);
    expect(
      queryBeforeSettings(query).replace(
        " AND name NOT IN {p7:Array(String)}",
        "",
      ),
    ).toBe(PRE_EXCLUSION_QUERY);
  });

  test("binds every name, in order, as one Array(String) parameter", async () => {
    const scan: CapturedScan = await captureUsageScan(new MetricService(), {
      excludeNames: BUDGET_METRIC_NAMES,
    });

    expect(scan.params!["p7"]).toEqual(BUDGET_METRIC_NAMES);

    // The names never reach the SQL text itself.
    for (const name of BUDGET_METRIC_NAMES) {
      expect(scan.query).not.toContain(name);
    }
  });

  test("keeps a hostile name a parameter value, never SQL", async () => {
    const hostileName: string = "x') OR 1=1 GROUP BY name --";

    const scan: CapturedScan = await captureUsageScan(new MetricService(), {
      excludeNames: [hostileName],
    });

    expect(scan.params!["p7"]).toEqual([hostileName]);
    expect(scan.query).not.toContain("OR 1=1");
    expect(scan.query).not.toContain("--");
    expect(scan.query!.split("GROUP BY")).toHaveLength(2);
  });

  test("leaves the caller's list untouched", async () => {
    const excludeNames: Array<string> = [...BUDGET_METRIC_NAMES];

    await captureUsageScan(new MetricService(), { excludeNames });

    expect(excludeNames).toEqual(BUDGET_METRIC_NAMES);
  });

  test("parses the grouped rows exactly as before", async () => {
    const appId: string = ObjectID.generate().toString();

    const scan: CapturedScan = await captureUsageScan(new MetricService(), {
      excludeNames: BUDGET_METRIC_NAMES,
      responseRows: [
        {
          primaryEntityId: appId,
          primaryEntityType: ServiceType.RealUserMonitor,
          rowCount: "12",
          estimatedBytes: "3456",
        },
        // Unattributed rows are skipped, as they always were.
        {
          primaryEntityId: "",
          primaryEntityType: ServiceType.OpenTelemetry,
          rowCount: "1",
          estimatedBytes: "1",
        },
        // A blank type reads as a legacy row.
        {
          primaryEntityId: PROJECT_ID.toString(),
          primaryEntityType: " ",
          rowCount: 2,
          estimatedBytes: 0,
        },
      ],
    });

    expect(scan.result).toEqual([
      {
        primaryEntityId: appId,
        primaryEntityType: ServiceType.RealUserMonitor,
        rowCount: 12,
        estimatedBytes: 3456,
      },
      {
        primaryEntityId: PROJECT_ID.toString(),
        primaryEntityType: null,
        rowCount: 2,
        estimatedBytes: 0,
      },
    ]);
  });

  test("refuses a table with no name column before querying it", async () => {
    const service: LogService = new LogService();
    let executed: boolean = false;
    service.executeQuery = (async (): Promise<never> => {
      executed = true;
      throw new Error("must not run");
    }) as unknown as typeof service.executeQuery;

    await expect(
      service.groupTelemetryUsageByService({
        projectId: PROJECT_ID,
        timestampColumnName: "time",
        startDate: START_OF_DAY,
        endDate: END_OF_DAY,
        excludeNames: ["anything"],
      }),
    ).rejects.toThrow(BadDataException);
    expect(executed).toBe(false);
  });

  test("refuses a Nullable name column, where NOT IN would silently drop every unnamed row", async () => {
    /*
     * Span.name is optional. ClickHouse does not treat `NULL NOT IN (...)`
     * as true, so the scan would lose every span without a name from the
     * bill - an undercount nobody would notice.
     */
    const service: SpanService = new SpanService();
    let executed: boolean = false;
    service.executeQuery = (async (): Promise<never> => {
      executed = true;
      throw new Error("must not run");
    }) as unknown as typeof service.executeQuery;

    await expect(
      service.groupTelemetryUsageByService({
        projectId: PROJECT_ID,
        timestampColumnName: "startTime",
        startDate: START_OF_DAY,
        endDate: END_OF_DAY,
        excludeNames: ["anything"],
      }),
    ).rejects.toThrow(
      "excludeNames needs a required name column, and SpanItemV3 has none",
    );
    expect(executed).toBe(false);
  });
});
