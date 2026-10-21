import fs from "fs";
import path from "path";
import TraceRecordingRule from "Common/Models/DatabaseModels/TraceRecordingRule";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TraceAggregationType from "Common/Types/Trace/TraceAggregationType";
import TraceRecordingRuleDefinition from "Common/Types/Trace/TraceRecordingRuleDefinition";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * Traces:ComputeRecordingRules - spans in, a derived metric out. One tick of
 * the cron, driven with the services it talks to replaced, pinning what the
 * job promises:
 *
 *   1. every enabled rule aggregates the spans each of its sources matches
 *      over the last full minute (30 seconds of lag included), evaluates its
 *      expression per group and writes the finite results through
 *      MetricService.insertJsonRows as Gauge rows named after the rule's
 *      output metric;
 *   2. once those rows are written, the output metric is registered in the
 *      metric catalogue (MetricType) - the Metric Explorer's and the Metrics
 *      monitor's metric pickers list only registered names - with the rule's
 *      own description, or one naming the rule that writes it;
 *   3. the registration is fire-and-forget: the tick never waits on it, and
 *      its failure is logged without failing the rule or stopping the next;
 *   4. one rule failing never stops the others, and the handler never
 *      throws.
 *
 * The job registers itself through RunCron at import time, so the Cron util
 * is mocked to capture the handler, the way the other App/Tests/Workers/Jobs
 * suites do. The services are replaced with factories, so no Postgres,
 * ClickHouse or Redis is loaded; the expression parser and the row builder
 * are the real code, so what is asserted here is what would reach
 * ClickHouse and the catalogue.
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

jest.mock("Common/Server/Services/TraceRecordingRuleService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: {
      executeQuery: jest.fn(),
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

import TraceRecordingRuleService from "Common/Server/Services/TraceRecordingRuleService";
import MetricService from "Common/Server/Services/MetricService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Traces/ComputeTraceRecordingRules";

const JOB_NAME: string = "Traces:ComputeRecordingRules";

// 10:05:40 - with the 30 second lag, the last full minute is 10:04 - 10:05.
const NOW: Date = new Date("2026-10-07T10:05:40.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const OUTPUT_METRIC_NAME: string = "checkout.span.error.rate";
const OTHER_OUTPUT_METRIC_NAME: string = "search.span.error.rate";

interface RuleServiceMock {
  findBy: jest.Mock;
}

interface LoggerMock {
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

interface SourceRow {
  groupKey: string;
  value: number | string;
}

interface SourceResultSet {
  json: () => Promise<{ data: Array<SourceRow> }>;
}

interface Registration {
  projectId: ObjectID;
  metricNameServiceNameMap: Record<string, MetricType>;
}

const ruleService: RuleServiceMock =
  TraceRecordingRuleService as unknown as RuleServiceMock;
const executeQuery: jest.Mock = (
  MetricService as unknown as { executeQuery: jest.Mock }
).executeQuery;
const insertJsonRows: jest.Mock = (
  MetricService as unknown as { insertJsonRows: jest.Mock }
).insertJsonRows;
const indexMetricTypes: jest.Mock = (
  TelemetryUtil as unknown as { indexMetricNameServiceNameMap: jest.Mock }
).indexMetricNameServiceNameMap;
const mockedLogger: LoggerMock = logger as unknown as LoggerMock;

// Percent of checkout spans that errored, per service.
const errorRate: () => TraceRecordingRuleDefinition =
  (): TraceRecordingRuleDefinition => {
    return {
      sources: [
        {
          alias: "A",
          aggregationType: TraceAggregationType.ErrorCount,
          spanNameRegex: "^POST /checkout",
        },
        {
          alias: "B",
          aggregationType: TraceAggregationType.Count,
          spanNameRegex: "^POST /checkout",
        },
      ],
      expression: "A / B * 100",
      groupByAttribute: "service.name",
    };
  };

function makeRule(
  data: {
    id?: ObjectID;
    projectId?: ObjectID;
    name?: string | null;
    description?: string;
    outputMetricName?: string | null;
  } = {},
): TraceRecordingRule {
  const rule: TraceRecordingRule = new TraceRecordingRule();
  // findBy returns _id as the raw string column.
  rule._id = (data.id || RULE_ID).toString();
  rule.projectId = data.projectId || PROJECT_ID;

  if (data.name !== null) {
    rule.name = data.name || "Checkout error rate";
  }

  if (data.description !== undefined) {
    rule.description = data.description;
  }

  if (data.outputMetricName !== null) {
    rule.outputMetricName = data.outputMetricName || OUTPUT_METRIC_NAME;
  }

  rule.definition = errorRate();

  return rule;
}

function resultSet(rows: Array<SourceRow>): SourceResultSet {
  return {
    json: async (): Promise<{ data: Array<SourceRow> }> => {
      return { data: rows };
    },
  };
}

/*
 * What ClickHouse answers each source query with, in the order the job asks:
 * one query per source, in the rule's source order, rule after rule.
 */
function answerSources(...rowsPerSource: Array<Array<SourceRow>>): void {
  for (const rows of rowsPerSource) {
    executeQuery.mockResolvedValueOnce(resultSet(rows));
  }
}

// 3 errored of 120 checkout spans: 2.5%.
function answerCheckoutErrors(): void {
  answerSources(
    [{ groupKey: "checkout", value: 3 }],
    [{ groupKey: "checkout", value: 120 }],
  );
}

function queries(): Array<string> {
  return executeQuery.mock.calls.map((call: Array<unknown>): string => {
    return call[0] as string;
  });
}

function writtenRows(): Array<JSONObject> {
  return insertJsonRows.mock.calls.flatMap(
    (call: Array<unknown>): Array<JSONObject> => {
      return call[0] as Array<JSONObject>;
    },
  );
}

function registrations(): Array<Registration> {
  return indexMetricTypes.mock.calls.map(
    (call: Array<unknown>): Registration => {
      return call[0] as Registration;
    },
  );
}

// The catalogue entry the only registration of the tick carries.
function registeredMetricType(): MetricType {
  expect(registrations()).toHaveLength(1);
  return registrations()[0]!.metricNameServiceNameMap[OUTPUT_METRIC_NAME]!;
}

// Lets the fire-and-forget registration's rejection handler run.
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
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
  /*
   * resetAllMocks (not clearAllMocks) so a *Once value queued by one test
   * can never leak into the next; every default is re-primed below.
   */
  jest.resetAllMocks();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));

  ruleService.findBy.mockResolvedValue([]);
  executeQuery.mockResolvedValue(resultSet([]));
  insertJsonRows.mockResolvedValue(undefined);
  indexMetricTypes.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the cron registers itself", () => {
  test("under its name, every minute, not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("is imported by the worker Index - an unimported job never registers", () => {
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

    expect(source).toContain(
      'import "./Jobs/Traces/ComputeTraceRecordingRules";',
    );
  });
});

