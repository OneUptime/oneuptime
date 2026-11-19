import TraceAggregationService, {
  SessionCountRequest as TraceSessionCountRequest,
  SessionCountResult as TraceSessionCountResult,
} from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService, {
  SessionCountRequest as ExceptionSessionCountRequest,
  SessionCountResult as ExceptionSessionCountResult,
} from "../../../Server/Services/ExceptionAggregationService";
import LogAggregationService, {
  ANALYTICS_AGGREGATIONS,
  AnalyticsRequest,
  AnalyticsTableRow,
} from "../../../Server/Services/LogAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import LogService from "../../../Server/Services/LogService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The three reads a mobile RUM application's Overview adds (#9588):
 *
 *   - the sessions a scope's spans belong to (the Sessions tile);
 *   - the sessions the matching exceptions happened in (the sessions a
 *     crash ended, for the crash-free share);
 *   - a log attribute added up (the frames an app.jank event reports in
 *     app.jank.frame_count - one event stands for several frames).
 *
 * The SQL each compiles to is pinned here, with the filters a caller's
 * service scope adds, and the row each reads back.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const APP_ID: ObjectID = new ObjectID("84858d6c-1111-4aaa-8bbb-000000000001");
const START: Date = new Date("2026-11-19T09:00:00.000Z");
const END: Date = new Date("2026-11-19T10:00:00.000Z");

function normalized(statement: Statement): string {
  return statement.query.replace(/\s+/g, " ");
}

function params(statement: Statement): Array<string> {
  return Object.values(statement.query_params).map((value: unknown) => {
    return String(value);
  });
}

// A ClickHouse JSON answer of one row, as executeQuery resolves it.
function oneRow(row: Record<string, unknown>): unknown {
  return {
    json: async (): Promise<unknown> => {
      return { data: [row] };
    },
  };
}

