import LogAggregationService, {
  ErrorPatternCodeLocation,
  LOG_CODE_FILE_ATTRIBUTE_KEYS,
  LOG_EXCEPTION_ATTRIBUTE_KEYS,
  ServiceLogHealthRow,
  ServiceLogPatterns,
} from "../../../Server/Services/LogAggregationService";
import LogDatabaseService from "../../../Server/Services/LogService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The reads Logs' AI section makes once an hour for every project with
 * "Find and fix error, missing and noisy logs" on (Utils/Logs/LogInsight):
 * unattended, so each must stay bounded - one hour, the service where it
 * can, a sample where a whole hour would be too much - and stop with an
 * error at its time limit ('throw'), never answer about part of the hour.
 * Nothing a caller supplies reaches the SQL text.
 */

const projectId: ObjectID = new ObjectID(
  "5a110000-0000-4000-8000-000000000001",
);
const serviceId: ObjectID = new ObjectID(
  "5a110000-0000-4000-8000-000000000002",
);
const startTime: Date = new Date("2026-10-24T08:00:00.000Z");
const endTime: Date = new Date("2026-10-24T09:00:00.000Z");
const WHITESPACE: RegExp = /\s+/g;

function stubAndCapture(rows: Array<JSONObject>): Array<Statement> {
  const captured: Array<Statement> = [];
  const fakeResult: Results = {
    json: () => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  jest
    .spyOn(LogDatabaseService, "executeQuery")
    .mockImplementation((statement: Statement | string): Promise<Results> => {
      captured.push(statement as Statement);
      return Promise.resolve(fakeResult);
    });

  return captured;
}

function sql(statement: Statement): string {
  return statement.query.replace(WHITESPACE, " ");
}

function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getServiceLogHealth: every service's logs over the hour, in one pass", () => {
  test("counts every line, the Error and Fatal ones, and the ones with a trace id", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getServiceLogHealth({
      projectId,
      startTime,
      endTime,
      limit: 200,
    });

    const query: string = sql(captured[0]!);

    expect(query).toContain("toString(primaryEntityId) AS entityId");
    expect(query).toContain("count() AS cnt");
    expect(query).toContain("countIf(severityText IN (");
    expect(query).toContain("AS errorCnt");
    expect(query).toContain("countIf(ifNull(traceId, '') != '') AS tracedCnt");
    expect(query).toContain("GROUP BY entityId ORDER BY cnt DESC LIMIT");

    const severities: unknown = params(captured[0]!).find(
      (value: unknown): boolean => {
        return Array.isArray(value) || value instanceof Includes;
      },
    );

    expect(JSON.stringify(severities)).toContain("Error");
    expect(JSON.stringify(severities)).toContain("Fatal");
  });

  test("reads one half-open hour of the project, past retention left out", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getServiceLogHealth({
      projectId,
      startTime,
      endTime,
      limit: 200,
    });

    const query: string = sql(captured[0]!);

    expect(query).toMatch(/WHERE projectId = \{p\d+:\w+\} AND time >= /u);
    expect(query).toMatch(/AND time < \{p\d+:\w+\}/u);
    expect(query).toContain("retentionDate >= now()");
    expect(params(captured[0]!)).toContain(projectId.toString());
  });

  test("stops with an error at its time limit, never with part of the counts", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getServiceLogHealth({
      projectId,
      startTime,
      endTime,
      limit: 200,
    });

    const query: string = sql(captured[0]!);

    expect(query).toContain("max_execution_time = 45");
    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(query).not.toContain("'break'");
  });

  test("one row per service, busiest first, cut to the limit", async () => {
    const a: string = "5a110000-0000-4000-8000-0000000000a1";
    const b: string = "5a110000-0000-4000-8000-0000000000a2";

    stubAndCapture([
      { entityId: a.toUpperCase(), cnt: "100", errorCnt: "4", tracedCnt: 90 },
      { entityId: b, cnt: 900, errorCnt: 30, tracedCnt: "0" },
      { entityId: a, cnt: 50, errorCnt: 1, tracedCnt: 50 },
      { entityId: "", cnt: 4000 },
      { entityId: "5a110000-0000-4000-8000-0000000000a3", cnt: 0 },
      { entityId: "5a110000-0000-4000-8000-0000000000a4", cnt: "x" },
    ]);

    const rows: Array<ServiceLogHealthRow> =
      await LogAggregationService.getServiceLogHealth({
        projectId,
        startTime,
        endTime,
        limit: 200,
      });

    expect(rows).toEqual([
      { primaryEntityId: b, logCount: 900, errorLogCount: 30, tracedLogCount: 0 },
      {
        primaryEntityId: a,
        logCount: 150,
        errorLogCount: 5,
        tracedLogCount: 140,
      },
    ]);

    expect(
      LogAggregationService.toServiceLogHealth(
        [
          { entityId: a, cnt: 10 },
          { entityId: b, cnt: 20 },
        ],
        1,
      ),
    ).toEqual([
      { primaryEntityId: b, logCount: 20, errorLogCount: 0, tracedLogCount: 0 },
    ]);
  });
});