describe("which rules a tick evaluates", () => {
  test("every enabled rule, read as root, with the name and description its catalogue entry is made from", async () => {
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
      },
      props: { isRoot: true },
    });
  });

  test("no enabled rules: nothing is queried, written or registered", async () => {
    await runTick();

    expect(executeQuery).not.toHaveBeenCalled();
    expect(insertJsonRows).not.toHaveBeenCalled();
    expect(indexMetricTypes).not.toHaveBeenCalled();
  });

  test("a rule with no output metric name is skipped: nothing is queried, written or registered", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({ outputMetricName: null }),
    ]);

    await runTick();

    expect(executeQuery).not.toHaveBeenCalled();
    expect(insertJsonRows).not.toHaveBeenCalled();
    expect(indexMetricTypes).not.toHaveBeenCalled();
  });
});

describe("what a rule writes", () => {
  test("each source's spans over the last full minute, then the expression per group, as Gauge rows of the output metric", async () => {
    ruleService.findBy.mockResolvedValue([makeRule()]);
    answerSources(
      [
        { groupKey: "checkout", value: 3 },
        { groupKey: "payments", value: "1" },
      ],
      [
        { groupKey: "checkout", value: 120 },
        { groupKey: "payments", value: "50" },
      ],
    );

    await runTick();

    expect(queries()).toHaveLength(2);
    expect(queries()[0]).toContain("countIf(statusCode = 2) AS value");
    expect(queries()[1]).toContain("count() AS value");
    for (const query of queries()) {
      expect(query).toContain("FROM oneuptime.SpanItemV3");
      expect(query).toContain(`projectId = '${PROJECT_ID.toString()}'`);
      expect(query).toContain(
        "startTime >= toDateTime64('2026-10-07 10:04:00.000000000', 9)",
      );
      expect(query).toContain(
        "startTime < toDateTime64('2026-10-07 10:05:00.000000000', 9)",
      );
      expect(query).toContain("match(name, '^POST /checkout')");
      expect(query).toContain("GROUP BY groupKey");
    }

    expect(insertJsonRows).toHaveBeenCalledTimes(1);
    expect(writtenRows()).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        name: OUTPUT_METRIC_NAME,
        metricPointType: "Gauge",
        time: "2026-10-07 10:04:00",
        value: 2.5,
        attributes: {
          "service.name": "checkout",
          "oneuptime.derived.trace_rule_id": RULE_ID.toString(),
        },
      }),
      expect.objectContaining({
        name: OUTPUT_METRIC_NAME,
        value: 2,
        attributes: {
          "service.name": "payments",
          "oneuptime.derived.trace_rule_id": RULE_ID.toString(),
        },
      }),
    ]);
  });

  test("a group whose expression has no finite value - here a division by zero - is not written", async () => {
    ruleService.findBy.mockResolvedValue([makeRule()]);
    answerSources(
      [
        { groupKey: "checkout", value: 3 },
        { groupKey: "payments", value: 1 },
      ],
      [
        { groupKey: "checkout", value: 120 },
        { groupKey: "payments", value: 0 },
      ],
    );

    await runTick();

    expect(
      writtenRows().map((row: JSONObject) => {
        return (row["attributes"] as JSONObject)["service.name"];
      }),
    ).toEqual(["checkout"]);
  });
});

