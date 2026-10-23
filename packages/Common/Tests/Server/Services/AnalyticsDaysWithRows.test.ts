import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import { LogService } from "../../../Server/Services/LogService";
import { MetricService } from "../../../Server/Services/MetricService";
import { RumSessionService } from "../../../Server/Services/RumSessionService";
import { SpanService } from "../../../Server/Services/SpanService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SessionReplayBudgetMetricTypeUtil from "../../../Utils/SessionReplay/SessionReplayBudgetMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * getDaysWithRows is how usage billing's catch-up decides which missed days
 * are worth a full byteSize(*) usage scan. It must stay cheap (projectId and
 * the timestamp only, never byteSize), name days in UTC exactly as staging
 * does, leave out the rows billing leaves out, and never return a partial
 * answer that would hide a day still owed. These tests pin the SQL with no
 * ClickHouse in the loop, as GroupTelemetryUsageExcludeNames.test.ts does for
 * the usage scan itself.
 */

const PROJECT_ID: ObjectID = new ObjectID("6512f3a9b7c4d2e108f5a3b9");
const WINDOW_START: Date = new Date("2026-10-16T00:00:00.000Z");
const WINDOW_END: Date = new Date("2026-10-22T23:59:59.999Z");

interface CapturedDayQuery {
  query: string | null;
  params: Record<string, unknown> | null;
  result: Array<string>;
}

async function captureDayQuery<TBaseModel extends AnalyticsBaseModel>(
  service: AnalyticsDatabaseService<TBaseModel>,
  options: {
    timestampColumnName?: string | undefined;
    excludeNames?: Array<string> | undefined;
    responseRows?: Array<JSONObject> | undefined;
  } = {},
): Promise<CapturedDayQuery> {
  const captured: CapturedDayQuery = { query: null, params: null, result: [] };

  service.executeQuery = ((statement: Statement): Promise<unknown> => {
    captured.query = statement.query;
    captured.params = statement.query_params;

    return Promise.resolve({
      json: (): Promise<{ data: Array<JSONObject> }> => {
        return Promise.resolve({ data: options.responseRows || [] });
      },
    });
  }) as unknown as typeof service.executeQuery;

  captured.result = await service.getDaysWithRows({
    projectId: PROJECT_ID,
    timestampColumnName: options.timestampColumnName || "time",
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    ...(options.excludeNames ? { excludeNames: options.excludeNames } : {}),
  });

  return captured;
}

function beforeSettings(query: string | null): string {
  expect(query).not.toBeNull();

  const settingsIndex: number = query!.indexOf(" SETTINGS ");
  expect(settingsIndex).toBeGreaterThan(-1);

  return query!.slice(0, settingsIndex);
}

describe("getDaysWithRows", () => {
  test("groups the project's rows in the window by UTC day, reading only projectId and the timestamp", async () => {
    const dayQuery: CapturedDayQuery = await captureDayQuery(new LogService());

    expect(beforeSettings(dayQuery.query)).toBe(
      "SELECT toString(toDate({p0:Identifier}, 'UTC')) AS day FROM {p1:Identifier}.{p2:Identifier} WHERE projectId = {p3:String} AND {p4:Identifier} >= {p5:DateTime64(9)} AND {p6:Identifier} <= {p7:DateTime64(9)} GROUP BY day ORDER BY day",
    );
    expect(dayQuery.params!["p0"]).toBe("time");
    expect(dayQuery.params!["p2"]).toBe("LogItemV3");
    expect(dayQuery.params!["p3"]).toBe(PROJECT_ID.toString());
    expect(dayQuery.query).not.toContain("byteSize");
  });

  test("uses the timestamp column it is given", async () => {
    const dayQuery: CapturedDayQuery = await captureDayQuery(
      new RumSessionService(),
      { timestampColumnName: "startTime" },
    );

    expect(dayQuery.params!["p0"]).toBe("startTime");
    expect(dayQuery.params!["p2"]).toBe("RumSessionV1");
  });

  test("leaves out excluded names inside the WHERE, bound as one parameter", async () => {
    const names: Array<string> = SessionReplayBudgetMetricTypeUtil.getAll();
    const dayQuery: CapturedDayQuery = await captureDayQuery(
      new MetricService(),
      { excludeNames: names },
    );

    expect(beforeSettings(dayQuery.query)).toContain(
      "AND {p6:Identifier} <= {p7:DateTime64(9)} AND name NOT IN {p8:Array(String)} GROUP BY day",
    );
    expect(dayQuery.params!["p8"]).toEqual(names);
  });

  test("never trades a timeout for a partial answer", async () => {
    const dayQuery: CapturedDayQuery = await captureDayQuery(new LogService());

    expect(dayQuery.query).toContain(" SETTINGS ");
    expect(dayQuery.query).not.toContain("timeout_overflow_mode");
  });

  test("returns the days ClickHouse names, skipping empty values", async () => {
    const dayQuery: CapturedDayQuery = await captureDayQuery(new LogService(), {
      responseRows: [
        { day: "2026-10-17" },
        { day: "" },
        { day: null },
        { day: "2026-10-21" },
      ],
    });

    expect(dayQuery.result).toEqual(["2026-10-17", "2026-10-21"]);
  });

  test("refuses an unknown timestamp column before querying", async () => {
    const service: LogService = new LogService();
    let executed: boolean = false;

    service.executeQuery = (async (): Promise<never> => {
      executed = true;
      throw new Error("must not run");
    }) as unknown as typeof service.executeQuery;

    await expect(
      service.getDaysWithRows({
        projectId: PROJECT_ID,
        timestampColumnName: "notAColumn",
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      }),
    ).rejects.toThrow(BadDataException);
    expect(executed).toBe(false);
  });

  test("refuses to exclude names on a table without a required name column", async () => {
    const service: SpanService = new SpanService();
    let executed: boolean = false;

    service.executeQuery = (async (): Promise<never> => {
      executed = true;
      throw new Error("must not run");
    }) as unknown as typeof service.executeQuery;

    await expect(
      service.getDaysWithRows({
        projectId: PROJECT_ID,
        timestampColumnName: "startTime",
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        excludeNames: ["anything"],
      }),
    ).rejects.toThrow(
      "excludeNames needs a required name column, and SpanItemV3 has none",
    );
    expect(executed).toBe(false);
  });
});
