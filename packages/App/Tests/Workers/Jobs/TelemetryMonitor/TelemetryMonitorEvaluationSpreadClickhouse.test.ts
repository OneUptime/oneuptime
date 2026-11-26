import fs from "fs";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import MetricItemAggMV1mByHostV2 from "Common/Models/AnalyticsModels/MetricItemAggMV1mByHostV2";
import MetricItemAggMV1mByK8sCluster from "Common/Models/AnalyticsModels/MetricItemAggMV1mByK8sCluster";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { getDockerAlertTemplateById } from "Common/Types/Monitor/DockerAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * THE SPIKE OF #11060, AGAINST A REAL CLICKHOUSE.
 *
 * A self-hosted install saw 94% of a minute's MetricItemV3 reads start in
 * its first 10 seconds and ClickHouse above 1,000% CPU while they ran: its
 * scheduler queued every telemetry monitor's evaluation at the start of the
 * minute, and the workers ran them all at once. This reproduces it with a
 * few hundred Docker monitors made from the real alert templates (high CPU,
 * high memory, restart loop, PIDs, container down, host stopped reporting),
 * over a fleet of hosts writing container metrics as the Docker agent does.
 *
 * Each evaluation is the real one - processTelemetryMonitorEvaluationFromQueue
 * reading ClickHouse through MetricService - run by a pool of 100 workers,
 * the Telemetry queue's default (TELEMETRY_CONCURRENCY), with 100 ClickHouse
 * connections, the app's default. Only what is not ClickHouse is held still:
 * the monitors are in memory (MonitorTelemetryMonitorSpreadHarness), and the
 * metric catalog, the resource binding, the receiving ledger and what an
 * evaluation then writes (MonitorResource) are stubbed. Two minutes are
 * measured from ClickHouse's own logs (system.query_log, system.metric_log):
 *
 *   - THE OLD MINUTE: every monitor due at the same instant, as the
 *     scheduler before #11060 stamped them every minute, queued by one run.
 *   - A MINUTE OF THIS RELEASE: every monitor at its own moment of the
 *     minute (TelemetryMonitorSchedule), queued by the runs every 10 seconds.
 *
 * Both run every monitor's evaluation exactly once. The old minute starts
 * its reads together - most in its first second, tens of them running at
 * once, ClickHouse's CPU at its peak - and this release's starts them
 * spread over the minute: a few at a time, and a fraction of the peak CPU
 * for the same work.
 *
 * Opt in by pointing TEST_CLICKHOUSE_URL at a disposable server (it runs
 * two minutes of real time):
 *
 *   docker run -d --rm --cpus=4 -p 18611:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18611 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/TelemetryMonitorEvaluationSpreadClickhouse.test.ts
 *
 * TELEMETRY_SPREAD_REPORT_FILE, when set, is where the measurements are
 * written as JSON.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
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

const mockQuery: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneById: jest.fn(),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
      getRepository: jest.fn(() => {
        return { manager: { query: mockQuery } };
      }),
    },
  };
});

jest.mock(
  "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: { addTelemetryMonitorEvaluationJob: jest.fn() },
    };
  },
);

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

import MonitorService from "Common/Server/Services/MonitorService";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import InfrastructureResourceBinding from "Common/Server/Utils/Monitor/InfrastructureResourceBinding";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import TelemetryMonitorSchedule from "Common/Server/Utils/Monitor/TelemetryMonitorSchedule";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryQueueService from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/ScheduleTelemetryMonitorEvaluations";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  SchedulerRun,
  SpreadHarness,
} from "./MonitorTelemetryMonitorSpreadHarness";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

jest.setTimeout(10 * 60 * 1000);

const database: string = `telemetry_spread_test_${process.pid}_${Date.now()}`;

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;

// The fleet that writes metrics, and the hosts monitors watch.
const HOSTS: number = Number(process.env["SPREAD_TEST_HOSTS"] || 400);
const CONTAINERS_PER_HOST: number = 25;
const MONITORED_HOSTS: number = 50;
const SAMPLE_EVERY_MS: number = 30 * SECOND_MS;