describe("registering the output metric", () => {
  test("once its rows are written, the output metric is registered under the rule's project, naming the rule that writes it", async () => {
    ruleService.findBy.mockResolvedValue([makeRule()]);
    answerCheckoutErrors();

    await runTick();

    expect(registrations()).toHaveLength(1);
    expect(registrations()[0]!.projectId).toEqual(PROJECT_ID);
    expect(Object.keys(registrations()[0]!.metricNameServiceNameMap)).toEqual([
      OUTPUT_METRIC_NAME,
    ]);

    const metricType: MetricType = registeredMetricType();

    expect(metricType).toBeInstanceOf(MetricType);
    expect(metricType.name).toBe(OUTPUT_METRIC_NAME);
    expect(metricType.description).toBe(
      'Written every minute by the trace recording rule "Checkout error rate".',
    );
    /*
     * An expression over span aggregations has no unit to declare, and an
     * absent unit leaves whatever the catalogue holds untouched.
     */
    expect(metricType.unit).toBeUndefined();
  });

  test("the registration comes after the write: only a metric with rows is listed", async () => {
    ruleService.findBy.mockResolvedValue([makeRule()]);
    answerCheckoutErrors();

    await runTick();

    expect(insertJsonRows.mock.invocationCallOrder[0]).toBeLessThan(
      indexMetricTypes.mock.invocationCallOrder[0]!,
    );
  });

  test("the rule's own description, when it has one, describes the metric", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule({
        description: "  Percent of checkout spans that errored.  ",
      }),
    ]);
    answerCheckoutErrors();

    await runTick();

    expect(registeredMetricType().description).toBe(
      "Percent of checkout spans that errored.",
    );
  });

  test("a blank description is no description", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({ description: "   " })]);
    answerCheckoutErrors();

    await runTick();

    expect(registeredMetricType().description).toBe(
      'Written every minute by the trace recording rule "Checkout error rate".',
    );
  });

  test("a rule without a name is named by its output metric", async () => {
    ruleService.findBy.mockResolvedValue([makeRule({ name: null })]);
    answerCheckoutErrors();

    await runTick();

    expect(registeredMetricType().description).toBe(
      `Written every minute by the trace recording rule "${OUTPUT_METRIC_NAME}".`,
    );
  });

  test("every rule registers its own output metric, under its own project", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule(),
      makeRule({
        id: OTHER_RULE_ID,
        projectId: OTHER_PROJECT_ID,
        name: "Search error rate",
        outputMetricName: OTHER_OUTPUT_METRIC_NAME,
      }),
    ]);
    answerCheckoutErrors();
    answerSources(
      [{ groupKey: "search", value: 1 }],
      [{ groupKey: "search", value: 50 }],
    );

    await runTick();

    expect(
      registrations().map((registration: Registration) => {
        return {
          projectId: registration.projectId.toString(),
          metricNames: Object.keys(registration.metricNameServiceNameMap),
          description: Object.values(registration.metricNameServiceNameMap)[0]!
            .description,
        };
      }),
    ).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        metricNames: [OUTPUT_METRIC_NAME],
        description:
          'Written every minute by the trace recording rule "Checkout error rate".',
      },
      {
        projectId: OTHER_PROJECT_ID.toString(),
        metricNames: [OTHER_OUTPUT_METRIC_NAME],
        description:
          'Written every minute by the trace recording rule "Search error rate".',
      },
    ]);
  });

  test("a minute with no matching spans writes nothing, and registers nothing", async () => {
    ruleService.findBy.mockResolvedValue([makeRule()]);

    await runTick();

    expect(queries()).toHaveLength(2);
    expect(insertJsonRows).not.toHaveBeenCalled();
    expect(indexMetricTypes).not.toHaveBeenCalled();
  });

  test("a minute in which no group has a finite value writes nothing, and registers nothing", async () => {
    ruleService.findBy.mockResolvedValue([makeRule()]);
    answerSources(
      [{ groupKey: "checkout", value: 3 }],
      [{ groupKey: "checkout", value: 0 }],
    );

    await runTick();

    expect(insertJsonRows).not.toHaveBeenCalled();
    expect(indexMetricTypes).not.toHaveBeenCalled();
  });

  test("a failed write registers nothing, and is logged as the rule's failure", async () => {
    ruleService.findBy.mockResolvedValue([makeRule()]);
    answerCheckoutErrors();
    insertJsonRows.mockRejectedValue(new Error("insert refused"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(indexMetricTypes).not.toHaveBeenCalled();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `Trace recording rule ${RULE_ID.toString()} for project ${PROJECT_ID.toString()} failed: insert refused`,
      ),
    );
  });

  test("the tick does not wait for the registration: a hung catalogue write holds up no rule", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule(),
      makeRule({
        id: OTHER_RULE_ID,
        outputMetricName: OTHER_OUTPUT_METRIC_NAME,
      }),
    ]);
    answerCheckoutErrors();
    answerCheckoutErrors();
    indexMetricTypes.mockReturnValue(
      new Promise<void>(() => {
        // Never settles.
      }),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(insertJsonRows).toHaveBeenCalledTimes(2);
    expect(indexMetricTypes).toHaveBeenCalledTimes(2);
  }, 10000);

  test("a failed registration is logged on its own - the rule did not fail - and the next rule still runs", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule(),
      makeRule({
        id: OTHER_RULE_ID,
        outputMetricName: OTHER_OUTPUT_METRIC_NAME,
      }),
    ]);
    answerCheckoutErrors();
    answerCheckoutErrors();
    indexMetricTypes
      .mockRejectedValueOnce(new Error("catalogue unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(runTick()).resolves.toBeUndefined();
    await flushPromises();

    expect(insertJsonRows).toHaveBeenCalledTimes(2);
    expect(
      registrations().map((registration: Registration) => {
        return Object.keys(registration.metricNameServiceNameMap);
      }),
    ).toEqual([[OUTPUT_METRIC_NAME], [OTHER_OUTPUT_METRIC_NAME]]);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "catalogue unavailable" }),
    );
  });
});

