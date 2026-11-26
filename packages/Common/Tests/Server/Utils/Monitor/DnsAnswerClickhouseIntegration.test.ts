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
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import DnsAnswerFingerprint from "../../../../Server/Utils/Monitor/DnsAnswerFingerprint";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseClientConfigOptions } from "../../../../Server/Infrastructure/ClickhouseConfig";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import logger from "../../../../Server/Utils/Logger";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  DNS_ANSWER_METRIC_NAME,
  DNS_ANSWER_TEXT_ATTRIBUTE,
} from "../../../../Types/Monitor/DnsMonitor/DnsAnswer";
import { DnsRecordResponse } from "../../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnsRecordType from "../../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MONITOR_STEP_ID_ATTRIBUTE } from "../../../../Types/Monitor/MonitorStepSeries";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DNS ANSWER COMPARED WITH THE PREVIOUS CHECK'S, IN A REAL CLICKHOUSE
 * (#10905).
 *
 * "Alert me when the DNS answer changes": DNS Record Value, Previous Check,
 * Not Equal To. Checks of a DNS monitor are played minute by minute the way
 * MonitorResource handles each probe result: the real MonitorMetricUtil
 * writes the answer's fingerprint to the real MetricItemV3, and the real
 * MonitorCriteriaEvaluator compares it, with the product's own statement,
 * with the probe's previous answer of the step.
 *
 * An answer that changed matches, and says what it was; one that did not -
 * the same records, in another order, with their TTLs counted down, a name in
 * another case - does not. A check that got no answer is not compared, and
 * the next one that did is compared with the answer before it. Each probe and
 * each step is compared with its own previous answer, a previous answer older
 * than the window is none, and Equal To matches a steady answer.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -d --name <a name of your own> -p 127.0.0.1:18195:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7.38.18
 * then TEST_CLICKHOUSE_URL=http://default:test@localhost:18195 npx jest <this file>
 * (or a URL without credentials and CLICKHOUSE_PASSWORD set). The App Test
 * workflow provides the server in CI (Common's test-clickhouse script). The
 * suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(600000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `dns_answers_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;

/*
 * Every check happens on a clock of its own, hours back from now and on the
 * minute, so rows stay inside their retention.
 */
const BASE: number =
  Math.floor((Date.now() - 3 * 60 * MINUTE) / MINUTE) * MINUTE;

const OSLO: ObjectID = new ObjectID("0193a0a0-0000-7000-8000-0000001090a1");
const SYDNEY: ObjectID = new ObjectID("0193a0a0-0000-7000-8000-0000001090a2");

let client: ClickhouseClient;
let clickhouse: ClickhouseDatabase;

function at(minute: number, second: number = 0): void {
  jest.setSystemTime(new Date(BASE + minute * MINUTE + second * 1000));
}

function answerFilter(
  filterType: FilterType = FilterType.NotEqualTo,
  input: { minutes?: number; onNoDataPolicy?: NoDataPolicy } = {},
): CriteriaFilter {
  return {
    checkOn: CheckOn.DnsRecordValue,
    filterType: filterType,
    value: undefined,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: input.minutes ?? 5,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      ...(input.onNoDataPolicy ? { onNoDataPolicy: input.onNoDataPolicy } : {}),
    },
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

function monitorWith(steps: Array<MonitorStep>): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.DNS;
  monitor.monitoringInterval = "* * * * *";
  monitor.name = "example.com";

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

function a(value: string, ttl: number = 300): DnsRecordResponse {
  return { type: DnsRecordType.A, value: value, ttl: ttl };
}

interface Checked {
  criteriaMet: string | null;
  results: Array<MonitorEvaluationCriteriaResult>;
}

/*
 * One check, as MonitorResource handles it: the time its rows begin to be
 * written taken, its rows written naming the step, then judged. `records`
 * null is a lookup that failed: offline, no records.
 */
async function check(input: {
  monitor: Monitor;
  step: MonitorStep;
  minute: number;
  records: Array<DnsRecordResponse> | null;
  probeId?: ObjectID;
}): Promise<Checked> {
  at(input.minute);

  const isOnline: boolean = input.records !== null;
  const dataToProcess: ProbeMonitorResponse = {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    monitorStepId: input.step.id,
    probeId: input.probeId || OSLO,
    isOnline: isOnline,
    responseTimeInMs: 12,
    failureCause: isOnline ? "" : "queryA ENOTFOUND example.com",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    dnsResponse: {
      isOnline: isOnline,
      responseTimeInMs: 12,
      failureCause: isOnline ? "" : "queryA ENOTFOUND example.com",
      records: input.records || [],
    },
  };

  const checkWrittenAt: Date = OneUptimeDate.getCurrentDate();

  await MonitorMetricUtil.saveMonitorMetrics({
    monitorId: input.monitor.id!,
    projectId: input.monitor.projectId!,
    dataToProcess: dataToProcess,
    probeName: undefined,
    monitorName: input.monitor.name,
    monitorStepId: input.step.id,
  });

  const summary: MonitorEvaluationSummary = {
    evaluatedAt: OneUptimeDate.getCurrentDate(),
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: input.step,
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
    results: summary.criteriaResults,
  };
}

function messageOf(checked: Checked, criteriaName: string): string {
  const found: MonitorEvaluationCriteriaResult | undefined =
    checked.results.find((row: MonitorEvaluationCriteriaResult): boolean => {
      return row.criteriaName === criteriaName;
    });

  if (!found) {
    throw new Error(`${criteriaName} was not judged.`);
  }

  return found.filters
    .map((filter: { message: string }): string => {
      return filter.message;
    })
    .join(" ");
}

async function answerRowsOf(monitor: Monitor): Promise<Array<JSONObject>> {
  return (
    (await (
      await client.query({
        query: `SELECT value, attributes FROM ${database}.MetricItemV3 WHERE primaryEntityId = {monitorId:String} AND name = {name:String} ORDER BY time`,
        query_params: {
          monitorId: monitor.id!.toString(),
          name: DNS_ANSWER_METRIC_NAME,
        },
        format: "JSON",
      })
    ).json()) as { data: Array<JSONObject> }
  ).data;
}

async function createMetricTable(): Promise<void> {
  const model: Metric = new Metric();
  const generator: StatementGenerator<Metric> = new StatementGenerator<Metric>({
    modelType: Metric,
    database: clickhouse,
  });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  // As the model keeps it, without ON CLUSTER: this server runs no Keeper.
  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface Connection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration(
  "a DNS answer compared with the previous check's, in a real ClickHouse",
  () => {
    let original: Connection | undefined;

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
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      // The credentials the URL names, as CI writes it; else config.env's.
      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username:
          decodeURIComponent(url.username) ||
          process.env["CLICKHOUSE_USER"] ||
          "default",
        password: url.username
          ? decodeURIComponent(url.password)
          : process.env["CLICKHOUSE_PASSWORD"] || "",
        database: database,
        request_timeout: 300000,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      await createMetricTable();

      original = {
        database: MetricService.database,
        databaseClient: MetricService.databaseClient,
        ingestDatabase: MetricService.ingestDatabase,
        ingestDatabaseClient: MetricService.ingestDatabaseClient,
      };

      Object.assign(MetricService, {
        database: clickhouse,
        databaseClient: client,
        ingestDatabase: clickhouse,
        ingestDatabaseClient: client,
      });

      // Every row a check writes lands in the real table, readable at once.
      jest
        .spyOn(MetricService, "insertJsonRows")
        .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
          await client.insert({
            table: `${database}.${new Metric().tableName}`,
            values: rows,
            format: "JSONEachRow",
            clickhouse_settings: { input_format_skip_unknown_fields: 1 },
          });
        });

      jest
        .spyOn(GlobalConfigService, "findOneBy")
        .mockResolvedValue(null as never);

      jest
        .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
        .mockResolvedValue(undefined as never);

      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      });
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(MetricService, original);
      }

      // Closed while the client still has Node's timers to close with.
      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    describe("a name whose answer changes, minute by minute", () => {
      const step: MonitorStep = stepWith([
        criteria("Answer changed", [answerFilter()]),
      ]);
      const monitor: Monitor = monitorWith([step]);

      test("the first check has no previous answer, and waits (If No Data: Ignore)", async () => {
        const checked: Checked = await check({
          monitor,
          step,
          minute: 0,
          records: [a("93.184.216.34"), a("93.184.216.35")],
        });

        expect(checked.criteriaMet).toBeNull();
        expect(messageOf(checked, "Answer changed")).toContain(
          "has no previous check in the last 5 minutes",
        );
      });

      test("the same answer a minute later is no change", async () => {
        const checked: Checked = await check({
          monitor,
          step,
          minute: 1,
          records: [a("93.184.216.34"), a("93.184.216.35")],
        });

        expect(checked.criteriaMet).toBeNull();
        expect(messageOf(checked, "Answer changed")).toBe(
          "The DNS answer is the same as on the previous check, 1 minute ago: A 93.184.216.34, A 93.184.216.35.",
        );
      });

      test("the same records in another order, their TTLs counted down, are no change", async () => {
        const checked: Checked = await check({
          monitor,
          step,
          minute: 2,
          records: [a("93.184.216.35", 41), a("93.184.216.34", 41)],
        });

        expect(checked.criteriaMet).toBeNull();
        expect(messageOf(checked, "Answer changed")).toContain(
          "is the same as on the previous check",
        );
      });

      test("a record replaced is a change, and the finding says what the answer was and is", async () => {
        const checked: Checked = await check({
          monitor,
          step,
          minute: 3,
          records: [a("93.184.216.34"), a("203.0.113.7")],
        });

        expect(checked.criteriaMet).toBe("Answer changed");
        expect(messageOf(checked, "Answer changed")).toBe(
          "The DNS answer is different from the previous check, 1 minute ago: it was A 93.184.216.34, A 93.184.216.35, and is now A 203.0.113.7, A 93.184.216.34.",
        );
      });

      test("the next check, with the new answer, is no change: it fired once", async () => {
        expect(
          (
            await check({
              monitor,
              step,
              minute: 4,
              records: [a("203.0.113.7"), a("93.184.216.34")],
            })
          ).criteriaMet,
        ).toBeNull();
      });

      test("a check that got no answer is not compared, and writes no answer", async () => {
        const before: number = (await answerRowsOf(monitor)).length;
        const checked: Checked = await check({
          monitor,
          step,
          minute: 5,
          records: null,
        });

        expect(checked.criteriaMet).toBeNull();
        expect(messageOf(checked, "Answer changed")).toBe(
          "This check got no DNS answer, so it was not compared with the previous one.",
        );
        expect(await answerRowsOf(monitor)).toHaveLength(before);
      });

      test("an empty answer is no answer either", async () => {
        const checked: Checked = await check({
          monitor,
          step,
          minute: 6,
          records: [],
        });

        expect(checked.criteriaMet).toBeNull();
      });

      test("after the failures, the answer is compared with the last one before them: unchanged", async () => {
        const checked: Checked = await check({
          monitor,
          step,
          minute: 7,
          records: [a("93.184.216.34"), a("203.0.113.7")],
        });

        expect(checked.criteriaMet).toBeNull();
        expect(messageOf(checked, "Answer changed")).toContain(
          "is the same as on the previous check, 3 minutes ago",
        );
      });

      test("a record added is a change, and so is a record gone", async () => {
        expect(
          (
            await check({
              monitor,
              step,
              minute: 8,
              records: [
                a("93.184.216.34"),
                a("203.0.113.7"),
                a("198.51.100.1"),
              ],
            })
          ).criteriaMet,
        ).toBe("Answer changed");

        expect(
          (
            await check({
              monitor,
              step,
              minute: 9,
              records: [a("93.184.216.34"), a("203.0.113.7")],
            })
          ).criteriaMet,
        ).toBe("Answer changed");
      });

      test("each answer the checks wrote is its fingerprint, exactly, named for the probe and the step, with the answer in words", async () => {
        const rows: Array<JSONObject> = await answerRowsOf(monitor);

        // Every check above but the two that got no answer.
        expect(rows).toHaveLength(8);

        const last: JSONObject = rows[rows.length - 1]!;
        const attributes: JSONObject = last["attributes"] as JSONObject;

        expect(Number(last["value"])).toBe(
          DnsAnswerFingerprint.of(["A 203.0.113.7", "A 93.184.216.34"]),
        );
        expect(attributes[DNS_ANSWER_TEXT_ATTRIBUTE]).toBe(
          "A 203.0.113.7, A 93.184.216.34",
        );
        expect(attributes["probeId"]).toBe(OSLO.toString());
        expect(attributes[MONITOR_STEP_ID_ATTRIBUTE]).toBe(step.id.toString());
      });
    });

    describe("names, which DNS reads in any case", () => {
      test("a CNAME answered in another case is the same answer", async () => {
        const step: MonitorStep = stepWith([
          criteria("Answer changed", [answerFilter()]),
        ]);
        const monitor: Monitor = monitorWith([step]);

        await check({
          monitor,
          step,
          minute: 20,
          records: [{ type: DnsRecordType.CNAME, value: "shop.example.net" }],
        });

        expect(
          (
            await check({
              monitor,
              step,
              minute: 21,
              records: [
                { type: DnsRecordType.CNAME, value: "Shop.Example.NET" },
              ],
            })
          ).criteriaMet,
        ).toBeNull();

        expect(
          (
            await check({
              monitor,
              step,
              minute: 22,
              records: [
                { type: DnsRecordType.CNAME, value: "cdn.example.org" },
              ],
            })
          ).criteriaMet,
        ).toBe("Answer changed");
      });
    });

    describe("each probe compared with its own previous answer", () => {
      test("a name that answers each region differently is no change; one region's change is", async () => {
        const step: MonitorStep = stepWith([
          criteria("Answer changed", [answerFilter()]),
        ]);
        const monitor: Monitor = monitorWith([step]);

        for (const minute of [30, 31, 32]) {
          for (const [probeId, address] of [
            [OSLO, "192.0.2.10"],
            [SYDNEY, "198.51.100.20"],
          ] as Array<[ObjectID, string]>) {
            const checked: Checked = await check({
              monitor,
              step,
              minute,
              probeId,
              records: [a(address)],
            });

            expect(checked.criteriaMet).toBeNull();
          }
        }

        const sydneyMoved: Checked = await check({
          monitor,
          step,
          minute: 33,
          probeId: SYDNEY,
          records: [a("198.51.100.21")],
        });

        expect(sydneyMoved.criteriaMet).toBe("Answer changed");
        expect(messageOf(sydneyMoved, "Answer changed")).toContain(
          "it was A 198.51.100.20, and is now A 198.51.100.21",
        );

        // Oslo's answer, the same minute, is compared with Oslo's own.
        expect(
          (
            await check({
              monitor,
              step,
              minute: 33,
              probeId: OSLO,
              records: [a("192.0.2.10")],
            })
          ).criteriaMet,
        ).toBeNull();
      });
    });

    describe("each step compared with its own previous answer", () => {
      test("two names checked by one monitor never read as each other's change", async () => {
        const shop: MonitorStep = stepWith([
          criteria("Shop answer changed", [answerFilter()]),
        ]);
        const mail: MonitorStep = stepWith([
          criteria("Mail answer changed", [answerFilter()]),
        ]);
        const monitor: Monitor = monitorWith([shop, mail]);

        for (const minute of [40, 41, 42]) {
          expect(
            (
              await check({
                monitor,
                step: shop,
                minute,
                records: [a("192.0.2.80")],
              })
            ).criteriaMet,
          ).toBeNull();
          expect(
            (
              await check({
                monitor,
                step: mail,
                minute,
                records: [
                  { type: DnsRecordType.MX, value: "10 mx.example.com" },
                ],
              })
            ).criteriaMet,
          ).toBeNull();
        }

        expect(
          (
            await check({
              monitor,
              step: mail,
              minute: 43,
              records: [
                { type: DnsRecordType.MX, value: "10 mx2.example.com" },
              ],
            })
          ).criteriaMet,
        ).toBe("Mail answer changed");
        expect(
          (
            await check({
              monitor,
              step: shop,
              minute: 43,
              records: [a("192.0.2.80")],
            })
          ).criteriaMet,
        ).toBeNull();
      });
    });

    describe("the window and If No Data", () => {
      test("a previous answer older than the window is none: the change after a long gap waits", async () => {
        const step: MonitorStep = stepWith([
          criteria("Answer changed", [answerFilter()]),
        ]);
        const monitor: Monitor = monitorWith([step]);

        await check({ monitor, step, minute: 50, records: [a("192.0.2.1")] });

        const afterGap: Checked = await check({
          monitor,
          step,
          minute: 60,
          records: [a("192.0.2.2")],
        });

        expect(afterGap.criteriaMet).toBeNull();
        expect(messageOf(afterGap, "Answer changed")).toContain(
          "has no previous check in the last 5 minutes",
        );
      });

      test("Treat As Zero reads no previous answer as a different one", async () => {
        const step: MonitorStep = stepWith([
          criteria("Answer changed", [
            answerFilter(FilterType.NotEqualTo, {
              onNoDataPolicy: NoDataPolicy.TreatAsZero,
            }),
          ]),
        ]);
        const monitor: Monitor = monitorWith([step]);

        expect(
          (
            await check({
              monitor,
              step,
              minute: 70,
              records: [a("192.0.2.1")],
            })
          ).criteriaMet,
        ).toBe("Answer changed");
        expect(
          (
            await check({
              monitor,
              step,
              minute: 71,
              records: [a("192.0.2.1")],
            })
          ).criteriaMet,
        ).toBeNull();
      });
    });

    describe("Equal To: the answer is the same as the previous check's", () => {
      test("matches while the answer holds, and not on the check it changed", async () => {
        const step: MonitorStep = stepWith([
          criteria("Answer steady", [answerFilter(FilterType.EqualTo)]),
        ]);
        const monitor: Monitor = monitorWith([step]);

        expect(
          (
            await check({
              monitor,
              step,
              minute: 80,
              records: [a("192.0.2.1")],
            })
          ).criteriaMet,
        ).toBeNull();
        expect(
          (
            await check({
              monitor,
              step,
              minute: 81,
              records: [a("192.0.2.1")],
            })
          ).criteriaMet,
        ).toBe("Answer steady");
        expect(
          (
            await check({
              monitor,
              step,
              minute: 82,
              records: [a("192.0.2.9")],
            })
          ).criteriaMet,
        ).toBeNull();
        expect(
          (
            await check({
              monitor,
              step,
              minute: 83,
              records: [a("192.0.2.9")],
            })
          ).criteriaMet,
        ).toBe("Answer steady");
      });
    });
  },
);
