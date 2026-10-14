import TelemetryAttributeServiceInstance, {
  AttributeValueLookupWindow,
  TelemetryAttributeService,
} from "../../../Server/Services/TelemetryAttributeService";
import LogService from "../../../Server/Services/LogService";
import SpanService from "../../../Server/Services/SpanService";
import MetricService from "../../../Server/Services/MetricService";
import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  INTERACTIVE_READ_TIME_LIMIT,
  SUGGESTION_READ_TIME_LIMIT,
} from "../../../Server/Utils/AnalyticsDatabase/QuerySettingsHelper";
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import {
  ATTRIBUTE_VALUES_LIMIT,
  MAX_SUGGESTED_ATTRIBUTE_VALUE_LENGTH,
} from "../../../Types/Telemetry/AttributeSuggestionLimits";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE ATTRIBUTE VALUE LOOKUP (issue #4708).
 *
 * The value picker behind `@key:` used to read every row of the last day
 * that held the key - the whole map of each - and sort them all, for every
 * lookup: 40 to 57 CPU-seconds on a project writing 30 million log lines a
 * day, whatever the key. These tests pin what a lookup asks ClickHouse now
 * (only rows that can hold the key, stopping at enough rows, enough values
 * or a rows-read budget, within a 10-second limit), the window it reads, and
 * how answers are reused: for five minutes, for the same project and scope
 * only, one read for readers asking at once, and a lookup that ran out of
 * time not retried for a minute. AttributeValueSuggestionsClickhouse.test.ts
 * shows what ClickHouse does with it.
 */

interface Spy {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (implementation: (...args: Array<any>) => any) => unknown;
  mockResolvedValue: (value: unknown) => unknown;
  mockRejectedValue: (value: unknown) => unknown;
  mockRejectedValueOnce: (value: unknown) => unknown;
}

function spyOn(target: unknown, method: string): Spy {
  return jest.spyOn(target as never, method as never) as unknown as Spy;
}

function dbResult(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return { data: rows };
    },
  };
}

function valueRows(values: Array<string>): Array<JSONObject> {
  return values.map((value: string): JSONObject => {
    return { attributeValue: value };
  });
}

function statementOf(spy: Spy, call: number = -1): Statement {
  const calls: Array<Array<unknown>> = spy.mock.calls;
  const index: number = call < 0 ? calls.length + call : call;

  return calls[index]![0] as Statement;
}

function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

// The statement's SQL with the bound parameters written in, for reading.
function readable(statement: Statement): string {
  let query: string = statement.query;

  for (const [name, value] of Object.entries(statement.query_params)) {
    query = query
      .split(`{${name}:Identifier}`)
      .join(String(value))
      .split(`{${name}:String}`)
      .join(`'${String(value)}'`)
      .split(`{${name}:Int32}`)
      .join(String(value))
      .split(`{${name}:DateTime}`)
      .join(`'${String(value)}'`)
      .split(`{${name}:Array(String)}`)
      .join(JSON.stringify(value));
  }

  return query;
}

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// 2026-10-14 12:02:30 UTC: not on a five-minute edge.
const NOW: Date = new Date(Date.UTC(2026, 9, 14, 12, 2, 30));

const projectA: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-000000004708");
const projectB: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000004708");
const serviceA: ObjectID = new ObjectID("cccccccc-0000-4000-8000-000000004708");
const serviceB: ObjectID = new ObjectID("dddddddd-0000-4000-8000-000000004708");

let logQuery: Spy;

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ["nextTick", "setImmediate", "queueMicrotask"],
  });
  TelemetryAttributeService.clearValueSuggestionCache();
  logQuery = spyOn(LogService, "executeQuery");
  logQuery.mockResolvedValue(dbResult(valueRows(["GET", "POST"])));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type FetchInput = Parameters<
  typeof TelemetryAttributeServiceInstance.fetchAttributeValues
>[0];

function lookUp(overrides: Partial<FetchInput> = {}): Promise<Array<string>> {
  return TelemetryAttributeServiceInstance.fetchAttributeValues({
    projectId: projectA,
    telemetryType: TelemetryType.Log,
    attributeKey: "http.method",
    ...overrides,
  });
}