describe("when something fails", () => {
  test("one rule failing does not stop the next, which still writes and registers", async () => {
    ruleService.findBy.mockResolvedValue([
      makeRule(),
      makeRule({
        id: OTHER_RULE_ID,
        outputMetricName: OTHER_OUTPUT_METRIC_NAME,
      }),
    ]);
    executeQuery.mockRejectedValueOnce(new Error("ClickHouse timed out"));
    answerCheckoutErrors();

    await expect(runTick()).resolves.toBeUndefined();

    expect(writtenRows()).toEqual([
      expect.objectContaining({
        name: OTHER_OUTPUT_METRIC_NAME,
        attributes: expect.objectContaining({
          "oneuptime.derived.trace_rule_id": OTHER_RULE_ID.toString(),
        }),
      }),
    ]);
    expect(
      registrations().map((registration: Registration) => {
        return Object.keys(registration.metricNameServiceNameMap);
      }),
    ).toEqual([[OTHER_OUTPUT_METRIC_NAME]]);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `Trace recording rule ${RULE_ID.toString()} for project ${PROJECT_ID.toString()} failed: ClickHouse timed out`,
      ),
    );
  });

  test("a failure to read the rules is logged, and the handler still resolves", async () => {
    ruleService.findBy.mockRejectedValue(new Error("Postgres unavailable"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(executeQuery).not.toHaveBeenCalled();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Traces:ComputeRecordingRules cron failed: Postgres unavailable",
      ),
    );
  });
});
