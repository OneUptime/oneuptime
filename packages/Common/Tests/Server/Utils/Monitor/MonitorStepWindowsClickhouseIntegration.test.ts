/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon, which the prebuilt binary cannot always dlopen
 * in the test environment. No check here runs an expression.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import logger from "../../../../Server/Utils/Logger";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../../Server/EnvironmentConfig";
import { getClickhouseDatabaseName } from "../../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { BasicDiskMetrics } from "../../../../Types/Infrastructure/BasicMetrics";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  FilterType,
  PreviousCheckChangeType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationFilterResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MONITOR_STEP_ID_ATTRIBUTE } from "../../../../Types/Monitor/MonitorStepSeries";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EACH STEP OF A MONITOR JUDGED ON ITS OWN CHECKS, IN A REAL CLICKHOUSE
 * (#10906).
 *
 * A monitor whose two steps check a fast page and a slow one, played minute
 * by minute the way MonitorResource handles each probe result: the check's
 * rows are written through the real MonitorMetricUtil, naming the step it is
 * judged as, and the step is judged through the real
 * MonitorCriteriaEvaluator, whose every window - a count, a share, status
 * changes, an average, a percentile, All Values, Any Value and the previous
 * check - is read by the product's own statements from a real ClickHouse.
 *
 * Each step's criteria would cross the other step's checks: the fast page's
 * "offline more than twice" would count the slow page's failures, its
 * average would be dragged over 500 ms, and the slow page would come back
 * online on every round. None of them may match; the criteria each step's
 * own checks meet do.
 *
 * Then the rows written before rows named their step: read by a monitor
 * with one step, left out by a monitor with several, whose windows fill
 * again. A server's disks, each disk a series of its own, judged on the
 * step's rows. And an SSL monitor's two certificates (#10905), each one's
 * days left compared with its own previous check: replaced by one that
 * expires sooner, then renewed.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -d --name <a name of your own> -p 127.0.0.1:8195:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7.38.18
 * then TEST_CLICKHOUSE_URL=http://localhost:8195 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(600000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `step_windows_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const EVERY_MINUTE: string = "* * * * *";

/*
 * Every check of the suite happens on a clock of its own, hours back from
 * now and on the minute, so rows stay inside their retention and every
 * window lands on whole minutes.
 */
const BASE: number =
  Math.floor((Date.now() - 3 * 60 * MINUTE) / MINUTE) * MINUTE;

const PROBE_A: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000109a1");

let client: ClickHouseClient;
let queryCount: number = 0;
// The database the product's statements name, swapped for this suite's own.
const defaultDatabase: string = getClickhouseDatabaseName();

function at(minute: number, second: number = 0): void {
  jest.setSystemTime(new Date(BASE + minute * MINUTE + second * 1000));
}

function overTime(
  filter: CriteriaFilter,
  options: EvaluateOverTimeOptions,
): CriteriaFilter {
  return {
    ...filter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: options,
  };
}

function criteria(
  name: string,
  filters: Array<CriteriaFilter>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: name,
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: filters,
    incidents: [],
    alerts: [],
    name: name,
    description: "",
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
  };
  return instance;
}

function stepWith(instances: Array<MonitorCriteriaInstance>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: instances };
  step.data!.monitorCriteria = monitorCriteria;
  return step;
}

function monitorWith(
  monitorType: MonitorType,
  steps: Array<MonitorStep>,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = monitorType;
  monitor.monitoringInterval = EVERY_MINUTE;
  monitor.name = "Shop";

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

interface Check {
  criteriaMet: string | null;
  perSeriesMatches: Array<PerSeriesCriteriaMatch>;
  results: Array<MonitorEvaluationCriteriaResult>;
}

/*
 * One check, as MonitorResource handles it: the time its rows begin to be
 * written taken, its rows written naming the step it is judged as - or, for
 * a check made before rows named their step, naming none - then judged.
 */
async function check(input: {
  monitor: Monitor;
  monitorStep: MonitorStep;
  dataToProcess: DataToProcess;
  writtenBeforeRowsNamedTheirStep?: boolean;
  judge?: boolean;
}): Promise<Check> {
  const checkWrittenAt: Date = OneUptimeDate.getCurrentDate();

  await MonitorMetricUtil.saveMonitorMetrics({
    monitorId: input.monitor.id!,
    projectId: input.monitor.projectId!,
    dataToProcess: input.dataToProcess,
    probeName: undefined,
    monitorName: input.monitor.name,
    monitorStepId: input.writtenBeforeRowsNamedTheirStep
      ? undefined
      : input.monitorStep.id,
  });

  if (input.judge === false) {
    return { criteriaMet: null, perSeriesMatches: [], results: [] };
  }

  const summary: MonitorEvaluationSummary = {
    evaluatedAt: OneUptimeDate.getCurrentDate(),
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: input.dataToProcess,
      monitorStep: input.monitorStep,
      monitor: input.monitor,
      probeApiIngestResponse: {
        monitorId: input.monitor.id!,
        criteriaMetId: undefined,
        rootCause: null,
      },
      evaluationSummary: summary,
      recordMatchHistory: true,
      checkWrittenAt: checkWrittenAt,
    });

  return {
    criteriaMet: response.criteriaMetId || null,
    perSeriesMatches: response.perSeriesMatches || [],
    results: summary.criteriaResults,
  };
}