describe("one lookup reads only what it needs", () => {
  test("rows are picked on the keys array, which the key index can skip granules for", async () => {
    await lookUp();

    const statement: Statement = statementOf(logQuery);
    const sql: string = readable(statement);

    expect(sql).toContain("AND has(attributeKeys, 'http.method')");
    // mapContains reads every row's map: never on a table with the array.
    expect(sql).not.toContain("mapContains(");
    expect(sql).toContain("FROM LogItemV3");
    expect(sql).toContain(`WHERE projectId = '${projectA.toString()}'`);
  });

  test("it stops at 10,000 rows with the key and at 100 values, and is not sorted in SQL", async () => {
    await lookUp();

    const sql: string = readable(statementOf(logQuery));

    // The inner read collects rows, the outer DISTINCT stops at the values.
    expect(sql).toMatch(/SELECT DISTINCT attributeValue\s+FROM \(/);
    expect(sql).toMatch(/LIMIT 10000\s+\)\s+LIMIT 100/);
    expect(ATTRIBUTE_VALUES_LIMIT).toBe(100);
    /*
     * An ORDER BY - in either query - makes ClickHouse read every row with
     * the key before it answers: the cost this replaces.
     */
    expect(sql).not.toContain("ORDER BY");
  });

  test("it reads at most a million rows in all, in 10 seconds, on four threads and small blocks", async () => {
    await lookUp();

    const sql: string = readable(statementOf(logQuery));
    const settings: string = sql.substring(sql.indexOf("SETTINGS"));

    expect(settings).toContain("max_execution_time = 10");
    expect(settings).toContain("timeout_overflow_mode = 'throw'");
    expect(settings).toContain("max_rows_to_read = 1000000");
    expect(settings).toContain("read_overflow_mode = 'break'");
    expect(settings).toContain("max_threads = 4");
    expect(settings).toContain("max_block_size = 8192");
    expect(settings).toContain("preferred_block_size_bytes = 1048576");
    // The time limit never breaks off: only the rows budget does.
    expect(settings).not.toContain("timeout_overflow_mode = 'break'");
  });

  test("empty values and values too long for a dropdown are left out in the read", async () => {
    await lookUp();

    const sql: string = readable(statementOf(logQuery));

    expect(sql).toContain("AND attributes['http.method'] != ''");
    expect(sql).toContain(
      `AND lengthUTF8(attributes['http.method']) <= ${MAX_SUGGESTED_ATTRIBUTE_VALUE_LENGTH}`,
    );
    expect(MAX_SUGGESTED_ATTRIBUTE_VALUE_LENGTH).toBe(1000);
  });

  test("the attribute key is a bound parameter, never SQL text", async () => {
    const key: string = "evil') OR 1=1 --";

    await lookUp({ attributeKey: key });

    const statement: Statement = statementOf(logQuery);

    expect(statement.query).not.toContain(key);
    expect(params(statement)).toContain(key);
  });

  test("the search text narrows inside the sample, escaped, case ignored", async () => {
    await lookUp({ searchText: "  100%_off  " });

    const statement: Statement = statementOf(logQuery);
    const sql: string = readable(statement);

    expect(params(statement)).toContain("%100\\%\\_off%");
    // Inside the inner read, before its LIMIT picks the rows.
    expect(sql.indexOf("ILIKE")).toBeLessThan(sql.indexOf("LIMIT 10000"));
  });

  test("whitespace is not a search text", async () => {
    await lookUp({ searchText: "   " });

    expect(statementOf(logQuery).query).not.toContain("ILIKE");
  });

  test("a limited caller's scope narrows the rows inside the sample", async () => {
    await lookUp({
      serviceFilter: {
        serviceIds: [serviceA],
        excludedServiceIds: [serviceB],
      },
    });

    const sql: string = readable(statementOf(logQuery));

    expect(sql).toContain(
      `AND primaryEntityId IN (["${serviceA.toString()}"])`,
    );
    expect(sql).toContain(
      `AND primaryEntityId NOT IN (["${serviceB.toString()}"])`,
    );
    expect(sql.indexOf("primaryEntityId IN")).toBeLessThan(
      sql.indexOf("LIMIT 10000"),
    );
  });

  test("an empty key or one no telemetry could have is answered without a read", async () => {
    expect(await lookUp({ attributeKey: "" })).toEqual([]);
    expect(await lookUp({ attributeKey: "k".repeat(1025) })).toEqual([]);
    expect(logQuery.mock.calls).toHaveLength(0);

    await lookUp({ attributeKey: "k".repeat(1024) });
    expect(logQuery.mock.calls).toHaveLength(1);
  });

  test("profiles have no attribute values to offer", async () => {
    expect(await lookUp({ telemetryType: TelemetryType.Profile })).toEqual([]);
    expect(logQuery.mock.calls).toHaveLength(0);
  });

  test("the answer is trimmed, without blanks or repeats, in alphabetical order", async () => {
    logQuery.mockResolvedValue(
      dbResult([
        { attributeValue: "staging" },
        { attributeValue: " production " },
        { attributeValue: "production" },
        { attributeValue: "   " },
        { attributeValue: null },
        { attributeValue: 7 },
        { attributeValue: "development" },
      ]),
    );

    expect(await lookUp({ attributeKey: "env" })).toEqual([
      "development",
      "production",
      "staging",
    ]);
  });
});