// What the Telemetry queue's workers and the app's ClickHouse pool allow.
const WORKER_CONCURRENCY: number = 100;
const CLICKHOUSE_CONNECTIONS: number = 100;

const TEMPLATES: Array<string> = [
  "docker-high-cpu",
  "docker-high-memory",
  "docker-restart-loop",
  "docker-high-pids",
  "docker-container-down",
  "docker-host-stopped-reporting",
];

// Every metric the templates read.
const METRICS: Array<string> = [
  "container.cpu.utilization",
  "container.memory.percent",
  "container.restarts.increase",
  "container.pids.count",
  "container.uptime",
  "container.cpu.throttling_data.throttled_time",
];

const PROJECT_ID: ObjectID = new ObjectID(
  "11060000-0000-4000-8000-00000000c1c1",
);

const registration: Array<unknown> = (
  RunCron as unknown as jest.Mock
).mock.calls.find((call: Array<unknown>): boolean => {
  return call[0] === "TelemetryMonitor:MonitorTelemetryMonitor";
})!;

const runScheduler: SchedulerRun = registration[2] as SchedulerRun;

const harness: SpreadHarness = new SpreadHarness({
  findBy: MonitorService.findBy as unknown as jest.Mock,
  query: mockQuery,
  enqueueJob:
    TelemetryQueueService.addTelemetryMonitorEvaluationJob as unknown as jest.Mock,
  schedule: (registration[1] as { schedule: string }).schedule,
  runScheduler: runScheduler,
  projectId: PROJECT_ID,
});

// Each monitor's steps, by id: what the evaluation job reads.
const stepsOf: Map<string, MonitorSteps> = new Map();

function hostName(host: number): string {
  return `docker-host-${String(host).padStart(3, "0")}`;
}

function hostServiceId(host: number): string {
  return `11060000-0000-4000-8001-${String(host).padStart(12, "0")}`;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });

  for (const view of model.materializedViews || []) {
    await client.command({ query: view.query });
  }
}

// A sample as the Docker agent's collector writes it, as ingest stores it.
function sampleRow(data: {
  host: number;
  container: number;
  metric: string;
  time: number;
  value: number;
}): JSONObject {
  const time: Date = new Date(data.time);
  const attributes: JSONObject = {
    "resource.host.name": hostName(data.host),
    "resource.container.runtime": "docker",
    "resource.container.name": `${hostName(data.host)}-app-${data.container}`,
    "resource.container.image.name": `registry.example/app-${data.container % 7}:1.4.${data.container % 3}`,
    "resource.container.id": `${data.host.toString(16).padStart(6, "0")}${data.container.toString(16).padStart(6, "0")}`,
  };

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: hostServiceId(data.host),
    primaryEntityType: "Service",
    name: data.metric,
    aggregationTemporality: "Delta",
    metricPointType: "Gauge",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + data.container),
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    entityKeys: [],
    hostEntityKey: keyForHost(PROJECT_ID.toString(), hostName(data.host)),
    value: data.value,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    ),
  };
}

// One read ClickHouse ran, from its query log.
interface LoggedQuery {
  startMs: number;
  endMs: number;
  cpuMicroseconds: number;
  readRows: number;
}

// What a minute measured.
interface MinuteMeasured {
  evaluations: number;
  reads: number;
  readsInTheFirstTenSeconds: number;
  shareInTheFirstTenSeconds: number;
  mostReadsRunningAtOnce: number;
  // ClickHouse's CPU across the minute's reads, in core-seconds.
  cpuSeconds: number;
  // The busiest second's CPU, as a percentage of one core (docker stats).
  peakCpuPercent: number;
  // The server's own busiest second, from system.metric_log.
  serverPeakCpuPercent: number;
  // The most queries running at a second's sample, from system.metric_log.
  serverMostQueriesRunning: number;
  readRows: number;
}