describe("error messages without an exception", () => {
  test("excludeExceptionRecords leaves out the lines that record an exception", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns({
      projectId,
      startTime,
      endTime,
      serviceIds: [serviceId],
      excludeExceptionRecords: true,
      limit: 10,
    });

    const query: string = sql(captured[0]!);

    expect(query).toMatch(/AND NOT hasAny\(attributeKeys, \{p\d+:Array\(String\)\}\)/u);
    expect(params(captured[0]!)).toContainEqual([
      ...LOG_EXCEPTION_ATTRIBUTE_KEYS,
    ]);
    expect([...LOG_EXCEPTION_ATTRIBUTE_KEYS]).toEqual([
      "exception.type",
      "exception.message",
      "exception.stacktrace",
    ]);
  });

  test("without it, Logs Insights' Top errors reads every error, as before", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns({
      projectId,
      startTime,
      endTime,
    });

    expect(sql(captured[0]!)).not.toContain("NOT hasAny(attributeKeys");
  });
});

describe("getErrorPatternCodeLocations: where a message's lines were logged", () => {
  test("reads the code.* attributes, older and newer names, of that message's lines only", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getErrorPatternCodeLocations({
      projectId,
      startTime,
      endTime,
      serviceIds: [serviceId],
      excludeExceptionRecords: true,
      pattern: "Payment provider returned <num>",
      limit: 3,
    });

    const query: string = sql(captured[0]!);

    expect(query).toContain(
      "if(attributes['code.filepath'] != '', attributes['code.filepath'], attributes['code.file.path']) AS filePath",
    );
    expect(query).toContain(
      "if(attributes['code.function'] != '', attributes['code.function'], attributes['code.function.name']) AS functionName",
    );
    expect(query).toContain(
      "if(attributes['code.lineno'] != '', attributes['code.lineno'], attributes['code.line.number']) AS lineNumber",
    );
    expect(query).toMatch(/AND hasAny\(attributeKeys, \{p\d+:Array\(String\)\}\)/u);
    expect(params(captured[0]!)).toContainEqual([
      ...LOG_CODE_FILE_ATTRIBUTE_KEYS,
    ]);
    expect(query).toContain("HAVING filePath != ''");
    expect(query).toContain("timeout_overflow_mode = 'throw'");
    // The message rides as a parameter, never as SQL text.
    expect(query).not.toContain("Payment provider returned");
    expect(params(captured[0]!)).toContain("Payment provider returned <num>");
  });

  test("at most three locations, however many are asked for", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getErrorPatternCodeLocations({
      projectId,
      startTime,
      endTime,
      pattern: "x y",
      limit: 500,
    });

    expect(params(captured[0]!)).toContain(3);
  });

  test("a row with no file is no location", async () => {
    stubAndCapture([
      {
        filePath: "src/pay.py",
        functionName: "charge",
        lineNumber: "88",
        cnt: "12",
      },
      { filePath: "  ", functionName: "x", lineNumber: "1", cnt: 3 },
    ]);

    const locations: Array<ErrorPatternCodeLocation> =
      await LogAggregationService.getErrorPatternCodeLocations({
        projectId,
        startTime,
        endTime,
        pattern: "x y",
        limit: 3,
      });

    expect(locations).toEqual([
      {
        filePath: "src/pay.py",
        functionName: "charge",
        lineNumber: "88",
        count: 12,
      },
    ]);
  });
});