function websiteCheck(input: {
  monitor: Monitor;
  monitorStep: MonitorStep;
  responseTimeInMs: number;
  isOnline: boolean;
  responseCode: number;
}): ProbeMonitorResponse {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    monitorStepId: input.monitorStep.id,
    probeId: PROBE_A,
    failureCause: input.isOnline ? "" : "Service Unavailable",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    isOnline: input.isOnline,
    responseCode: input.responseCode,
    responseTimeInMs: input.responseTimeInMs,
    responseBody: "<html><title>Shop</title></html>",
    responseHeaders: {},
  };
}

function serverCheck(input: {
  monitor: Monitor;
  disks: Array<{ diskPath: string; percentUsed: number }>;
}): ServerMonitorResponse {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    hostname: "db-01",
    requestReceivedAt: OneUptimeDate.getCurrentDate(),
    basicInfrastructureMetrics: {
      cpuMetrics: { percentUsed: 5, cores: 4 },
      memoryMetrics: {
        total: 100,
        free: 90,
        used: 10,
        percentFree: 90,
        percentUsed: 10,
      },
      diskMetrics: input.disks.map(
        (disk: { diskPath: string; percentUsed: number }): BasicDiskMetrics => {
          return {
            total: 100,
            free: 100 - disk.percentUsed,
            used: disk.percentUsed,
            diskPath: disk.diskPath,
            percentUsed: disk.percentUsed,
            percentFree: 100 - disk.percentUsed,
          };
        },
      ),
    },
  } as unknown as ServerMonitorResponse;
}

function result(
  checked: Check,
  criteriaName: string,
): MonitorEvaluationCriteriaResult {
  const found: MonitorEvaluationCriteriaResult | undefined =
    checked.results.find((row: MonitorEvaluationCriteriaResult): boolean => {
      return row.criteriaName === criteriaName;
    });

  if (!found) {
    throw new Error(`${criteriaName} was not judged.`);
  }

  return found;
}

function message(checked: Check, criteriaName: string): string {
  return result(checked, criteriaName)
    .filters.map((filter: MonitorEvaluationFilterResult): string => {
      return filter.message;
    })
    .join(" ");
}

async function run(statement: Statement | string): Promise<Array<JSONObject>> {
  queryCount++;

  const isStatement: boolean = statement instanceof Statement;
  const query: string = (
    isStatement ? (statement as Statement).query : (statement as string)
  )
    .split(`${defaultDatabase}.`)
    .join(`${database}.`);

  const queryParams: Record<string, unknown> = isStatement
    ? Object.fromEntries(
        Object.entries((statement as Statement).query_params).map(
          ([key, value]: [string, unknown]): [string, unknown] => {
            return [key, value === defaultDatabase ? database : value];
          },
        ),
      )
    : {};

  const resultSet: { json: () => Promise<unknown> } = await client.query({
    query: query,
    query_params: queryParams,
    format: "JSON",
  });

  return ((await resultSet.json()) as { data: Array<JSONObject> }).data;
}

async function rowsOf(monitor: Monitor): Promise<Array<JSONObject>> {
  return (
    (await (
      await client.query({
        query: `SELECT name, attributes, value FROM ${database}.MetricItemV3 WHERE primaryEntityId = {monitorId:String} ORDER BY time, name`,
        query_params: { monitorId: monitor.id!.toString() },
        format: "JSON",
      })
    ).json()) as { data: Array<JSONObject> }
  ).data;
}