function noRows(): unknown {
  return {
    json: async (): Promise<unknown> => {
      return { data: [] };
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TraceAggregationService sessions", () => {
  const request: TraceSessionCountRequest = {
    projectId: PROJECT_ID,
    startTime: START,
    endTime: END,
    serviceIds: [APP_ID],
  };

  test("counts distinct session ids, leaving out spans with none, beside every span read", () => {
    const sql: string = normalized(
      TraceAggregationService.buildSessionCountStatement(request),
    );

    expect(sql).toContain(
      "SELECT uniqIf(sessionId, sessionId != '') AS sessions, count() AS cnt FROM SpanItemV3",
    );
  });

  test("reads only the project's spans in the window, past their retention left out", () => {
    const statement: Statement =
      TraceAggregationService.buildSessionCountStatement(request);
    const sql: string = normalized(statement);

    expect(sql).toMatch(/WHERE projectId = \{p\d+:/);
    expect(sql).toMatch(/AND startTime >= \{p\d+:DateTime/);
    expect(sql).toMatch(/AND startTime <= \{p\d+:DateTime/);
    expect(sql).toContain("AND retentionDate >= now()");
    expect(params(statement)).toContain(PROJECT_ID.toString());
  });

  test("is scoped to the application the caller asked for", () => {
    const statement: Statement =
      TraceAggregationService.buildSessionCountStatement(request);

    expect(normalized(statement)).toContain("primaryEntityId");
    expect(params(statement).join(" ")).toContain(APP_ID.toString());
  });

  test("takes the same span filters every other trace read takes", () => {
    const sql: string = normalized(
      TraceAggregationService.buildSessionCountStatement({
        ...request,
        spanNames: ["AppStart"],
        rootOnly: true,
      }),
    );

    expect(sql).toContain("AND isRootSpan = 1");
    expect(sql).toContain("name IN");
  });

  test("answers one row: the sessions and the spans, as numbers", async () => {
    jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(oneRow({ sessions: "12", cnt: "4096" }) as never);

    const result: TraceSessionCountResult =
      await TraceAggregationService.getSessionCount(request);

    expect(result).toEqual({ sessions: 12, spans: 4096 });
  });

  test("an empty answer is no sessions and no spans, never a failure", async () => {
    jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(noRows() as never);

    expect(await TraceAggregationService.getSessionCount(request)).toEqual({
      sessions: 0,
      spans: 0,
    });
  });

  test("spans that name no session read as spans, not sessions", async () => {
    jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(oneRow({ sessions: 0, cnt: 87 }) as never);

    expect(await TraceAggregationService.getSessionCount(request)).toEqual({
      sessions: 0,
      spans: 87,
    });
  });
});

describe("ExceptionAggregationService sessions", () => {
  const request: ExceptionSessionCountRequest = {
    projectId: PROJECT_ID,
    startTime: START,
    endTime: END,
    serviceIds: [APP_ID],
  };

  test("counts distinct session ids of the matching occurrences, beside every occurrence", () => {
    const sql: string = normalized(
      ExceptionAggregationService.buildSessionCountStatement(request),
    );

    expect(sql).toContain("uniqIf(sessionId, sessionId != '') AS sessions");
    expect(sql).toContain("count() AS cnt");
    expect(sql).toContain("AND retentionDate >= now()");
  });

  /*
   * A crash of a mobile app is an unhandled exception that is no ANR: the
   * sessions a crash ended are counted with both filters at once.
   */
  test("counts the sessions a crash ended: unhandled, ANRs left out", () => {
    const statement: Statement =
      ExceptionAggregationService.buildSessionCountStatement({
        ...request,
        escaped: true,
        excludedExceptionTypes: ["ANR"],
      });
    const sql: string = normalized(statement);

    expect(sql).toMatch(/AND escaped = \{p\d+:/);
    expect(sql).toContain("exceptionType NOT IN");
    expect(params(statement)).toContain("ANR");
  });

  test("counts the sessions an ANR froze: the type ANR alone", () => {
    const statement: Statement =
      ExceptionAggregationService.buildSessionCountStatement({
        ...request,
        exceptionTypes: ["ANR"],
      });

    expect(normalized(statement)).toContain("exceptionType IN");
    expect(normalized(statement)).not.toContain("exceptionType NOT IN");
    expect(params(statement)).toContain("ANR");
  });

  test("answers the sessions and the occurrences, as numbers", async () => {
    jest
      .spyOn(ExceptionInstanceService, "executeQuery")
      .mockResolvedValue(oneRow({ sessions: "3", cnt: "5" }) as never);

    const result: ExceptionSessionCountResult =
      await ExceptionAggregationService.getSessionCount(request);

    expect(result).toEqual({ sessions: 3, occurrences: 5 });
  });

  test("an empty answer is no sessions", async () => {
    jest
      .spyOn(ExceptionInstanceService, "executeQuery")
      .mockResolvedValue(noRows() as never);

    expect(await ExceptionAggregationService.getSessionCount(request)).toEqual({
      sessions: 0,
      occurrences: 0,
    });
  });
});

describe("LogAggregationService analytics: a sum of an attribute", () => {
  const frames: AnalyticsRequest = {
    projectId: PROJECT_ID,
    startTime: START,
    endTime: END,
    bucketSizeInMinutes: 5,
    chartType: "table",
    groupBy: ["app.jank.threshold"],
    aggregation: "sum",
    aggregationField: "app.jank.frame_count",
    serviceIds: [APP_ID],
    attributes: { "event.name": "app.jank" },
    limit: 10,
  };

  function tableStatement(request: AnalyticsRequest): Statement {
    return (
      LogAggregationService as unknown as {
        buildAnalyticsTableStatement: (request: AnalyticsRequest) => Statement;
      }
    ).buildAnalyticsTableStatement(request);
  }

  function timeseriesStatement(request: AnalyticsRequest): Statement {
    return (
      LogAggregationService as unknown as {
        buildAnalyticsTimeseriesStatement: (
          request: AnalyticsRequest,
        ) => Statement;
      }
    ).buildAnalyticsTimeseriesStatement(request);
  }

  test("sum is one of the aggregations the route accepts", () => {
    expect(ANALYTICS_AGGREGATIONS).toEqual(["count", "unique", "sum"]);
  });

  test("adds up the attribute read as a number, which a missing or non-numeric value leaves out", () => {
    const statement: Statement = tableStatement(frames);
    const sql: string = normalized(statement);

    expect(sql).toMatch(
      /SELECT sum\(toFloat64OrZero\(attributes\[\{p\d+:String\}\]\)\) AS cnt/,
    );
    expect(params(statement)).toContain("app.jank.frame_count");
  });

  test("ranks the table by the total, so the biggest groups come first", () => {
    expect(normalized(tableStatement(frames))).toContain("ORDER BY cnt DESC");
  });

  test("keeps only the rows whose attributes match, as the histogram does", () => {
    const statement: Statement = tableStatement(frames);

    expect(params(statement)).toContain("event.name");
    expect(params(statement)).toContain("app.jank");
  });

  test("groups by the threshold the frames were counted against", () => {
    const statement: Statement = tableStatement(frames);

    // The alias is bound as an identifier, and grouped on.
    expect(params(statement)).toContain("attr_app_jank_threshold");
    expect(normalized(statement)).toContain("GROUP BY attr_app_jank_threshold");
    expect(params(statement)).toContain("app.jank.threshold");
  });

  test("the timeseries adds up per bucket the same way", () => {
    const sql: string = normalized(
      timeseriesStatement({ ...frames, chartType: "timeseries" }),
    );

    expect(sql).toMatch(
      /sum\(toFloat64OrZero\(attributes\[\{p\d+:String\}\]\)\) AS cnt/,
    );
    expect(sql).toContain("GROUP BY bucket");
  });

  // Only the code path: the logs' top-level columns hold no number to add up.
  test("a top-level column is read through its text", () => {
    const sql: string = normalized(
      tableStatement({ ...frames, aggregationField: "severityText" }),
    );

    expect(sql).toContain(
      "SELECT sum(toFloat64OrZero(toString(severityText))) AS cnt",
    );
  });

  test("an attribute key that is not one refuses the read", () => {
    expect(() => {
      return tableStatement({
        ...frames,
        aggregationField: "x') OR 1=1 --",
      });
    }).toThrow(BadDataException);
  });

  test("a count and a unique read as they always have", () => {
    expect(
      normalized(tableStatement({ ...frames, aggregation: "count" })),
    ).toContain("SELECT count() AS cnt");
    expect(
      normalized(
        tableStatement({
          ...frames,
          aggregation: "unique",
          aggregationField: "traceId",
        }),
      ),
    ).toContain("SELECT uniqExact(traceId) AS cnt");
  });

  test("a table row carries the total as its count", async () => {
    jest.spyOn(LogService, "executeQuery").mockResolvedValue(
      oneRow({
        cnt: "38",
        attr_app_jank_threshold: "0.7",
      }) as never,
    );

    const rows: Array<AnalyticsTableRow> =
      await LogAggregationService.getAnalyticsTable(frames);

    expect(rows).toEqual([
      { groupValues: { "app.jank.threshold": "0.7" }, count: 38 },
    ]);
  });
});