describe("getServiceLogPatterns: a sample of one service's lines, by message", () => {
  test("reads at most the sample's lines of the one service, in no order, then groups them", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getServiceLogPatterns({
      projectId,
      serviceId,
      startTime,
      endTime,
      sampleSize: 100000,
      limit: 5,
    });

    const query: string = sql(captured[0]!);
    const inner: string = query.slice(
      query.indexOf("FROM (SELECT body, time, severityText"),
      query.indexOf("GROUP BY pattern"),
    );

    expect(inner).toMatch(/AND primaryEntityId = \{p\d+:\w+\}/u);
    expect(inner).toContain("retentionDate >= now()");
    expect(inner).toContain("notEmpty(trimBoth(ifNull(body, '')))");
    expect(inner).toMatch(/LIMIT \{p\d+:\w+\}\)/u);
    // The newest lines would be found by reading the whole hour.
    expect(inner).not.toContain("ORDER BY");
    expect(params(captured[0]!)).toContain(100000);
    expect(params(captured[0]!)).toContain(serviceId.toString());
  });

  test("says how many lines the sample read, beside the most common messages", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getServiceLogPatterns({
      projectId,
      serviceId,
      startTime,
      endTime,
      sampleSize: 100000,
      limit: 5,
    });

    const query: string = sql(captured[0]!);

    expect(query).toContain("sum(cnt) OVER () AS sampled");
    expect(query).toContain("groupUniqArray(");
    expect(query).toContain("(toString(severityText)) AS severities");
    expect(query).toContain("WHERE pattern != '' ORDER BY cnt DESC, pattern ASC LIMIT");
    expect(query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("its rows: the messages, and the lines the sample read", async () => {
    stubAndCapture([
      {
        pattern: "cache hit for key <uuid>",
        cnt: "62000",
        sampleBody: "cache hit for key 1f",
        severities: ["Debug"],
        sampled: "100000",
      },
      { pattern: "", cnt: 9, sampled: 100000 },
      {
        pattern: "served <num> ms",
        cnt: 4000,
        sampleBody: "served 4 ms",
        severities: ["Information"],
        sampled: 100000,
      },
    ]);

    const sample: ServiceLogPatterns =
      await LogAggregationService.getServiceLogPatterns({
        projectId,
        serviceId,
        startTime,
        endTime,
        sampleSize: 100000,
        limit: 5,
      });

    expect(sample.sampledLogCount).toBe(100000);
    expect(sample.patterns).toEqual([
      {
        pattern: "cache hit for key <uuid>",
        sampleBody: "cache hit for key 1f",
        count: 62000,
        severities: ["Debug"],
      },
      {
        pattern: "served <num> ms",
        sampleBody: "served 4 ms",
        count: 4000,
        severities: ["Information"],
      },
    ]);
  });

  test("nothing read, nothing sampled", async () => {
    stubAndCapture([]);

    expect(
      await LogAggregationService.getServiceLogPatterns({
        projectId,
        serviceId,
        startTime,
        endTime,
        sampleSize: 100000,
        limit: 5,
      }),
    ).toEqual({ sampledLogCount: 0, patterns: [] });
  });
});

describe("getServiceLogCountsByTrace: did these requests write a log line", () => {
  test("counts one service's lines in the given traces, by trace", async () => {
    const captured: Array<Statement> = stubAndCapture([
      { traceId: "A1", cnt: "3" },
      { traceId: "a1", cnt: 2 },
      { traceId: "b2", cnt: 0 },
    ]);

    const counts: Map<string, number> =
      await LogAggregationService.getServiceLogCountsByTrace({
        projectId,
        serviceId,
        startTime,
        endTime,
        traceIds: ["A1", "b2", " ", "A1"],
      });

    const query: string = sql(captured[0]!);

    expect(query).toMatch(/AND primaryEntityId = \{p\d+:\w+\}/u);
    expect(query).toMatch(/AND traceId IN \(\{p\d+:Array\(String\)\}\)/u);
    expect(query).toContain("GROUP BY traceId");
    expect(query).toContain("retentionDate >= now()");
    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(Array.from(counts.entries())).toEqual([["a1", 5]]);
  });

  test("no trace, no read", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    expect(
      (
        await LogAggregationService.getServiceLogCountsByTrace({
          projectId,
          serviceId,
          startTime,
          endTime,
          traceIds: ["", "  "],
        })
      ).size,
    ).toBe(0);
    expect(captured).toHaveLength(0);
  });

  test("at most a hundred traces in one read", async () => {
    const captured: Array<Statement> = stubAndCapture([]);
    const traceIds: Array<string> = Array.from(
      { length: 150 },
      (_value: unknown, index: number): string => {
        return `t${index}`;
      },
    );

    await LogAggregationService.getServiceLogCountsByTrace({
      projectId,
      serviceId,
      startTime,
      endTime,
      traceIds,
    });

    const named: unknown = params(captured[0]!).find(
      (value: unknown): boolean => {
        return JSON.stringify(value).includes("t0");
      },
    );

    expect(JSON.stringify(named)).toContain("t99");
    expect(JSON.stringify(named)).not.toContain("t100");
  });
});