describe("every signal reads its own table the same bounded way", () => {
  const CASES: Array<{
    type: TelemetryType;
    service: unknown;
    timeColumn: string;
  }> = [
    {
      type: TelemetryType.Log,
      service: LogService,
      timeColumn: "time",
    },
    {
      type: TelemetryType.Trace,
      service: SpanService,
      timeColumn: "startTime",
    },
    {
      type: TelemetryType.Exception,
      service: ExceptionInstanceService,
      timeColumn: "time",
    },
    {
      type: TelemetryType.Metric,
      service: MetricService,
      timeColumn: "time",
    },
    {
      type: TelemetryType.SecurityEvent,
      service: SecurityEventService,
      timeColumn: "time",
    },
  ];

  test.each(CASES)("$type", async (testCase: (typeof CASES)[number]) => {
    const query: Spy = spyOn(testCase.service, "executeQuery");
    query.mockResolvedValue(dbResult(valueRows(["a"])));

    expect(await lookUp({ telemetryType: testCase.type })).toEqual(["a"]);

    const sql: string = readable(statementOf(query));
    const table: string = (testCase.service as { model: { tableName: string } })
      .model.tableName;

    expect(sql).toContain(`FROM ${table}`);
    expect(sql).toContain(`AND ${testCase.timeColumn} >= '`);
    expect(sql).toContain(`AND ${testCase.timeColumn} <= '`);
    expect(sql).toContain("AND has(attributeKeys, 'http.method')");
    expect(sql).toMatch(/LIMIT 10000\s+\)\s+LIMIT 100/);
    expect(sql).toContain("max_rows_to_read = 1000000");
    expect(sql).not.toContain("ORDER BY");
  });

  test("a metric's values come from that metric's rows", async () => {
    const query: Spy = spyOn(MetricService, "executeQuery");
    query.mockResolvedValue(dbResult([]));

    await lookUp({
      telemetryType: TelemetryType.Metric,
      metricName: "http.server.duration",
    });

    const sql: string = readable(statementOf(query));

    expect(sql).toContain("AND name = 'http.server.duration'");
    expect(sql.indexOf("AND name =")).toBeLessThan(sql.indexOf("LIMIT 10000"));
  });

  test("a table without the keys array checks the map itself, with the same bounds", () => {
    const statement: Statement = (
      TelemetryAttributeService as unknown as {
        buildAttributeValuesStatement: (data: JSONObject) => Statement;
      }
    ).buildAttributeValuesStatement({
      projectId: projectA,
      source: {
        tableName: "OldTable",
        attributesColumn: "attributes",
        timeColumn: "time",
      },
      attributeKey: "env",
    } as unknown as JSONObject);

    const sql: string = readable(statement);

    expect(sql).toContain("AND mapContains(attributes, 'env')");
    expect(sql).not.toContain("has(");
    expect(sql).toMatch(/LIMIT 10000\s+\)\s+LIMIT 100/);
    expect(sql).toContain("max_rows_to_read = 1000000");
  });

  /*
   * The platform's own metrics keep every version of a point, read through
   * the newest one. A rows budget would cut a point's versions apart, so
   * that read keeps its shape - and gets the time limit and answer size.
   */
  test("a metric the platform records keeps its exact read, within the suggestion limits", async () => {
    const query: Spy = spyOn(MutableMetricService, "executeQuery");
    query.mockResolvedValue(dbResult(valueRows(["sev-1"])));

    expect(
      await lookUp({
        telemetryType: TelemetryType.Metric,
        metricName: "oneuptime.incident.time_to_resolve",
        attributeKey: "incident.severity",
      }),
    ).toEqual(["sev-1"]);

    const sql: string = readable(statementOf(query));

    expect(sql).toContain("argMax(attributes, version) AS attributes");
    expect(sql).toContain("mapContains(attributes, 'incident.severity')");
    expect(sql).toMatch(/LIMIT 100\s+SETTINGS/);
    expect(sql).toContain("max_execution_time = 10");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("max_rows_to_read");
    expect(sql).not.toContain("'break'");
    expect(sql).not.toContain("ORDER BY");
  });
});