function mostAtOnce(queries: Array<LoggedQuery>): number {
  const edges: Array<[number, number]> = [];

  for (const query of queries) {
    edges.push([query.startMs, 1]);
    edges.push([Math.max(query.endMs, query.startMs + 0.001), -1]);
  }

  edges.sort((a: [number, number], b: [number, number]): number => {
    return a[0] - b[0] || a[1] - b[1];
  });

  let running: number = 0;
  let most: number = 0;

  for (const [, change] of edges) {
    running += change;
    most = Math.max(most, running);
  }

  return most;
}

// Each read's CPU, shared evenly over the seconds it ran: the busiest second.
function peakCpuPercentOf(queries: Array<LoggedQuery>): number {
  const perSecond: Map<number, number> = new Map();

  for (const query of queries) {
    const durationMs: number = Math.max(1, query.endMs - query.startMs);

    for (
      let second: number = Math.floor(query.startMs / SECOND_MS);
      second <= Math.floor(query.endMs / SECOND_MS);
      second++
    ) {
      const overlapMs: number =
        Math.min(query.endMs, (second + 1) * SECOND_MS) -
        Math.max(query.startMs, second * SECOND_MS);

      if (overlapMs > 0) {
        perSecond.set(
          second,
          (perSecond.get(second) || 0) +
            (query.cpuMicroseconds * overlapMs) / durationMs,
        );
      }
    }
  }

  // Microseconds of CPU in a second, as a percentage of one core.
  return Math.max(0, ...perSecond.values()) / 10000;
}

