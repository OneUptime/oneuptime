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
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MetricBaselineService, {
  BaselineBand,
  BaselineSummary,
  MetricBaselineService as MetricBaselineServiceClass,
  MetricSeriesBaselines,
} from "../../../../Server/Services/MetricBaselineService";
import SnmpMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseClientConfigOptions } from "../../../../Server/Infrastructure/ClickhouseConfig";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import logger from "../../../../Server/Utils/Logger";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import MetricBaselineHourly from "../../../../Models/AnalyticsModels/MetricBaselineHourly";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepSeries, {
  MONITOR_STEP_ID_ATTRIBUTE,
} from "../../../../Types/Monitor/MonitorStepSeries";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
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
 * EACH STEP OF A NETWORK DEVICE MONITOR, ITS INTERFACE UTILIZATION JUDGED
 * AGAINST ITS OWN HISTORY, IN A REAL CLICKHOUSE (#10985).
 *
 * A monitor whose two steps watch a core switch, its uplink busy around 70%,
 * and an access switch, its busiest port around 5%. Two weeks of polls at the
 * hour judged are written through the real MonitorMetricUtil, naming the step
 * each was judged as - into the real MetricItemV3 and, through its real view,
 * the hourly rollup - and each step is judged through the real
 * MonitorCriteriaEvaluator, whose anomaly condition reads its baseline with
 * the product's own statements.
 *
 * The monitor's rollup mixes both switches and every port: 75% on the access
 * switch, and the core switch dropping to 8%, are well inside it. Each step's
 * own history says otherwise, and the evaluator now asks it. Then the rows
 * written before rows named their step, a criteria naming one interface, one
 * fanned out over every interface, and a monitor metric retention too short
 * to hold two weeks.
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
const database: string = `snmp_step_baselines_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

/*
 * The hour judged: 09:00 UTC two days back, so every row of the two weeks
 * before it is in the past and inside its retention. A check is judged at
 * 09:30, and each earlier day of the window has twelve polls in its 09:00.
 */
const HOUR_START: number =
  Math.floor((Date.now() - 2 * DAY) / DAY) * DAY + 9 * HOUR;
const JUDGED_AT: number = HOUR_START + 30 * MINUTE;
const DAYS_OF_HISTORY: number = 14;
const POLLS_AN_HOUR: number = 12;

const PROBE: ObjectID = new ObjectID("0193a0a0-0000-7000-8000-0000001098f1");

let client: ClickhouseClient;
let clickhouse: ClickhouseDatabase;

// What the product's writer sends, until a scenario writes it out at once.
let pending: Array<JSONObject> = [];

let retentionInDays: number | null = null;

interface Port {
  name: string;
  alias?: string;
  // Its usual utilization, and how far a poll strays from it either way.
  level: number;
  spread: number;
}

function at(time: number): void {
  jest.setSystemTime(new Date(time));
}

function filter(
  filterType: FilterType,
  interfaceName?: string,
): CriteriaFilter {
  return {
    checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
    filterType: filterType,
    value: undefined,
    metricMonitorOptions: {
      anomalyDetection: { sensitivity: AnomalyDetectionSensitivity.Medium },
    },
    ...(interfaceName !== undefined
      ? { snmpMonitorOptions: { interfaceName: interfaceName } }
      : {}),
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

// Busy, then idle: the first criteria a check meets is the one it reports.
function busyOrIdle(interfaceName?: string): Array<MonitorCriteriaInstance> {
  return [
    criteria("Busy", [filter(FilterType.AnomalouslyHigh, interfaceName)]),
    criteria("Idle", [filter(FilterType.AnomalouslyLow, interfaceName)]),
  ];
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
  monitor.monitorType = MonitorType.NetworkDevice;
  monitor.monitoringInterval = "*/5 * * * *";
  monitor.name = "Switches";

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

// A walk of a device's ports, as the device poll hands it to the monitor.
function walk(input: {
  monitor: Monitor;
  step: MonitorStep;
  ports: Array<{ name: string; alias?: string; utilizationPercent: number }>;
}): ProbeMonitorResponse {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    monitorStepId: input.step.id,
    probeId: PROBE,
    isOnline: true,
    responseTimeInMs: 25,
    failureCause: "",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    snmpResponse: {
      isOnline: true,
      responseTimeInMs: 25,
      failureCause: "",
      oidResponses: [],
      interfaces: input.ports.map(
        (
          port: { name: string; alias?: string; utilizationPercent: number },
          index: number,
        ): SnmpInterface => {
          return {
            interfaceIndex: index + 1,
            name: port.name,
            ...(port.alias ? { alias: port.alias } : {}),
            isOperationallyUp: true,
            isAdministrativelyUp: true,
            utilizationPercent: port.utilizationPercent,
            inBitsPerSecond: 1000,
            outBitsPerSecond: 1000,
            errorsPerSecond: 0,
          };
        },
      ),
    },
  };
}

/*
 * Two weeks of polls of a step's device at the hour judged, written as the
 * product writes them: every row naming the step, or - for polls made before
 * rows named their step - none. A poll strays from each port's level by up to
 * its spread, the same way on every day.
 */
async function writeHistory(input: {
  monitor: Monitor;
  step: MonitorStep;
  ports: Array<Port>;
  days?: Array<number>;
  writtenBeforeRowsNamedTheirStep?: boolean;
}): Promise<void> {
  const days: Array<number> =
    input.days ||
    new Array<number>(DAYS_OF_HISTORY).fill(0).map((_: number, i: number) => {
      return i + 1;
    });

  for (const day of days) {
    for (let poll: number = 0; poll < POLLS_AN_HOUR; poll++) {
      at(HOUR_START - day * DAY + poll * 5 * MINUTE);

      // -1, -0.5, 0, 0.5, 1 of the spread, in turn.
      const stray: number = (((day * 7 + poll * 3) % 5) - 2) / 2;

      await MonitorMetricUtil.saveMonitorMetrics({
        monitorId: input.monitor.id!,
        projectId: input.monitor.projectId!,
        dataToProcess: walk({
          monitor: input.monitor,
          step: input.step,
          ports: input.ports.map((port: Port) => {
            return {
              name: port.name,
              ...(port.alias ? { alias: port.alias } : {}),
              utilizationPercent: port.level + stray * port.spread,
            };
          }),
        }),
        probeName: undefined,
        monitorName: input.monitor.name,
        monitorStepId: input.writtenBeforeRowsNamedTheirStep
          ? undefined
          : input.step.id,
      });
    }
  }
}

// What the writer sent, written out in one insert: the hourly view reads it too.
async function flush(): Promise<void> {
  const rows: Array<JSONObject> = pending;
  pending = [];

  if (rows.length === 0) {
    return;
  }

  await client.insert({
    table: `${database}.${new Metric().tableName}`,
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { input_format_skip_unknown_fields: 1 },
  });
}

interface Judged {
  criteriaMet: string | null;
  perSeriesMatches: Array<PerSeriesCriteriaMatch>;
  results: Array<MonitorEvaluationCriteriaResult>;
}

// A poll at the moment judged, judged as MonitorResource judges it.
async function judge(input: {
  monitor: Monitor;
  step: MonitorStep;
  ports: Array<{ name: string; alias?: string; utilizationPercent: number }>;
}): Promise<Judged> {
  await flush();
  at(JUDGED_AT);

  const summary: MonitorEvaluationSummary = {
    evaluatedAt: OneUptimeDate.getCurrentDate(),
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: walk(input),
      monitorStep: input.step,
      monitor: input.monitor,
      probeApiIngestResponse: {
        monitorId: input.monitor.id!,
        criteriaMetId: undefined,
        rootCause: null,
      },
      evaluationSummary: summary,
      recordMatchHistory: false,
      checkWrittenAt: OneUptimeDate.getCurrentDate(),
    });

  return {
    criteriaMet: response.criteriaMetId || null,
    perSeriesMatches: response.perSeriesMatches || [],
    results: summary.criteriaResults,
  };
}

function messageOf(judged: Judged, criteriaName: string): string {
  const found: MonitorEvaluationCriteriaResult | undefined =
    judged.results.find((row: MonitorEvaluationCriteriaResult): boolean => {
      return row.criteriaName === criteriaName;
    });

  return (found?.filters || [])
    .map((row: { message: string }): string => {
      return row.message;
    })
    .join(" ");
}

// The baseline the condition was read against before #10985: the monitor's rollup.
async function rollupOf(monitor: Monitor): Promise<BaselineSummary | null> {
  at(JUDGED_AT);

  return await MetricBaselineService.getBaseline({
    projectId: monitor.projectId!.toString(),
    metricName: MonitorMetricType.SnmpInterfaceUtilizationPercent,
    primaryEntityId: monitor.id!.toString(),
    hourOfWeek: MetricBaselineServiceClass.computeHourOfWeek(
      new Date(JUDGED_AT),
    ),
  });
}

function bandOf(baseline: BaselineSummary | null): BaselineBand {
  expect(baseline?.isReliable).toBe(true);

  const band: BaselineBand | null = MetricBaselineServiceClass.getBand({
    baseline: baseline!,
    sigmaCount: MetricBaselineServiceClass.sigmaForSensitivity(
      AnomalyDetectionSensitivity.Medium,
    ),
  });

  expect(band).not.toBeNull();
  return band!;
}

async function createTable(modelType: {
  new (): AnalyticsBaseModel;
}): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  /*
   * As the model keeps it, without ON CLUSTER: the product writes its DDL for
   * a cluster, which needs a Keeper this server does not run.
   */
  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });

  // The rollup's own view, read from the table it is written for.
  for (const view of model.materializedViews || []) {
    await client.command({ query: view.query });
  }
}

interface Connection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration(
  "each step of a Network Device monitor judged against its own utilization, in a real ClickHouse",
  () => {
    let original: { baseline: Connection; metric: Connection } | undefined;

    // A core switch, its uplink busy, and an access switch, every port quiet.
    const CORE: Array<Port> = [
      { name: "TenGigE0/1", alias: "Uplink", level: 70, spread: 8 },
      { name: "Gi0/2", level: 20, spread: 2 },
    ];
    const ACCESS: Array<Port> = [
      { name: "Fa0/1", level: 5, spread: 1 },
      { name: "Fa0/2", level: 2, spread: 0.5 },
    ];

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

      /*
       * The credentials the URL names, as CI writes it; else the ones
       * config.env names. Connecting creates the database, and every
       * statement of the session reads its tables.
       */
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

      await createTable(Metric);
      await createTable(MetricBaselineHourly);

      original = {
        baseline: {
          database: MetricBaselineService.database,
          databaseClient: MetricBaselineService.databaseClient,
          ingestDatabase: MetricBaselineService.ingestDatabase,
          ingestDatabaseClient: MetricBaselineService.ingestDatabaseClient,
        },
        metric: {
          database: MetricService.database,
          databaseClient: MetricService.databaseClient,
          ingestDatabase: MetricService.ingestDatabase,
          ingestDatabaseClient: MetricService.ingestDatabaseClient,
        },
      };

      for (const service of [MetricBaselineService, MetricService]) {
        Object.assign(service, {
          database: clickhouse,
          databaseClient: client,
          ingestDatabase: clickhouse,
          ingestDatabaseClient: client,
        });
      }

      // Every row a check writes is kept until the scenario writes it out.
      jest
        .spyOn(MetricService, "insertJsonRows")
        .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
          pending.push(...rows);
        });

      // A monitor metric retention of 30 days, unless a scenario sets one.
      jest
        .spyOn(GlobalConfigService, "findOneBy")
        .mockImplementation((async (): Promise<GlobalConfig | null> => {
          if (retentionInDays === null) {
            return null;
          }

          const config: GlobalConfig = new GlobalConfig();
          config.monitorMetricRetentionInDays = retentionInDays;
          return config;
        }) as never);

      jest
        .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
        .mockResolvedValue(undefined as never);

      // The cache only saves a read: every judgement here reads its baseline.
      jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
      jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);

      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      });
      jest.spyOn(logger, "warn").mockImplementation(() => {
        return undefined as never;
      });
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(MetricBaselineService, original.baseline);
        Object.assign(MetricService, original.metric);
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

    // A monitor metric retention for the writes that follow.
    function keepRowsFor(days: number | null): void {
      retentionInDays = days;
      // MonitorMetricUtil keeps what it read for five minutes.
      Object.assign(MonitorMetricUtil, {
        cachedRetentionDays: null,
        lastCacheRefresh: null,
      });
    }

    describe("a core switch and an access switch, the two steps of one monitor", () => {
      const coreStep: MonitorStep = stepWith(busyOrIdle());
      const accessStep: MonitorStep = stepWith(busyOrIdle());
      const monitor: Monitor = monitorWith([coreStep, accessStep]);

      beforeAll(async (): Promise<void> => {
        keepRowsFor(null);
        await writeHistory({ monitor, step: coreStep, ports: CORE });
        await writeHistory({ monitor, step: accessStep, ports: ACCESS });
        await flush();
      });

      test("every row the writer wrote names its step and its interface", async () => {
        const rows: Array<JSONObject> = (
          (await (
            await client.query({
              query: `SELECT attributes FROM ${database}.MetricItemV3 WHERE primaryEntityId = {monitorId:String} AND name = {name:String}`,
              query_params: {
                monitorId: monitor.id!.toString(),
                name: MonitorMetricType.SnmpInterfaceUtilizationPercent,
              },
              format: "JSON",
            })
          ).json()) as { data: Array<JSONObject> }
        ).data;

        // Two weeks of twelve polls of two ports on each of two switches.
        expect(rows).toHaveLength(DAYS_OF_HISTORY * POLLS_AN_HOUR * 2 * 2);

        for (const row of rows) {
          const attributes: JSONObject = row["attributes"] as JSONObject;

          expect([coreStep.id.toString(), accessStep.id.toString()]).toContain(
            attributes[MONITOR_STEP_ID_ATTRIBUTE],
          );
          expect(["TenGigE0/1", "Gi0/2", "Fa0/1", "Fa0/2"]).toContain(
            attributes["interfaceName"],
          );
        }
      });

      test("the monitor's rollup mixes both switches: 75% and 8% are both inside it", async () => {
        const band: BaselineBand = bandOf(await rollupOf(monitor));

        expect(band.expectedLow).toBeLessThan(8);
        expect(band.expectedHigh).toBeGreaterThan(75);
      });

      test("75% on the access switch is anomalously high against its own history", async () => {
        const judged: Judged = await judge({
          monitor,
          step: accessStep,
          ports: [
            { name: "Fa0/1", utilizationPercent: 75 },
            { name: "Fa0/2", utilizationPercent: 2 },
          ],
        });

        expect(judged.criteriaMet).toBe("Busy");
        expect(messageOf(judged, "Busy")).toContain("75.00%");
      });

      test("the same 75% on the core switch is its ordinary level", async () => {
        const judged: Judged = await judge({
          monitor,
          step: coreStep,
          ports: [
            { name: "TenGigE0/1", alias: "Uplink", utilizationPercent: 75 },
            { name: "Gi0/2", utilizationPercent: 20 },
          ],
        });

        expect(judged.criteriaMet).toBeNull();
      });

      test("the core switch dropping to 8% is anomalously low against its own history", async () => {
        const judged: Judged = await judge({
          monitor,
          step: coreStep,
          ports: [
            { name: "TenGigE0/1", alias: "Uplink", utilizationPercent: 8 },
            { name: "Gi0/2", utilizationPercent: 7 },
          ],
        });

        expect(judged.criteriaMet).toBe("Idle");
        expect(messageOf(judged, "Idle")).toContain("below");
      });

      test("the access switch at its usual 5% raises nothing", async () => {
        const judged: Judged = await judge({
          monitor,
          step: accessStep,
          ports: [
            { name: "Fa0/1", utilizationPercent: 5 },
            { name: "Fa0/2", utilizationPercent: 2 },
          ],
        });

        expect(judged.criteriaMet).toBeNull();
      });

      test("each step's read holds a baseline for each of its own ports, and none of the other step's", async () => {
        at(JUDGED_AT);

        for (const [step, ports, otherPorts] of [
          [coreStep, CORE, ACCESS],
          [accessStep, ACCESS, CORE],
        ] as Array<[MonitorStep, Array<Port>, Array<Port>]>) {
          const baselines: MetricSeriesBaselines =
            await MetricBaselineService.getSeriesBaselines({
              projectId: monitor.projectId!.toString(),
              metricName: MonitorMetricType.SnmpInterfaceUtilizationPercent,
              primaryEntityId: monitor.id!.toString(),
              hourOfWeek: MetricBaselineServiceClass.computeHourOfWeek(
                new Date(JUDGED_AT),
              ),
              query: SnmpMonitorCriteria.getUtilizationBaselineQuery(
                MonitorStepSeries.getScope({
                  monitorStepId: step.id,
                  monitorSteps: monitor.monitorSteps,
                }),
              ),
            });

          expect(baselines.series.size).toBe(ports.length);
          expect(baselines.fallback).toBeNull();

          for (const own of ports) {
            const baseline: BaselineSummary | undefined = baselines.series.get(
              SnmpMonitorCriteria.getInterfaceSeriesFingerprint(own.name),
            );

            expect(baseline?.isReliable).toBe(true);
            expect(baseline?.mean).toBeCloseTo(own.level, 0);
          }

          for (const other of otherPorts) {
            expect(
              baselines.series.has(
                SnmpMonitorCriteria.getInterfaceSeriesFingerprint(other.name),
              ),
            ).toBe(false);
          }
        }
      });
    });

    describe("rows written before rows named their step", () => {
      test("a monitor with one step reads them as its own, and is judged across the upgrade", async () => {
        keepRowsFor(null);
        const step: MonitorStep = stepWith(busyOrIdle());
        const monitor: Monitor = monitorWith([step]);

        await writeHistory({
          monitor,
          step,
          ports: [{ name: "Gi0/1", level: 30, spread: 2 }],
          writtenBeforeRowsNamedTheirStep: true,
        });

        expect(
          (
            await judge({
              monitor,
              step,
              ports: [{ name: "Gi0/1", utilizationPercent: 90 }],
            })
          ).criteriaMet,
        ).toBe("Busy");

        expect(
          (
            await judge({
              monitor,
              step,
              ports: [{ name: "Gi0/1", utilizationPercent: 31 }],
            })
          ).criteriaMet,
        ).toBeNull();
      });

      test("a monitor with several leaves them out: it learns again, and raises nothing meanwhile", async () => {
        keepRowsFor(null);
        const first: MonitorStep = stepWith(busyOrIdle());
        const second: MonitorStep = stepWith(busyOrIdle());
        const monitor: Monitor = monitorWith([first, second]);

        await writeHistory({
          monitor,
          step: first,
          ports: [{ name: "Gi0/1", level: 30, spread: 2 }],
          writtenBeforeRowsNamedTheirStep: true,
        });

        const judged: Judged = await judge({
          monitor,
          step: first,
          ports: [{ name: "Gi0/1", utilizationPercent: 95 }],
        });

        expect(judged.criteriaMet).toBeNull();
        expect(messageOf(judged, "Busy")).not.toContain("95.00%");
      });

      test("one week of a step's own rows is not yet a baseline: it needs two", async () => {
        keepRowsFor(null);
        const first: MonitorStep = stepWith(busyOrIdle());
        const second: MonitorStep = stepWith(busyOrIdle());
        const monitor: Monitor = monitorWith([first, second]);

        await writeHistory({
          monitor,
          step: first,
          ports: [{ name: "Gi0/1", level: 30, spread: 2 }],
          days: [8, 9, 10, 11, 12, 13, 14],
          writtenBeforeRowsNamedTheirStep: true,
        });
        await writeHistory({
          monitor,
          step: first,
          ports: [{ name: "Gi0/1", level: 30, spread: 2 }],
          days: [1, 2, 3, 4, 5, 6, 7],
        });

        expect(
          (
            await judge({
              monitor,
              step: first,
              ports: [{ name: "Gi0/1", utilizationPercent: 95 }],
            })
          ).criteriaMet,
        ).toBeNull();
      });

      test("with two weeks of its own, a step is judged by them alone, whatever the rows without a step held", async () => {
        keepRowsFor(null);
        const first: MonitorStep = stepWith(busyOrIdle());
        const second: MonitorStep = stepWith(busyOrIdle());
        const monitor: Monitor = monitorWith([first, second]);

        // The other switch's polls from before the upgrade, busy around 80%.
        await writeHistory({
          monitor,
          step: second,
          ports: [{ name: "Gi0/1", level: 80, spread: 2 }],
          writtenBeforeRowsNamedTheirStep: true,
        });
        await writeHistory({
          monitor,
          step: first,
          ports: [{ name: "Gi0/1", level: 10, spread: 1 }],
        });

        expect(
          (
            await judge({
              monitor,
              step: first,
              ports: [{ name: "Gi0/1", utilizationPercent: 80 }],
            })
          ).criteriaMet,
        ).toBe("Busy");

        expect(
          (
            await judge({
              monitor,
              step: first,
              ports: [{ name: "Gi0/1", utilizationPercent: 10 }],
            })
          ).criteriaMet,
        ).toBeNull();
      });
    });

    describe("the interfaces a criteria names", () => {
      const step: MonitorStep = stepWith([
        criteria("Backup busy", [
          filter(FilterType.AnomalouslyHigh, "backup link"),
        ]),
        criteria("A port busy", [filter(FilterType.AnomalouslyHigh, "*")]),
      ]);
      // The other device has a Gi0/2 of its own, busy: never this step's.
      const otherStep: MonitorStep = stepWith(busyOrIdle());
      const monitor: Monitor = monitorWith([step, otherStep]);

      beforeAll(async (): Promise<void> => {
        keepRowsFor(null);
        await writeHistory({
          monitor,
          step,
          ports: [
            { name: "Gi0/1", level: 70, spread: 2 },
            { name: "Gi0/2", alias: "Backup link", level: 3, spread: 0.5 },
          ],
        });
        await writeHistory({
          monitor,
          step: otherStep,
          ports: [{ name: "Gi0/2", level: 50, spread: 2 }],
        });
        await flush();
      });

      test("a port named by its alias is judged against its own history, not the busier port beside it nor the other device's", async () => {
        const judged: Judged = await judge({
          monitor,
          step,
          ports: [
            { name: "Gi0/1", utilizationPercent: 72 },
            { name: "Gi0/2", alias: "Backup link", utilizationPercent: 40 },
          ],
        });

        expect(judged.criteriaMet).toBe("Backup busy");
        expect(messageOf(judged, "Backup busy")).toContain("40.00%");
      });

      test("the port at its usual level raises nothing", async () => {
        const judged: Judged = await judge({
          monitor,
          step,
          ports: [
            { name: "Gi0/1", utilizationPercent: 70 },
            { name: "Gi0/2", alias: "Backup link", utilizationPercent: 3 },
          ],
        });

        expect(judged.criteriaMet).toBeNull();
        expect(judged.perSeriesMatches).toHaveLength(0);
      });
    });

    describe("an Interface Name of * fans out: each port judged against its own history", () => {
      const step: MonitorStep = stepWith([
        criteria("A port busy", [filter(FilterType.AnomalouslyHigh, "*")]),
      ]);
      const monitor: Monitor = monitorWith([step, stepWith(busyOrIdle())]);

      beforeAll(async (): Promise<void> => {
        keepRowsFor(null);
        await writeHistory({
          monitor,
          step,
          ports: [
            { name: "Gi0/1", level: 70, spread: 2 },
            { name: "Gi0/2", alias: "Backup link", level: 3, spread: 0.5 },
          ],
        });
        await flush();
      });

      test("the quiet port at 40% raises its own alert, and the busy one at 72% none", async () => {
        const judged: Judged = await judge({
          monitor,
          step,
          ports: [
            { name: "Gi0/1", utilizationPercent: 72 },
            { name: "Gi0/2", alias: "Backup link", utilizationPercent: 40 },
          ],
        });

        expect(judged.criteriaMet).toBe("A port busy");
        expect(
          judged.perSeriesMatches.map(
            (match: PerSeriesCriteriaMatch): JSONObject => {
              return match.labels;
            },
          ),
        ).toEqual([{ interfaceName: "Gi0/2", interfaceAlias: "Backup link" }]);
      });

      test("both ports at their usual level raise nothing", async () => {
        const judged: Judged = await judge({
          monitor,
          step,
          ports: [
            { name: "Gi0/1", utilizationPercent: 71 },
            { name: "Gi0/2", alias: "Backup link", utilizationPercent: 3 },
          ],
        });

        expect(judged.criteriaMet).toBeNull();
        expect(judged.perSeriesMatches).toHaveLength(0);
      });
    });

    /*
     * Rows kept a week cannot hold the two weeks a baseline asks for. The
     * hourly rollup, kept 90 days, still can - and is the step's own only on
     * a monitor with one step.
     */
    describe("a monitor metric retention too short to hold two weeks", () => {
      test("a monitor with one step falls back on its rollup, as it was judged before", async () => {
        keepRowsFor(7);
        const step: MonitorStep = stepWith(busyOrIdle());
        const monitor: Monitor = monitorWith([step]);

        await writeHistory({
          monitor,
          step,
          ports: [{ name: "Gi0/1", level: 30, spread: 2 }],
        });

        expect(
          (
            await judge({
              monitor,
              step,
              ports: [{ name: "Gi0/1", utilizationPercent: 90 }],
            })
          ).criteriaMet,
        ).toBe("Busy");
      });

      test("a step of a monitor with several never reads the rollup its steps share: it keeps learning", async () => {
        keepRowsFor(7);
        const first: MonitorStep = stepWith(busyOrIdle());
        const second: MonitorStep = stepWith(busyOrIdle());
        const monitor: Monitor = monitorWith([first, second]);

        await writeHistory({
          monitor,
          step: first,
          ports: [{ name: "Gi0/1", level: 30, spread: 2 }],
        });

        expect(
          (
            await judge({
              monitor,
              step: first,
              ports: [{ name: "Gi0/1", utilizationPercent: 90 }],
            })
          ).criteriaMet,
        ).toBeNull();

        // Its rollup would have judged it: the rows were there, and left.
        expect((await rollupOf(monitor))?.isReliable).toBe(true);
      });
    });
  },
);
