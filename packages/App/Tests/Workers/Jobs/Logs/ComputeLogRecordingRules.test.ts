import fs from "fs";
import path from "path";
import LogRecordingRule from "Common/Models/DatabaseModels/LogRecordingRule";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_ID_ATTRIBUTE,
  LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE,
} from "Common/Types/Log/LogRecordingRuleDefinition";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES,
  LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN,
} from "Common/Utils/Telemetry/LogRecordingRuleWindow";

/*
 * Logs:ComputeRecordingRules - logs in, metrics out. One tick of the cron,
 * driven with the services it talks to replaced, pinning what the job
 * promises:
 *
 *   1. every enabled rule's aggregation runs over the minutes that have
 *      elapsed since the rule last wrote (its watermark, computedUntil):
 *      the newest minute on a first run, the missed ones after downtime -
 *      at most MAX_CATCH_UP minutes back and MAX_MINUTES_PER_RUN a run;
 *   2. the window is claimed with a compare-and-set on the watermark
 *      BEFORE anything is queried, so two overlapping runs never write a
 *      minute twice, and handed back when the query or the write fails, so
 *      the next run retries it rather than leaving a gap;
 *   3. the points are written through MetricService.insertJsonRows - the
 *      path the metric and trace recording rule jobs write theirs through -
 *      as Gauge rows carrying the group-by values, and the output metric is
 *      registered so the metric pickers list it;
 *   4. one rule failing never stops the others, and the handler never
 *      throws.
 *
 * The job registers itself through RunCron at import time, so the Cron util
 * is mocked to capture the handler, the way the other App/Tests/Workers/Jobs
 * suites do. The ClickHouse statement and the rows are built by the real
 * Common code (LogRecordingRuleQuery, LogRecordingRuleMetric), so what is
 * asserted here is what would reach ClickHouse.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCapturedOptions: Record<string, CronOptions> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/LogRecordingRuleService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/LogService", () => {
  return {
    __esModule: true,
    default: {
      executeQuery: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      indexMetricNameServiceNameMap: jest.fn(),
    },
  };
});

import LogRecordingRuleService from "Common/Server/Services/LogRecordingRuleService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Logs/ComputeLogRecordingRules";

const JOB_NAME: string = "Logs:ComputeRecordingRules";

// 10:05:40 - the newest minute that has fully elapsed (lag included) is 10:04.
const NOW: Date = new Date("2026-10-07T10:05:40.000Z");
const NEWEST_START: Date = new Date("2026-10-07T10:04:00.000Z");
const NEWEST_END: Date = new Date("2026-10-07T10:05:00.000Z");

const MINUTE: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

interface RuleServiceMock {
  findBy: jest.Mock;
  compareAndSetColumnsByIdWithoutHooks: jest.Mock;
}

interface LoggerMock {
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

interface CompareAndSetArgs {
  id: ObjectID;
  data: { computedUntil: Date | null };
  expectedData: { computedUntil: Date | null };
  skipUpdateDateColumn: boolean;
}

const ruleService: RuleServiceMock =
  LogRecordingRuleService as unknown as RuleServiceMock;
const executeQuery: jest.Mock = (
  LogService as unknown as { executeQuery: jest.Mock }
).executeQuery;
const insertJsonRows: jest.Mock = (
  MetricService as unknown as { insertJsonRows: jest.Mock }
).insertJsonRows;
const indexMetricTypes: jest.Mock = (
  TelemetryUtil as unknown as { indexMetricNameServiceNameMap: jest.Mock }
).indexMetricNameServiceNameMap;
const mockedLogger: LoggerMock = logger as unknown as LoggerMock;

const sdwanLatency: () => LogRecordingRuleDefinition =
  (): LogRecordingRuleDefinition => {
    return {
      filter: {
        attributeFilters: [{ key: "log_component", value: "SLA" }],
      },
      aggregationType: AggregationType.Avg,
      valueAttribute: "latency",
      groupByAttributes: ["gw_name", "profile_name"],
      unit: "ms",
    };
  };

function makeRule(data: {
  id?: ObjectID;
  definition?: unknown;
  computedUntil?: Date | null;
  outputMetricName?: string | null;
}): LogRecordingRule {
  const rule: LogRecordingRule = new LogRecordingRule();
  rule._id = (data.id || RULE_ID).toString();
  rule.projectId = PROJECT_ID;
  rule.name = "SD-WAN gateway latency";
  rule.outputMetricName =
    data.outputMetricName === null
      ? (undefined as unknown as string)
      : data.outputMetricName || "sdwan.gateway.latency.ms";
  rule.definition = (
    data.definition === undefined ? sdwanLatency() : data.definition
  ) as LogRecordingRuleDefinition;

  if (data.computedUntil) {
    rule.computedUntil = data.computedUntil;
  }

  return rule;
}

// What ClickHouse answers the statement with.
function answerRows(rows: Array<JSONObject>): void {
  executeQuery.mockResolvedValue({
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return { data: rows };
    },
  });
}

function bucket(date: Date): number {
  return date.getTime() / 1000;
}

function compareAndSetCalls(): Array<CompareAndSetArgs> {
  return ruleService.compareAndSetColumnsByIdWithoutHooks.mock.calls.map(
    (call: Array<unknown>): CompareAndSetArgs => {
      return call[0] as CompareAndSetArgs;
    },
  );
}

function statements(): Array<Statement> {
  return executeQuery.mock.calls.map((call: Array<unknown>): Statement => {
    return call[0] as Statement;
  });
}

function writtenRows(): Array<JSONObject> {
  return insertJsonRows.mock.calls.flatMap(
    (call: Array<unknown>): Array<JSONObject> => {
      return call[0] as Array<JSONObject>;
    },
  );
}

// A DateTime64(9) parameter as the statement binds it.
const DATE_TIME_64: RegExp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{9}$/;

// The window a statement reads: the two DateTime64 parameters it binds.
function windowOf(statement: Statement): Array<string> {
  return Object.values(statement.query_params).filter(
    (value: unknown): boolean => {
      return typeof value === "string" && DATE_TIME_64.test(value);
    },
  ) as Array<string>;
}

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  if (!handler) {
    throw new Error(
      `Cron handler ${JOB_NAME} was not registered - the RunCron mock never saw it.`,
    );
  }

  await handler();
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));

  ruleService.findBy.mockResolvedValue([]);
  ruleService.compareAndSetColumnsByIdWithoutHooks.mockResolvedValue(true);
  answerRows([]);
  insertJsonRows.mockResolvedValue(undefined);
  indexMetricTypes.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the cron registers itself", () => {
  test("under its name, every minute like the other recording rule jobs, not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("is imported by the worker Index, after the trace recording rules it mirrors", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "FeatureSet",
        "Workers",
        "Index.ts",
      ),
      "utf8",
    );

    const traceJob: number = source.indexOf(
      'import "./Jobs/Traces/ComputeTraceRecordingRules";',
    );
    const logJob: number = source.indexOf(
      'import "./Jobs/Logs/ComputeLogRecordingRules";',
    );

    expect(traceJob).toBeGreaterThanOrEqual(0);
    expect(logJob).toBeGreaterThan(traceJob);
  });
});

describe("which rules a tick evaluates", () => {
  test("every enabled rule, read as root, with the columns the job needs", async () => {
    await runTick();

    expect(ruleService.findBy).toHaveBeenCalledTimes(1);
    expect(ruleService.findBy).toHaveBeenCalledWith({
      query: { isEnabled: true },
      skip: 0,
      limit: LIMIT_MAX,
      select: {
        _id: true,
        projectId: true,
        name: true,
        description: true,
        outputMetricName: true,
        definition: true,
        computedUntil: true,
      },
      props: { isRoot: true },
    });
  });

  test("no enabled rules: nothing is claimed, queried or written", async () => {
    await runTick();

    expect(
      ruleService.compareAndSetColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(executeQuery).not.toHaveBeenCalled();
    expect(insertJsonRows).not.toHaveBeenCalled();
  });

  test("a rule with no output metric name is skipped untouched", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({ outputMetricName: null }),
    ]);

    await runTick();

    expect(
      ruleService.compareAndSetColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("a rule whose stored definition is invalid is skipped, unclaimed, with the reason logged", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({
        definition: { filter: {}, aggregationType: AggregationType.P95 },
      }),
    ]);

    await runTick();

    expect(
      ruleService.compareAndSetColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(executeQuery).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Choose the numeric attribute to aggregate (e.g. latency).",
      ),
    );
  });

  test("a definition stored as a JSON string is evaluated like any other", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({ definition: JSON.stringify(sdwanLatency()) }),
    ]);

    await runTick();

    expect(executeQuery).toHaveBeenCalledTimes(1);
  });
});

describe("the window a rule computes", () => {
  test("a first run claims and computes the newest elapsed minute", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);

    await runTick();

    expect(compareAndSetCalls()).toEqual([
      {
        id: RULE_ID,
        data: { computedUntil: NEWEST_END },
        expectedData: { computedUntil: null },
        skipUpdateDateColumn: true,
      },
    ]);
    expect(windowOf(statements()[0]!)).toEqual([
      "2026-10-07 10:04:00.000000000",
      "2026-10-07 10:05:00.000000000",
    ]);
  });

  test("the claim comes before the query: a minute is computed only by the run that holds it", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);

    await runTick();

    expect(
      ruleService.compareAndSetColumnsByIdWithoutHooks.mock
        .invocationCallOrder[0],
    ).toBeLessThan(executeQuery.mock.invocationCallOrder[0]!);
  });

  test("in the steady state a run claims the one minute after the watermark", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({ computedUntil: NEWEST_START }),
    ]);

    await runTick();

    expect(compareAndSetCalls()[0]).toEqual({
      id: RULE_ID,
      data: { computedUntil: NEWEST_END },
      expectedData: { computedUntil: NEWEST_START },
      skipUpdateDateColumn: true,
    });
    expect(windowOf(statements()[0]!)).toEqual([
      "2026-10-07 10:04:00.000000000",
      "2026-10-07 10:05:00.000000000",
    ]);
  });

  test("a run that finds its minute already written does nothing at all", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({ computedUntil: NEWEST_END }),
    ]);

    await runTick();

    expect(
      ruleService.compareAndSetColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(executeQuery).not.toHaveBeenCalled();
    expect(insertJsonRows).not.toHaveBeenCalled();
  });

  test("after downtime it catches up on the missed minutes, a bounded number per run", async () => {
    const watermark: Date = new Date(NEWEST_END.getTime() - 25 * MINUTE);
    ruleService.findBy.mockResolvedValue([
      makeRule({ computedUntil: watermark }),
    ]);

    await runTick();

    const claimedEnd: Date = new Date(
      watermark.getTime() + LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN * MINUTE,
    );

    expect(compareAndSetCalls()[0]).toEqual({
      id: RULE_ID,
      data: { computedUntil: claimedEnd },
      expectedData: { computedUntil: watermark },
      skipUpdateDateColumn: true,
    });
    expect(windowOf(statements()[0]!)).toEqual([
      OneUptimeDate.toClickhouseDateTime64(watermark),
      OneUptimeDate.toClickhouseDateTime64(claimedEnd),
    ]);
    // One row per minute per series, for every minute of the window.
    expect(statements()[0]!.query).toContain(
      `LIMIT ${LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE * LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN}`,
    );
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  test("minutes older than the catch-up bound are given up, and the loss is logged", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({
        computedUntil: new Date(NEWEST_END.getTime() - 180 * MINUTE),
      }),
    ]);

    await runTick();

    const earliest: Date = new Date(
      NEWEST_END.getTime() -
        LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES * MINUTE,
    );

    expect(windowOf(statements()[0]!)[0]).toBe(
      OneUptimeDate.toClickhouseDateTime64(earliest),
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `${180 - LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES} minute(s) before ${earliest.toISOString()} were not computed`,
      ),
    );
  });

  test("a window another run claimed first is left to it", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);
    ruleService.compareAndSetColumnsByIdWithoutHooks.mockResolvedValue(false);

    await runTick();

    expect(executeQuery).not.toHaveBeenCalled();
    expect(insertJsonRows).not.toHaveBeenCalled();
  });
});

describe("what a rule writes", () => {
  test("its points, as Gauge metric rows carrying the group-by values, through MetricService", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);
    answerRows([
      {
        bucket: bucket(NEWEST_START),
        g0: "WAN1",
        g1: "Branch-Internet",
        matchedLogs: "1",
        value: 11,
      },
      {
        bucket: bucket(NEWEST_START),
        g0: "WAN2",
        g1: "Branch-Internet",
        matchedLogs: "1",
        value: 240,
      },
    ]);

    await runTick();

    expect(insertJsonRows).toHaveBeenCalledTimes(1);
    expect(writtenRows()).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        name: "sdwan.gateway.latency.ms",
        metricPointType: "Gauge",
        time: "2026-10-07 10:04:00",
        value: 11,
        attributes: {
          gw_name: "WAN1",
          profile_name: "Branch-Internet",
          [LOG_RECORDING_RULE_ID_ATTRIBUTE]: RULE_ID.toString(),
        },
      }),
      expect.objectContaining({
        value: 240,
        attributes: {
          gw_name: "WAN2",
          profile_name: "Branch-Internet",
          [LOG_RECORDING_RULE_ID_ATTRIBUTE]: RULE_ID.toString(),
        },
      }),
    ]);

    // The watermark is not moved again after the write: the claim was the move.
    expect(
      ruleService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(1);
  });

  test("the statement is the rule's own: its filter, aggregation and group by, every value bound", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);

    await runTick();

    const statement: Statement = statements()[0]!;

    expect(statement.query).toContain("avg(toFloat64OrNull(attributes[");
    expect(statement.query).toContain(" AS g0");
    expect(statement.query).toContain(" AS g1");
    expect(statement.query).toContain("arrayExists((k, v) -> lowerUTF8(k)");
    expect(statement.query).not.toContain("log_component");
    expect(Object.values(statement.query_params)).toEqual(
      expect.arrayContaining([
        PROJECT_ID.toString(),
        "gw_name",
        "profile_name",
        "latency",
        "log_component",
        "SLA",
      ]),
    );
  });

  test("a caught-up window writes each minute's point at its own minute", async () => {
    const watermark: Date = new Date(NEWEST_END.getTime() - 3 * MINUTE);
    ruleService.findBy.mockResolvedValue([
      makeRule({ computedUntil: watermark }),
    ]);
    answerRows(
      [0, 1, 2].map((offset: number): JSONObject => {
        return {
          bucket: bucket(new Date(watermark.getTime() + offset * MINUTE)),
          g0: "WAN1",
          g1: "p",
          matchedLogs: "1",
          value: 10 + offset,
        };
      }),
    );

    await runTick();

    expect(
      writtenRows().map((row: JSONObject) => {
        return [row["time"], row["value"]];
      }),
    ).toEqual([
      ["2026-10-07 10:02:00", 10],
      ["2026-10-07 10:03:00", 11],
      ["2026-10-07 10:04:00", 12],
    ]);
  });

  test("registers the output metric, with its unit, so the metric pickers list it", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);
    answerRows([
      {
        bucket: bucket(NEWEST_START),
        g0: "WAN1",
        g1: "p",
        matchedLogs: "1",
        value: 11,
      },
    ]);

    await runTick();

    expect(indexMetricTypes).toHaveBeenCalledTimes(1);

    const args: {
      projectId: ObjectID;
      metricNameServiceNameMap: Record<string, MetricType>;
    } = indexMetricTypes.mock.calls[0]![0];

    expect(args.projectId).toEqual(PROJECT_ID);
    expect(Object.keys(args.metricNameServiceNameMap)).toEqual([
      "sdwan.gateway.latency.ms",
    ]);
    expect(
      args.metricNameServiceNameMap["sdwan.gateway.latency.ms"]!.unit,
    ).toBe("ms");
  });

  test("a failed registration is logged and changes nothing about the written window", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);
    answerRows([
      {
        bucket: bucket(NEWEST_START),
        g0: "WAN1",
        g1: "p",
        matchedLogs: "1",
        value: 11,
      },
    ]);
    indexMetricTypes.mockRejectedValue(new Error("catalogue unavailable"));

    await runTick();
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    expect(insertJsonRows).toHaveBeenCalledTimes(1);
    expect(
      ruleService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "catalogue unavailable" }),
    );
  });

  test("an aggregation with nothing to aggregate writes nothing, and keeps its window", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);
    answerRows([]);

    await runTick();

    expect(insertJsonRows).not.toHaveBeenCalled();
    expect(indexMetricTypes).not.toHaveBeenCalled();
    // Claimed once and never handed back: the minute had nothing in it.
    expect(compareAndSetCalls()).toHaveLength(1);
  });

  test("a count with no group by writes 0 for a minute with no matching logs", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({
        definition: { filter: {}, aggregationType: AggregationType.Count },
      }),
    ]);
    answerRows([]);

    await runTick();

    expect(writtenRows()).toEqual([
      expect.objectContaining({
        time: "2026-10-07 10:04:00",
        value: 0,
        attributes: { [LOG_RECORDING_RULE_ID_ATTRIBUTE]: RULE_ID.toString() },
      }),
    ]);
  });

  test("a minute that reached the series cap is written, and the cap logged", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({
        definition: {
          filter: {},
          aggregationType: AggregationType.Count,
          groupByAttributes: ["src_ip"],
        },
      }),
    ]);
    answerRows(
      Array.from(
        { length: LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE },
        (_value: unknown, index: number): JSONObject => {
          return {
            bucket: bucket(NEWEST_START),
            g0: `10.0.0.${index}`,
            matchedLogs: "1",
            value: "1",
          };
        },
      ),
    );

    await runTick();

    expect(writtenRows()).toHaveLength(
      LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE,
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("reached the series cap"),
    );
  });
});

describe("when something fails", () => {
  test("a failed query hands the window back for the next run, and is logged", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({ computedUntil: NEWEST_START }),
    ]);
    executeQuery.mockRejectedValue(new Error("ClickHouse timed out"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(compareAndSetCalls()).toEqual([
      {
        id: RULE_ID,
        data: { computedUntil: NEWEST_END },
        expectedData: { computedUntil: NEWEST_START },
        skipUpdateDateColumn: true,
      },
      {
        id: RULE_ID,
        data: { computedUntil: NEWEST_START },
        expectedData: { computedUntil: NEWEST_END },
        skipUpdateDateColumn: true,
      },
    ]);
    expect(insertJsonRows).not.toHaveBeenCalled();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("ClickHouse timed out"),
    );
  });

  test("a failed write hands the window back too - a first run's back to never run", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);
    answerRows([
      {
        bucket: bucket(NEWEST_START),
        g0: "WAN1",
        g1: "p",
        matchedLogs: "1",
        value: 11,
      },
    ]);
    insertJsonRows.mockRejectedValue(new Error("insert refused"));

    await runTick();

    expect(compareAndSetCalls()[1]).toEqual({
      id: RULE_ID,
      data: { computedUntil: null },
      expectedData: { computedUntil: NEWEST_END },
      skipUpdateDateColumn: true,
    });
    expect(indexMetricTypes).not.toHaveBeenCalled();
  });

  test("a window that cannot be handed back is logged as lost", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({})]);
    executeQuery.mockRejectedValue(new Error("ClickHouse down"));
    ruleService.compareAndSetColumnsByIdWithoutHooks
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("Postgres down"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not hand back the window"),
    );
  });

  test("one rule failing does not stop the next", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({ id: RULE_ID }),
      makeRule({ id: OTHER_RULE_ID }),
    ]);
    executeQuery
      .mockRejectedValueOnce(new Error("first rule broke"))
      .mockResolvedValueOnce({
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return {
            data: [
              {
                bucket: bucket(NEWEST_START),
                g0: "WAN1",
                g1: "p",
                matchedLogs: "1",
                value: 11,
              },
            ],
          };
        },
      });

    await runTick();

    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(writtenRows()).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          [LOG_RECORDING_RULE_ID_ATTRIBUTE]: OTHER_RULE_ID.toString(),
        }),
      }),
    ]);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(`Log recording rule ${RULE_ID.toString()}`),
    );
  });

  test("a failure to read the rules is logged, and the handler still resolves", async () => {
    ruleService.findBy.mockRejectedValue(new Error("Postgres unavailable"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Postgres unavailable"),
    );
  });
});