describe("the window a lookup reads", () => {
  function windowOf(statement: Statement): { start: string; end: string } {
    const dates: Array<string> = Object.entries(statement.query_params)
      .filter(([name]: [string, unknown]): boolean => {
        return statement.query.includes(`{${name}:DateTime}`);
      })
      .map(([, value]: [string, unknown]): string => {
        return String(value);
      });

    return { start: dates[0]!, end: dates[1]! };
  }

  test("without a window: the last day, its edges on whole five minutes", async () => {
    await lookUp();

    expect(windowOf(statementOf(logQuery))).toEqual({
      start: "2026-10-13 12:05:00",
      end: "2026-10-14 12:05:00",
    });
  });

  test("the reader's window, widened to whole five minutes", async () => {
    await lookUp({
      startTime: new Date(Date.UTC(2026, 9, 7, 14, 3, 27)),
      endTime: new Date(Date.UTC(2026, 9, 7, 14, 58, 10)),
    });

    expect(windowOf(statementOf(logQuery))).toEqual({
      start: "2026-10-07 14:00:00",
      end: "2026-10-07 15:00:00",
    });
  });

  test("a window longer than a week is read from its newest week", async () => {
    await lookUp({
      startTime: new Date(NOW.getTime() - 90 * DAY),
      endTime: NOW,
    });

    expect(windowOf(statementOf(logQuery))).toEqual({
      start: "2026-10-07 12:05:00",
      end: "2026-10-14 12:05:00",
    });
  });

  test("a window given only its start ends now; only its end, starts a day before", () => {
    expect(
      TelemetryAttributeService.getValueLookupWindow({
        startTime: new Date(NOW.getTime() - 3 * HOUR),
        now: NOW,
      }),
    ).toEqual({
      startTime: new Date(Date.UTC(2026, 9, 14, 9, 0, 0)),
      endTime: new Date(Date.UTC(2026, 9, 14, 12, 5, 0)),
    });

    expect(
      TelemetryAttributeService.getValueLookupWindow({
        endTime: new Date(Date.UTC(2026, 9, 1, 0, 0, 0)),
        now: NOW,
      }),
    ).toEqual({
      startTime: new Date(Date.UTC(2026, 8, 30, 0, 0, 0)),
      endTime: new Date(Date.UTC(2026, 9, 1, 0, 0, 0)),
    });
  });

  test("a moment is read as the five minutes around it", () => {
    const moment: Date = new Date(Date.UTC(2026, 9, 14, 12, 0, 0));

    const window: AttributeValueLookupWindow | null =
      TelemetryAttributeService.getValueLookupWindow({
        startTime: moment,
        endTime: moment,
      });

    expect(window).toEqual({
      startTime: moment,
      endTime: new Date(moment.getTime() + 5 * MINUTE),
    });
  });

  test("an end before the start is nothing to read, and asks nothing", async () => {
    expect(
      await lookUp({
        startTime: NOW,
        endTime: new Date(NOW.getTime() - HOUR),
      }),
    ).toEqual([]);
    expect(logQuery.mock.calls).toHaveLength(0);

    expect(
      TelemetryAttributeService.getValueLookupWindow({
        startTime: new Date("not a date"),
        endTime: NOW,
      }),
    ).toBeNull();
  });
});