integration(
  "#11060: telemetry monitor evaluations against a real ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: Record<string, unknown> | undefined;

    // The evaluations the workers ran, and those that failed.
    const evaluated: Array<{ id: string; startedAt: number }> = [];
    const failures: Array<unknown> = [];
    const measured: Record<string, MinuteMeasured> = {};
    // A pool of workers, as the Telemetry queue's: FIFO, WORKER_CONCURRENCY at once.
    const waiting: Array<string> = [];
    const pool: { active: number; onIdle: (() => void) | null } = {
      active: 0,
      onIdle: null,
    };

    const pump: () => void = (): void => {
      while (pool.active < WORKER_CONCURRENCY && waiting.length > 0) {
        evaluateNext(waiting.shift()!);
      }
    };

    const evaluateNext: (id: string) => void = (id: string): void => {
      pool.active++;
      evaluated.push({ id, startedAt: Date.now() });

      processTelemetryMonitorEvaluationFromQueue({
        monitorId: id,
        projectId: PROJECT_ID.toString(),
        queuedAt: new Date(),
      })
        .catch((error: unknown) => {
          failures.push(error);
        })
        .finally(() => {
          pool.active--;
          pump();

          if (pool.active === 0 && waiting.length === 0 && pool.onIdle) {
            pool.onIdle();
          }
        });
    };

    const workersIdle: () => Promise<void> = (): Promise<void> => {
      if (pool.active === 0 && waiting.length === 0) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve: () => void) => {
        pool.onIdle = (): void => {
          pool.onIdle = null;
          resolve();
        };
      });
    };

    const sleepUntil: (atMs: number) => Promise<void> = async (
      atMs: number,
    ): Promise<void> => {
      const waitMs: number = atMs - Date.now();

      if (waitMs > 0) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, waitMs);
        });
      }
    };

    const nextTick: (afterMs: number) => number = (afterMs: number): number => {
      return (Math.floor(afterMs / (10 * SECOND_MS)) + 1) * 10 * SECOND_MS;
    };

    // What ClickHouse logged of the reads that started in [from, to).
    const measure: (data: {
      from: number;
      to: number;
      evaluations: number;
    }) => Promise<MinuteMeasured> = async (data: {
      from: number;
      to: number;
      evaluations: number;
    }): Promise<MinuteMeasured> => {
      await client.command({ query: "SYSTEM FLUSH LOGS" });

      const rows: Array<{
        startMicroseconds: string;
        durationMs: string;
        cpuMicroseconds: string;
        readRows: string;
      }> = await (
        await client.query({
          query: `SELECT toUnixTimestamp64Micro(query_start_time_microseconds) AS startMicroseconds, query_duration_ms AS durationMs, ProfileEvents['OSCPUVirtualTimeMicroseconds'] AS cpuMicroseconds, read_rows AS readRows FROM system.query_log WHERE type = 'QueryFinish' AND query_kind = 'Select' AND has(databases, {database:String}) AND event_time >= now() - INTERVAL 30 MINUTE AND query_start_time_microseconds >= fromUnixTimestamp64Milli({from:Int64}) AND query_start_time_microseconds < fromUnixTimestamp64Milli({to:Int64})`,
          query_params: { database, from: data.from, to: data.to },
          format: "JSONEachRow",
        })
      ).json();

      const queries: Array<LoggedQuery> = rows.map(
        (row: {
          startMicroseconds: string;
          durationMs: string;
          cpuMicroseconds: string;
          readRows: string;
        }): LoggedQuery => {
          const startMs: number = Number(row.startMicroseconds) / 1000;
          return {
            startMs: startMs,
            endMs: startMs + Number(row.durationMs),
            cpuMicroseconds: Number(row.cpuMicroseconds),
            readRows: Number(row.readRows),
          };
        },
      );

      const server: Array<{ cpuMicroseconds: string; queries: string }> =
        await (
          await client.query({
            query: `SELECT ProfileEvent_OSCPUVirtualTimeMicroseconds AS cpuMicroseconds, CurrentMetric_Query AS queries FROM system.metric_log WHERE event_time_microseconds >= fromUnixTimestamp64Milli({from:Int64}) AND event_time_microseconds < fromUnixTimestamp64Milli({to:Int64})`,
            query_params: { from: data.from, to: data.to + 5 * SECOND_MS },
            format: "JSONEachRow",
          })
        ).json();

      const inFirstTen: number = queries.filter((query: LoggedQuery) => {
        return query.startMs < data.from + 10 * SECOND_MS;
      }).length;

      return {
        evaluations: data.evaluations,
        reads: queries.length,
        readsInTheFirstTenSeconds: inFirstTen,
        shareInTheFirstTenSeconds:
          queries.length === 0 ? 0 : inFirstTen / queries.length,
        mostReadsRunningAtOnce: mostAtOnce(queries),
        cpuSeconds:
          queries.reduce((sum: number, query: LoggedQuery): number => {
            return sum + query.cpuMicroseconds;
          }, 0) / 1000000,
        peakCpuPercent: peakCpuPercentOf(queries),
        serverPeakCpuPercent:
          Math.max(
            0,
            ...server.map((row: { cpuMicroseconds: string }): number => {
              return Number(row.cpuMicroseconds);
            }),
          ) / 10000,
        serverMostQueriesRunning: Math.max(
          0,
          ...server.map((row: { queries: string }): number => {
            return Number(row.queries);
          }),
        ),
        readRows: queries.reduce((sum: number, query: LoggedQuery): number => {
          return sum + query.readRows;
        }, 0),
      };
    };

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      // Connecting creates the database.
      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 120000,
        max_open_connections: CLICKHOUSE_CONNECTIONS,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      for (const model of [
        Metric,
        MetricItemAggMV1m,
        MetricItemAggMV1mByHostV2,
        MetricItemAggMV1mByK8sCluster,
      ]) {
        await createTable(client, clickhouse, model);
      }

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

      /*
       * The fleet's samples, every 30 seconds, from 8 minutes ago until after
       * the test: every window an evaluation reads is full.
       */
      const from: number =
        Math.floor((Date.now() - 8 * MINUTE_MS) / SAMPLE_EVERY_MS) *
        SAMPLE_EVERY_MS;
      const to: number = Date.now() + 8 * MINUTE_MS;
      let batch: Array<JSONObject> = [];

      const flush: () => Promise<void> = async (): Promise<void> => {
        if (batch.length === 0) {
          return;
        }

        await client.insert({
          table: `${database}.${new Metric().tableName}`,
          format: "JSONEachRow",
          values: batch,
        });
        batch = [];
      };

      for (let time: number = from; time <= to; time += SAMPLE_EVERY_MS) {
        for (let host: number = 0; host < HOSTS; host++) {
          for (
            let container: number = 0;
            container < CONTAINERS_PER_HOST;
            container++
          ) {
            for (const metric of METRICS) {
              batch.push(
                sampleRow({
                  host,
                  container,
                  metric,
                  time,
                  value: ((host * 31 + container * 7 + time / 1000) % 70) + 5,
                }),
              );
            }
          }
        }

        if (batch.length >= 100000) {
          await flush();
        }
      }

      await flush();
      await client.command({
        query: `OPTIMIZE TABLE ${database}.${new Metric().tableName} FINAL`,
      });

      // The monitors: each template, on each monitored host.
      const steps: Array<MonitorStep> = [];

      for (let host: number = 0; host < MONITORED_HOSTS; host++) {
        for (const templateId of TEMPLATES) {
          steps.push(
            getDockerAlertTemplateById(templateId)!.getMonitorStep({
              hostIdentifier: hostName(host),
              onlineMonitorStatusId: ObjectID.generate(),
              offlineMonitorStatusId: ObjectID.generate(),
              defaultIncidentSeverityId: ObjectID.generate(),
              defaultAlertSeverityId: ObjectID.generate(),
              monitorName: `${hostName(host)} - ${templateId}`,
            }),
          );
        }
      }

      // Made in the Dashboard: no interval, so every minute.
      harness.seed([
        {
          monitoringInterval: undefined,
          intervalMs: MINUTE_MS,
          count: steps.length,
        },
      ]);
      harness.serveFromTheStore();
      harness.applyStatementsToTheStore();
      harness.recordDispatches({
        onQueued: (monitorId: string): void => {
          waiting.push(monitorId);
          pump();
        },
      });

      harness.sortedIds.forEach((id: string, index: number) => {
        const monitorSteps: MonitorSteps = new MonitorSteps();
        monitorSteps.data = {
          monitorStepsInstanceArray: [steps[index]!],
          defaultMonitorStatusId: undefined,
        };
        stepsOf.set(id, monitorSteps);
      });

      (MonitorService.findOneById as unknown as jest.Mock).mockImplementation(
        async (args: { id: ObjectID }): Promise<Monitor> => {
          const monitor: Monitor = new Monitor(args.id);
          monitor.projectId = PROJECT_ID;
          monitor.monitorType = MonitorType.Docker;
          monitor.monitorSteps = stepsOf.get(args.id.toString())!;
          return monitor;
        },
      );

      // Not ClickHouse: the catalog, the binding, the ledger, and the writes.
      jest.spyOn(MetricTypeService, "findBy").mockResolvedValue([]);
      jest
        .spyOn(InfrastructureResourceBinding, "resolveForEvaluation")
        .mockImplementation(async (data: { monitorStep: MonitorStep }) => {
          return data.monitorStep;
        });
      jest
        .spyOn(ReceivingCoverage, "planTelemetryEvaluation")
        .mockImplementation(async () => {
          return {
            evaluate: true,
            evaluateUntil: new Date(),
            isIngestBehind: false,
          };
        });
      jest
        .spyOn(MonitorResourceUtil, "monitorResource")
        .mockResolvedValue(null as never);
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();

      if (original) {
        Object.assign(MetricService, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }

      const reportFile: string | undefined =
        process.env["TELEMETRY_SPREAD_REPORT_FILE"];

      if (reportFile) {
        fs.writeFileSync(
          reportFile,
          JSON.stringify(
            {
              hosts: HOSTS,
              containersPerHost: CONTAINERS_PER_HOST,
              monitors: harness.sortedIds.length,
              measured,
            },
            null,
            2,
          ),
        );
      }
    });

    test("the old minute - every evaluation due at once - starts its reads together; this release's minute starts them spread, a few at a time, for a fraction of the peak CPU", async () => {
      const monitors: number = harness.sortedIds.length;

      expect(monitors).toBe(MONITORED_HOSTS * TEMPLATES.length);

      /*
       * THE OLD MINUTE. Every monitor due at the same instant, as the
       * scheduler before #11060 stamped them each minute, and queued by the
       * one run that finds them due; the next runs find none.
       */
      const burstAt: number = nextTick(Date.now() + 2 * SECOND_MS);

      for (const id of harness.sortedIds) {
        harness.store.get(id)!.nextMonitorAt = new Date(burstAt);
      }

      await sleepUntil(burstAt + 5);
      await runScheduler();
      await workersIdle();

      expect(failures).toEqual([]);
      expect(evaluated).toHaveLength(monitors);

      await sleepUntil(burstAt + MINUTE_MS);

      measured["oldMinute"] = await measure({
        from: burstAt,
        to: burstAt + MINUTE_MS,
        evaluations: evaluated.length,
      });

      /*
       * A MINUTE OF THIS RELEASE. Each monitor at its own moment of the
       * minute, as this scheduler stamps it, and queued by the runs every 10
       * seconds as each moment comes.
       */
      const spreadFrom: number = nextTick(Date.now() + 2 * SECOND_MS);

      for (const id of harness.sortedIds) {
        harness.store.get(id)!.nextMonitorAt =
          TelemetryMonitorSchedule.getNextRunAt({
            monitorId: id,
            monitoringInterval: undefined,
            after: new Date(spreadFrom - 1),
          });
      }

      evaluated.length = 0;

      for (
        let tick: number = spreadFrom;
        tick < spreadFrom + MINUTE_MS;
        tick += 10 * SECOND_MS
      ) {
        await sleepUntil(tick + 5);
        await runScheduler();
      }

      /*
       * The minute's last half second is queued by the next run as it starts.
       * The monitors queued already are next due in the minute after, which
       * is not measured: they wait.
       */
      for (const id of harness.sortedIds) {
        const stored: { nextMonitorAt: Date | null } = harness.store.get(id)!;

        if (stored.nextMonitorAt!.getTime() >= spreadFrom + MINUTE_MS) {
          stored.nextMonitorAt = new Date(Date.now() + 60 * MINUTE_MS);
        }
      }

      await sleepUntil(spreadFrom + MINUTE_MS + 5);
      await runScheduler();
      await workersIdle();

      expect(failures).toEqual([]);
      expect(evaluated).toHaveLength(monitors);

      measured["newMinute"] = await measure({
        from: spreadFrom,
        to: spreadFrom + MINUTE_MS + SECOND_MS,
        evaluations: evaluated.length,
      });

      const oldMinute: MinuteMeasured = measured["oldMinute"]!;
      const newMinute: MinuteMeasured = measured["newMinute"]!;

      /*
       * The same evaluations, the same reads - within a read or two that one
       * evaluation makes only for some of what it finds: only when they
       * start differs.
       */
      expect(oldMinute.reads).toBeGreaterThanOrEqual(monitors);
      expect(Math.abs(newMinute.reads - oldMinute.reads)).toBeLessThanOrEqual(
        Math.ceil(oldMinute.reads * 0.02),
      );

      // The old minute: nearly every read in its first 10 seconds, as #11060 measured.
      expect(oldMinute.shareInTheFirstTenSeconds).toBeGreaterThan(0.9);
      expect(oldMinute.mostReadsRunningAtOnce).toBeGreaterThanOrEqual(20);

      // This release: spread over the minute, a few at a time.
      expect(newMinute.shareInTheFirstTenSeconds).toBeLessThan(0.35);
      expect(newMinute.mostReadsRunningAtOnce).toBeLessThanOrEqual(
        oldMinute.mostReadsRunningAtOnce / 4,
      );

      // The same work, its busiest second a fraction of the old one's.
      expect(newMinute.peakCpuPercent).toBeLessThan(
        oldMinute.peakCpuPercent / 3,
      );
    });
  },
);