integration(
  "each step of a monitor judged on its own checks, in a real ClickHouse",
  () => {
    beforeAll(async (): Promise<void> => {
      // The clock alone is faked: the ClickHouse client keeps Node's timers.
      jest.useFakeTimers({
        doNotFake: [
          "nextTick",
          "setImmediate",
          "clearImmediate",
          "setInterval",
          "clearInterval",
          "setTimeout",
          "clearTimeout",
          "queueMicrotask",
          "hrtime",
          "performance",
        ],
      });
      jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
      jest
        .spyOn(globalThis, "clearTimeout")
        .mockImplementation(nodeClearTimeout);

      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "This integration suite requires a local ClickHouse server.",
        );
      }

      client = createClient({
        url: endpoint!,
        username: ClickhouseUsername,
        password: ClickhousePassword,
        request_timeout: 300000,
      });

      /*
       * The table reads go through, as the model keeps it: the product writes
       * its DDL ON CLUSTER, which needs a Keeper this container does not run.
       */
      for (const query of [
        `CREATE DATABASE ${database}`,
        `CREATE TABLE ${database}.MetricItemV3 (projectId String, primaryEntityId String, primaryEntityType Nullable(String), name String, metricPointType Nullable(String), time DateTime64(9), timeUnixNano UInt64, attributes Map(String, String), attributeKeys Array(String), value Nullable(Double), retentionDate DateTime, _id String, createdAt DateTime) ENGINE = MergeTree PARTITION BY toYYYYMMDD(time) PRIMARY KEY (projectId, name, primaryEntityId, time) ORDER BY (projectId, name, primaryEntityId, time)`,
      ]) {
        await client.command({ query: query });
      }

      jest
        .spyOn(GlobalConfigService, "findOneBy")
        .mockResolvedValue(null as never);

      jest
        .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
        .mockResolvedValue(undefined as never);

      // Every row a check writes lands in the real table, readable at once.
      jest
        .spyOn(MetricService, "insertJsonRows")
        .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
          await client.insert({
            table: `${database}.MetricItemV3`,
            values: rows,
            format: "JSONEachRow",
            clickhouse_settings: { input_format_skip_unknown_fields: 1 },
          });
        });

      // And every read - counted, previous check, a window's rows - reads it.
      jest.spyOn(MetricService, "executeQuery").mockImplementation((async (
        statement: Statement | string,
      ): Promise<unknown> => {
        const data: Array<JSONObject> = await run(statement);

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({ data });
          },
        };
      }) as never);

      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      });
    });

    afterAll(async (): Promise<void> => {
      // Closed while the client still has Node's timers to close with.
      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
        await client.close();
      }

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    describe("a fast page and a slow page, each step's criteria would cross the other's checks", () => {
      /*
       * Each step's criteria, in order: every one but the last would match on
       * both steps' checks read together, and must not match on the step's
       * own; the last matches on the step's own checks alone (and would not on
       * both read together), so every criteria before it was judged.
       */
      const FAST_CRITERIA: Array<MonitorCriteriaInstance> = [
        criteria("fast: average above 500 ms", [
          overTime(
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.GreaterThan,
              value: 500,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Average,
            },
          ),
        ]),
        criteria("fast: 90th percentile above 500 ms", [
          overTime(
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.GreaterThan,
              value: 500,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Percentile,
              percentile: 90,
            },
          ),
        ]),
        criteria("fast: offline on any check", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.False,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
            },
          ),
        ]),
        criteria("fast: offline more than twice", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.False,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Count,
              countFilterType: FilterType.GreaterThan,
              countValue: 2,
            },
          ),
        ]),
        criteria("fast: offline on more than 20% of checks", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.False,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Percentage,
              countFilterType: FilterType.GreaterThan,
              countValue: 20,
            },
          ),
        ]),
        criteria("fast: flapping", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.False,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
              countFilterType: FilterType.GreaterThan,
              countValue: 2,
            },
          ),
        ]),
        criteria("fast: more than 50% faster than the previous check", [
          overTime(
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.LessThan,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
              changeType: PreviousCheckChangeType.Percentage,
              changeValue: 50,
            },
          ),
        ]),
        criteria("fast: came back online", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.True,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
            },
          ),
        ]),
        criteria("fast: status code changed", [
          overTime(
            {
              checkOn: CheckOn.ResponseStatusCode,
              filterType: FilterType.NotEqualTo,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
            },
          ),
        ]),
        // The step's own checks: online on every one of them.
        criteria("fast: online on every check", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.True,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            },
          ),
        ]),
      ];

      const SLOW_CRITERIA: Array<MonitorCriteriaInstance> = [
        criteria("slow: average below 600 ms", [
          overTime(
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.LessThan,
              value: 600,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Average,
            },
          ),
        ]),
        criteria("slow: fastest check below 500 ms", [
          overTime(
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.LessThan,
              value: 500,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.MunimumValue,
            },
          ),
        ]),
        criteria("slow: online on any check", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.True,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
            },
          ),
        ]),
        criteria("slow: online more than twice", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.True,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.Count,
              countFilterType: FilterType.GreaterThan,
              countValue: 2,
            },
          ),
        ]),
        criteria("slow: flapping", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.False,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
              countFilterType: FilterType.GreaterThan,
              countValue: 2,
            },
          ),
        ]),
        criteria("slow: more than 50% slower than the previous check", [
          overTime(
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.GreaterThan,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
              changeType: PreviousCheckChangeType.Percentage,
              changeValue: 50,
            },
          ),
        ]),
        criteria("slow: went down", [
          overTime(
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.False,
              value: undefined,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
            },
          ),
        ]),
        // The step's own checks: slower than 500 ms on every one of them.
        criteria("slow: slower than 500 ms on every check", [
          overTime(
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.GreaterThan,
              value: 500,
            },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            },
          ),
        ]),
      ];

      const fastStep: MonitorStep = stepWith(FAST_CRITERIA);
      const slowStep: MonitorStep = stepWith(SLOW_CRITERIA);
      const monitor: Monitor = monitorWith(MonitorType.Website, [
        fastStep,
        slowStep,
      ]);

      const fastChecks: Array<Check> = [];
      const slowChecks: Array<Check> = [];

      beforeAll(async (): Promise<void> => {
        /*
         * Ten rounds, a minute apart. The probe checks the fast page on the
         * minute and the slow page ten seconds later, so each step's previous
         * row of the monitor is always the other step's.
         */
        for (let minute: number = 0; minute < 10; minute++) {
          at(minute, 0);
          fastChecks.push(
            await check({
              monitor: monitor,
              monitorStep: fastStep,
              dataToProcess: websiteCheck({
                monitor: monitor,
                monitorStep: fastStep,
                responseTimeInMs: 100,
                isOnline: true,
                responseCode: 200,
              }),
            }),
          );

          at(minute, 10);
          slowChecks.push(
            await check({
              monitor: monitor,
              monitorStep: slowStep,
              dataToProcess: websiteCheck({
                monitor: monitor,
                monitorStep: slowStep,
                responseTimeInMs: 1000,
                isOnline: false,
                responseCode: 503,
              }),
            }),
          );
        }
      });

      test("every row a check writes names the step it was judged as", async () => {
        const rows: Array<JSONObject> = await rowsOf(monitor);

        // Online, response time and status code, per check, for both steps.
        expect(rows).toHaveLength(10 * 2 * 3);

        const stepsOf: Record<string, Set<string>> = {};

        for (const row of rows) {
          const attributes: Record<string, string> = row[
            "attributes"
          ] as Record<string, string>;
          const stepId: string = attributes[MONITOR_STEP_ID_ATTRIBUTE] || "";

          expect([fastStep.id.toString(), slowStep.id.toString()]).toContain(
            stepId,
          );
          expect(attributes["probeId"]).toBe(PROBE_A.toString());

          stepsOf[stepId] = stepsOf[stepId] || new Set<string>();
          stepsOf[stepId]!.add(
            `${row["name"] as string}=${String(row["value"])}`,
          );
        }

        // Each step's rows hold that step's checks alone.
        expect(Array.from(stepsOf[fastStep.id.toString()]!).sort()).toEqual(
          [
            `${MonitorMetricType.IsOnline}=1`,
            `${MonitorMetricType.ResponseStatusCode}=200`,
            `${MonitorMetricType.ResponseTime}=100`,
          ].sort(),
        );
        expect(Array.from(stepsOf[slowStep.id.toString()]!).sort()).toEqual(
          [
            `${MonitorMetricType.IsOnline}=0`,
            `${MonitorMetricType.ResponseStatusCode}=503`,
            `${MonitorMetricType.ResponseTime}=1000`,
          ].sort(),
        );
      });

      test("no criteria of either step ever matches on the other step's checks", () => {
        const fastControl: string =
          FAST_CRITERIA[FAST_CRITERIA.length - 1]!.data!.name;
        const slowControl: string =
          SLOW_CRITERIA[SLOW_CRITERIA.length - 1]!.data!.name;

        for (const checked of fastChecks) {
          expect([null, fastControl]).toContain(checked.criteriaMet);

          for (const instance of FAST_CRITERIA.slice(0, -1)) {
            expect(result(checked, instance.data!.name).met).toBe(false);
          }
        }

        for (const checked of slowChecks) {
          expect([null, slowControl]).toContain(checked.criteriaMet);

          for (const instance of SLOW_CRITERIA.slice(0, -1)) {
            expect(result(checked, instance.data!.name).met).toBe(false);
          }
        }
      });

      test("each step's own checks meet its own criteria once its window is covered", () => {
        // All Values waits until the checks reach back over the 5 minutes.
        expect(fastChecks[0]!.criteriaMet).toBeNull();
        expect(slowChecks[0]!.criteriaMet).toBeNull();

        expect(fastChecks[9]!.criteriaMet).toBe("fast: online on every check");
        expect(slowChecks[9]!.criteriaMet).toBe(
          "slow: slower than 500 ms on every check",
        );
      });

      test("a counted window counts the step's own checks: 6 in 5 minutes, not 12", () => {
        const last: Check = fastChecks[9]!;

        expect(message(last, "fast: offline more than twice")).toContain(
          "matched on 0 of the 6 checks over the last 5 minutes",
        );
        expect(
          message(last, "fast: offline on more than 20% of checks"),
        ).toContain(
          "matched on 0% of the checks over the last 5 minutes (0 of 6 checks)",
        );
        expect(message(last, "fast: flapping")).toContain(
          "changed between matching and not matching 0 times over the last 5 minutes (6 checks)",
        );

        expect(
          message(slowChecks[9]!, "slow: online more than twice"),
        ).toContain("matched on 0 of the 6 checks over the last 5 minutes");
        expect(message(slowChecks[9]!, "slow: flapping")).toContain(
          "0 times over the last 5 minutes (6 checks)",
        );
      });

      test("the previous check is the step's own, never the other step checked between them", () => {
        // The fast page's previous check is its own 100 ms, a minute before.
        expect(
          message(
            fastChecks[5]!,
            "fast: more than 50% faster than the previous check",
          ),
        ).toContain("The previous check, 1 minute ago, read 100");
        expect(message(fastChecks[5]!, "fast: status code changed")).toContain(
          "The previous check, 1 minute ago, read 200",
        );
        expect(message(fastChecks[5]!, "fast: came back online")).toContain(
          "as it did on the previous check, 1 minute ago",
        );

        // The slow page's, its own 1000 ms.
        expect(
          message(
            slowChecks[5]!,
            "slow: more than 50% slower than the previous check",
          ),
        ).toContain("The previous check, 1 minute ago, read 1000");
        expect(message(slowChecks[5]!, "slow: went down")).toContain(
          "as it did on the previous check, 1 minute ago",
        );

        // The first check of each step has none, though the other step's was written.
        expect(
          message(
            slowChecks[0]!,
            "slow: more than 50% slower than the previous check",
          ),
        ).toContain("has no previous check in the last 5 minutes");
      });
    });

    describe("rows written before rows named their step", () => {
      const OFFLINE_MORE_THAN_THREE_TIMES: CriteriaFilter = overTime(
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
        {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.Count,
          countFilterType: FilterType.GreaterThan,
          countValue: 3,
        },
      );

      const FASTER_THAN_THE_PREVIOUS_CHECK: CriteriaFilter = overTime(
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.LessThan,
          value: undefined,
        },
        {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
          changeType: PreviousCheckChangeType.Percentage,
          changeValue: 50,
        },
      );

      const AVERAGE_ABOVE_500: CriteriaFilter = overTime(
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 500,
        },
        {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        },
      );

      /*
       * A monitor, and the step judged, whose first ten checks (minutes 20 to
       * 29) were written before rows named their step - offline, 1000 ms - and
       * whose checks from minute 30 on name it. A monitor with several steps
       * gets a second step that writes nothing.
       */
      async function playChecks(input: {
        filter: CriteriaFilter;
        stepCount: number;
        newChecks: Array<{ isOnline: boolean; responseTimeInMs: number }>;
      }): Promise<Array<Check>> {
        const judged: MonitorStep = stepWith([
          criteria("judged", [input.filter]),
        ]);
        const steps: Array<MonitorStep> = [judged];

        for (let index: number = 1; index < input.stepCount; index++) {
          steps.push(stepWith([]));
        }

        const monitor: Monitor = monitorWith(MonitorType.Website, steps);

        for (let minute: number = 20; minute < 30; minute++) {
          at(minute);
          await check({
            monitor: monitor,
            monitorStep: judged,
            dataToProcess: websiteCheck({
              monitor: monitor,
              monitorStep: judged,
              responseTimeInMs: 1000,
              isOnline: false,
              responseCode: 503,
            }),
            writtenBeforeRowsNamedTheirStep: true,
            judge: false,
          });
        }

        const checks: Array<Check> = [];

        for (let index: number = 0; index < input.newChecks.length; index++) {
          at(30 + index);
          checks.push(
            await check({
              monitor: monitor,
              monitorStep: judged,
              dataToProcess: websiteCheck({
                monitor: monitor,
                monitorStep: judged,
                responseTimeInMs: input.newChecks[index]!.responseTimeInMs,
                isOnline: input.newChecks[index]!.isOnline,
                responseCode: 200,
              }),
            }),
          );
        }

        return checks;
      }

      test("a monitor with one step reads them as its own: a count, an average, its previous check", async () => {
        const counted: Array<Check> = await playChecks({
          filter: OFFLINE_MORE_THAN_THREE_TIMES,
          stepCount: 1,
          newChecks: [{ isOnline: true, responseTimeInMs: 100 }],
        });

        // The ten offline checks before, and this online one: 10 of 11.
        expect(counted[0]!.criteriaMet).toBe("judged");
        expect(message(counted[0]!, "judged")).toContain(
          "matched on 10 of the 11 checks over the last 10 minutes",
        );

        const averaged: Array<Check> = await playChecks({
          filter: AVERAGE_ABOVE_500,
          stepCount: 1,
          newChecks: [{ isOnline: true, responseTimeInMs: 100 }],
        });

        // (10 x 1000 + 100) / 11, above 500.
        expect(averaged[0]!.criteriaMet).toBe("judged");

        const compared: Array<Check> = await playChecks({
          filter: FASTER_THAN_THE_PREVIOUS_CHECK,
          stepCount: 1,
          newChecks: [{ isOnline: true, responseTimeInMs: 100 }],
        });

        // Its previous check is the last one written before: 1000 ms.
        expect(compared[0]!.criteriaMet).toBe("judged");
        expect(message(compared[0]!, "judged")).toContain(
          "The previous check, 1 minute ago, read 1000",
        );
      });

      test("a monitor with several steps leaves them out, and its windows fill again", async () => {
        const counted: Array<Check> = await playChecks({
          filter: OFFLINE_MORE_THAN_THREE_TIMES,
          stepCount: 2,
          newChecks: [
            { isOnline: false, responseTimeInMs: 100 },
            { isOnline: false, responseTimeInMs: 100 },
            { isOnline: false, responseTimeInMs: 100 },
            { isOnline: false, responseTimeInMs: 100 },
          ],
        });

        // Only the checks that name the step count: 1, 2, 3, then 4 - past 3.
        expect(message(counted[0]!, "judged")).toContain(
          "matched on 1 of the 1 check over the last 10 minutes",
        );
        expect(counted[0]!.criteriaMet).toBeNull();
        expect(counted[1]!.criteriaMet).toBeNull();
        expect(counted[2]!.criteriaMet).toBeNull();
        expect(counted[3]!.criteriaMet).toBe("judged");
        expect(message(counted[3]!, "judged")).toContain(
          "matched on 4 of the 4 checks over the last 10 minutes",
        );

        const averaged: Array<Check> = await playChecks({
          filter: AVERAGE_ABOVE_500,
          stepCount: 2,
          newChecks: [{ isOnline: true, responseTimeInMs: 100 }],
        });

        // The step's own check alone: 100 ms.
        expect(averaged[0]!.criteriaMet).toBeNull();

        const compared: Array<Check> = await playChecks({
          filter: FASTER_THAN_THE_PREVIOUS_CHECK,
          stepCount: 2,
          newChecks: [
            { isOnline: true, responseTimeInMs: 1000 },
            { isOnline: true, responseTimeInMs: 100 },
          ],
        });

        // No previous check that names the step; then its own, 1000 ms.
        expect(compared[0]!.criteriaMet).toBeNull();
        expect(message(compared[0]!, "judged")).toContain(
          "has no previous check in the last 5 minutes",
        );
        expect(compared[1]!.criteriaMet).toBe("judged");
        expect(message(compared[1]!, "judged")).toContain(
          "The previous check, 1 minute ago, read 1000",
        );
      });
    });

    describe("a server's disks, each disk a series of its own", () => {
      const EVERY_DISK: CriteriaFilter = {
        checkOn: CheckOn.DiskUsagePercent,
        filterType: FilterType.GreaterThan,
        value: 80,
        serverMonitorOptions: { diskPath: "*" },
      };

      async function playDisks(input: {
        filter: CriteriaFilter;
        checks: Array<{ root: number; data: number }>;
      }): Promise<Array<Check>> {
        const step: MonitorStep = stepWith([criteria("disk", [input.filter])]);
        const monitor: Monitor = monitorWith(MonitorType.Server, [step]);
        const checks: Array<Check> = [];

        for (let index: number = 0; index < input.checks.length; index++) {
          at(60 + index);
          checks.push(
            await check({
              monitor: monitor,
              monitorStep: step,
              dataToProcess: serverCheck({
                monitor: monitor,
                disks: [
                  { diskPath: "/", percentUsed: input.checks[index]!.root },
                  { diskPath: "/data", percentUsed: input.checks[index]!.data },
                ],
              }),
            }),
          );
        }

        const rows: Array<JSONObject> = await rowsOf(monitor);

        // A server's report names the step too, every disk's rows included.
        expect(rows.length).toBeGreaterThan(0);

        for (const row of rows) {
          expect(
            (row["attributes"] as Record<string, string>)[
              MONITOR_STEP_ID_ATTRIBUTE
            ],
          ).toBe(step.id.toString());
        }

        return checks;
      }

      function matchedDisks(checked: Check): Array<string> {
        return checked.perSeriesMatches
          .map((match: PerSeriesCriteriaMatch): string => {
            return String(match.labels["diskPath"] || "");
          })
          .sort();
      }

      test("an average over each disk's window", async () => {
        const checks: Array<Check> = await playDisks({
          filter: overTime(EVERY_DISK, {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          }),
          checks: [
            { root: 40, data: 95 },
            { root: 40, data: 95 },
            { root: 40, data: 95 },
          ],
        });

        expect(checks[2]!.criteriaMet).toBe("disk");
        expect(matchedDisks(checks[2]!)).toEqual(["/data"]);
      });

      test("a count of each disk's checks", async () => {
        const checks: Array<Check> = await playDisks({
          filter: overTime(EVERY_DISK, {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Count,
            countFilterType: FilterType.GreaterThan,
            countValue: 1,
          }),
          checks: [
            { root: 90, data: 95 },
            { root: 40, data: 95 },
            { root: 40, data: 95 },
          ],
        });

        // "/" was above 80% once, "/data" on every check.
        expect(checks[2]!.criteriaMet).toBe("disk");
        expect(matchedDisks(checks[2]!)).toEqual(["/data"]);
      });

      test("each disk compared with its own previous check", async () => {
        const checks: Array<Check> = await playDisks({
          filter: overTime(
            { ...EVERY_DISK, value: undefined },
            {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
              changeType: PreviousCheckChangeType.Amount,
              changeValue: 20,
            },
          ),
          checks: [
            { root: 70, data: 50 },
            { root: 75, data: 95 },
          ],
        });

        // "/data" rose 45 points since its previous check, "/" 5.
        expect(checks[0]!.criteriaMet).toBeNull();
        expect(checks[1]!.criteriaMet).toBe("disk");
        expect(matchedDisks(checks[1]!)).toEqual(["/data"]);
      });
    });

    describe("an SSL monitor with two steps: each certificate's days left compared with its own previous check (#10905)", () => {
      const DROPPED_BY_MORE_THAN_ONE: CriteriaFilter = overTime(
        {
          checkOn: CheckOn.ExpiresInDays,
          filterType: FilterType.LessThan,
          value: undefined,
        },
        {
          timeValueInMinutes: 60,
          evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
          changeType: PreviousCheckChangeType.Amount,
          changeValue: 1,
        },
      );

      const RENEWED: CriteriaFilter = overTime(
        {
          checkOn: CheckOn.ExpiresInDays,
          filterType: FilterType.GreaterThan,
          value: undefined,
        },
        {
          timeValueInMinutes: 60,
          evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
          changeType: PreviousCheckChangeType.Amount,
          changeValue: 0,
        },
      );

      // A certificate this many days and an hour from the clock's now.
      function certificateCheck(input: {
        monitor: Monitor;
        monitorStep: MonitorStep;
        daysLeft: number;
      }): ProbeMonitorResponse {
        return {
          ...websiteCheck({
            monitor: input.monitor,
            monitorStep: input.monitorStep,
            responseTimeInMs: 50,
            isOnline: true,
            responseCode: 200,
          }),
          sslResponse: {
            expiresAt: new Date(
              OneUptimeDate.getCurrentDate().getTime() +
                (input.daysLeft * 24 + 1) * 60 * MINUTE,
            ),
          },
        } as ProbeMonitorResponse;
      }

      test("a shop's certificate replaced, then renewed, never read against the status page's", async () => {
        const shop: MonitorStep = stepWith([
          criteria("shop: dropped by more than a day", [
            DROPPED_BY_MORE_THAN_ONE,
          ]),
          criteria("shop: renewed", [RENEWED]),
        ]);
        const status: MonitorStep = stepWith([
          criteria("status: dropped by more than a day", [
            DROPPED_BY_MORE_THAN_ONE,
          ]),
          criteria("status: renewed", [RENEWED]),
        ]);
        const monitor: Monitor = monitorWith(MonitorType.SSLCertificate, [
          shop,
          status,
        ]);

        // Every five minutes: the shop's certificate, then the status page's.
        const rounds: Array<{ shop: number; status: number }> = [
          { shop: 30, status: 300 },
          // Read against each other, 30 is far below 300 and 300 far above 30.
          { shop: 30, status: 300 },
          // The shop's certificate replaced by one that expires sooner.
          { shop: 27, status: 300 },
          // And renewed.
          { shop: 90, status: 300 },
        ];

        const shopMet: Array<string | null> = [];
        const statusMet: Array<string | null> = [];

        for (let index: number = 0; index < rounds.length; index++) {
          at(120 + index * 5, 0);
          shopMet.push(
            (
              await check({
                monitor: monitor,
                monitorStep: shop,
                dataToProcess: certificateCheck({
                  monitor: monitor,
                  monitorStep: shop,
                  daysLeft: rounds[index]!.shop,
                }),
              })
            ).criteriaMet,
          );

          at(120 + index * 5, 20);
          statusMet.push(
            (
              await check({
                monitor: monitor,
                monitorStep: status,
                dataToProcess: certificateCheck({
                  monitor: monitor,
                  monitorStep: status,
                  daysLeft: rounds[index]!.status,
                }),
              })
            ).criteriaMet,
          );
        }

        expect(shopMet).toEqual([
          null,
          null,
          "shop: dropped by more than a day",
          "shop: renewed",
        ]);
        expect(statusMet).toEqual([null, null, null, null]);

        // The days left are a series of each step's own.
        const rows: Array<JSONObject> = (await rowsOf(monitor)).filter(
          (row: JSONObject): boolean => {
            return (
              row["name"] === MonitorMetricType.SslCertificateExpiresInDays
            );
          },
        );

        expect(
          rows
            .filter((row: JSONObject): boolean => {
              return (
                (row["attributes"] as Record<string, string>)[
                  MONITOR_STEP_ID_ATTRIBUTE
                ] === shop.id.toString()
              );
            })
            .map((row: JSONObject): number => {
              return Number(row["value"]);
            }),
        ).toEqual([30, 30, 27, 90]);
      });
    });

    test("every read of the suite went to ClickHouse", () => {
      expect(queryCount).toBeGreaterThan(0);
    });
  },
);