describe("answers are reused, for the same question only", () => {
  test("asking again within five minutes reads nothing", async () => {
    expect(await lookUp()).toEqual(["GET", "POST"]);
    jest.setSystemTime(new Date(NOW.getTime() + 2 * MINUTE));
    expect(await lookUp()).toEqual(["GET", "POST"]);

    expect(logQuery.mock.calls).toHaveLength(1);
  });

  test("an answer is read again once it is five minutes old", async () => {
    const window: Partial<FetchInput> = {
      startTime: new Date(NOW.getTime() - HOUR),
      endTime: new Date(NOW.getTime() - 30 * MINUTE),
    };

    await lookUp(window);
    jest.setSystemTime(new Date(NOW.getTime() + 5 * MINUTE + 1000));
    await lookUp(window);

    expect(logQuery.mock.calls).toHaveLength(2);
  });

  test("a reader who changes the answer they were given does not change the next one", async () => {
    const first: Array<string> = await lookUp();
    first.push("tampered");
    first.sort().reverse();

    expect(await lookUp()).toEqual(["GET", "POST"]);
  });

  test("another project never gets this project's answer", async () => {
    logQuery.mockResolvedValue(dbResult(valueRows(["a-only"])));
    expect(await lookUp({ projectId: projectA })).toEqual(["a-only"]);

    logQuery.mockResolvedValue(dbResult(valueRows(["b-only"])));
    expect(await lookUp({ projectId: projectB })).toEqual(["b-only"]);

    expect(logQuery.mock.calls).toHaveLength(2);
    expect(params(statementOf(logQuery, 1))).toContain(projectB.toString());
  });

  test("a caller limited to some services never gets the whole project's answer, nor another scope's", async () => {
    logQuery.mockResolvedValue(dbResult(valueRows(["every-service"])));
    expect(await lookUp()).toEqual(["every-service"]);

    logQuery.mockResolvedValue(dbResult(valueRows(["service-a"])));
    expect(await lookUp({ serviceFilter: { serviceIds: [serviceA] } })).toEqual(
      ["service-a"],
    );

    logQuery.mockResolvedValue(dbResult(valueRows(["not-service-a"])));
    expect(
      await lookUp({ serviceFilter: { excludedServiceIds: [serviceA] } }),
    ).toEqual(["not-service-a"]);

    expect(logQuery.mock.calls).toHaveLength(3);

    // The same services in another order are the same scope.
    await lookUp({ serviceFilter: { serviceIds: [serviceA] } });
    expect(logQuery.mock.calls).toHaveLength(3);
    expect(
      await lookUp({
        serviceFilter: { serviceIds: [serviceB, serviceA] },
      }),
    ).toEqual(["not-service-a"]);
    expect(logQuery.mock.calls).toHaveLength(4);
    await lookUp({ serviceFilter: { serviceIds: [serviceA, serviceB] } });
    expect(logQuery.mock.calls).toHaveLength(4);
  });

  test("a different key, search text, signal, metric or window is a different question", async () => {
    await lookUp();
    await lookUp({ attributeKey: "http.route" });
    await lookUp({ searchText: "G" });
    await lookUp({ searchText: "g" });
    await lookUp({
      startTime: new Date(NOW.getTime() - HOUR),
      endTime: NOW,
    });

    expect(logQuery.mock.calls).toHaveLength(5);

    const traceQuery: Spy = spyOn(SpanService, "executeQuery");
    traceQuery.mockResolvedValue(dbResult([]));
    await lookUp({ telemetryType: TelemetryType.Trace });
    expect(traceQuery.mock.calls).toHaveLength(1);

    const metricQuery: Spy = spyOn(MetricService, "executeQuery");
    metricQuery.mockResolvedValue(dbResult([]));
    await lookUp({ telemetryType: TelemetryType.Metric, metricName: "a" });
    await lookUp({ telemetryType: TelemetryType.Metric, metricName: "b" });
    expect(metricQuery.mock.calls).toHaveLength(2);
  });

  test("readers on the same relative range in the same five minutes share one read", async () => {
    // "Past 1 hour" at 12:02:30, then at 12:04:59: the same five minutes.
    await lookUp({ startTime: new Date(NOW.getTime() - HOUR), endTime: NOW });

    const later: Date = new Date(Date.UTC(2026, 9, 14, 12, 4, 59));
    jest.setSystemTime(later);
    await lookUp({
      startTime: new Date(later.getTime() - HOUR),
      endTime: later,
    });

    expect(logQuery.mock.calls).toHaveLength(1);

    // At 12:05:01 the window has moved on.
    const next: Date = new Date(Date.UTC(2026, 9, 14, 12, 5, 1));
    jest.setSystemTime(next);
    await lookUp({ startTime: new Date(next.getTime() - HOUR), endTime: next });

    expect(logQuery.mock.calls).toHaveLength(2);
  });

  test("readers asking at the same moment share one read", async () => {
    let release: () => void = (): void => {};
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    logQuery.mockImplementation(async (): Promise<unknown> => {
      await gate;
      return dbResult(valueRows(["GET"]));
    });

    const answers: Promise<Array<Array<string>>> = Promise.all([
      lookUp(),
      lookUp(),
      lookUp(),
    ]);

    release();

    expect(await answers).toEqual([["GET"], ["GET"], ["GET"]]);
    expect(logQuery.mock.calls).toHaveLength(1);
  });

  test("a lookup that ran out of time is not tried again for a minute", async () => {
    logQuery.mockRejectedValueOnce(
      new QueryTimeoutException("This query took longer than 10 seconds."),
    );

    await expect(lookUp()).rejects.toBeInstanceOf(QueryTimeoutException);
    expect(logQuery.mock.calls).toHaveLength(1);

    // Asked again: the same answer, without sending it to the database.
    jest.setSystemTime(new Date(NOW.getTime() + 30 * 1000));
    await expect(lookUp()).rejects.toBeInstanceOf(QueryTimeoutException);
    expect(logQuery.mock.calls).toHaveLength(1);

    // A minute on, it is tried again.
    jest.setSystemTime(new Date(NOW.getTime() + 61 * 1000));
    expect(await lookUp()).toEqual(["GET", "POST"]);
    expect(logQuery.mock.calls).toHaveLength(2);
  });

  test("ClickHouse's own time-limit error counts as running out of time", async () => {
    logQuery.mockRejectedValueOnce(
      Object.assign(new Error("Timeout exceeded"), {
        code: "159",
        type: "TIMEOUT_EXCEEDED",
      }),
    );

    await expect(lookUp()).rejects.toBeTruthy();
    await expect(lookUp()).rejects.toBeInstanceOf(QueryTimeoutException);
    expect(logQuery.mock.calls).toHaveLength(1);
  });

  test("any other failure is not remembered: the next lookup reads again", async () => {
    logQuery.mockRejectedValueOnce(new Error("Connection reset"));

    await expect(lookUp()).rejects.toThrow("Connection reset");
    expect(await lookUp()).toEqual(["GET", "POST"]);
    expect(logQuery.mock.calls).toHaveLength(2);
  });
});

describe("the suggestion time limit", () => {
  test("is 10 seconds, stops with 'throw', and is far below a search's", () => {
    expect(SUGGESTION_READ_TIME_LIMIT).toEqual({
      maxExecutionTimeInSeconds: 10,
      timeoutOverflowMode: "throw",
    });
    expect(SUGGESTION_READ_TIME_LIMIT.maxExecutionTimeInSeconds).toBeLessThan(
      INTERACTIVE_READ_TIME_LIMIT.maxExecutionTimeInSeconds,
    );
  });

  test("the key list runs to a search's limit and throws too", () => {
    const statement: Statement = (
      TelemetryAttributeService as unknown as {
        buildAttributesStatement: (data: JSONObject) => Statement;
      }
    ).buildAttributesStatement({
      projectId: projectA,
      tableName: "LogItemV3",
      attributesColumn: "attributes",
      attributeKeysColumn: "attributeKeys",
      timeColumn: "time",
    } as unknown as JSONObject);

    expect(statement.query).toContain("max_execution_time = 45");
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
    expect(statement.query).not.toContain("'break'");
  });
});
