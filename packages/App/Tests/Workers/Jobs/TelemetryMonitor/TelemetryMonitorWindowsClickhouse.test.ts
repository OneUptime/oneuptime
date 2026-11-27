import fs from "fs";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * EVERY LOG COUNTED ONCE, AGAINST A REAL CLICKHOUSE (issue #11248).
 *
 * A telemetry check judges the window that ends when it was due, however
 * late it runs, so a monitor's windows follow on from one another exactly
 * and every log its filters match is counted by exactly one check. Before,
 * a check that ran late judged the window ending when it ran: the logs
 * between the window before and its own were counted by no check, and those
 * its window shared with the next were counted twice.
 *
 * This runs it for real: 24 Logs monitors, each counting its own service's
 * logs over the last 60 seconds every minute, over a ClickHouse table that
 * holds four logs a second for each service, each at a time no window edge
 * can fall on. The real scheduler queues their checks every 10 seconds for
 * four minutes, and the real evaluation job counts each through LogService,
 * while its checks run late as a busy Telemetry queue makes them: some 2 to
 * 25 seconds late, some refused by the queue and queued by the next run,
 * some failing and tried again 5 seconds later (TelemetryQueueModel, with
 * BullMQ's deduplication and retries). Half the monitors' jobs carry when
 * the check was due; the other half are judged as every check was before,
 * the window ending when it ran. Then, from the logs' own times:
 *
 *   - with the due time carried, the windows follow on exactly, each count
 *     is exactly the logs in its window, and every log from the first
 *     window's start to the last's end is counted once;
 *   - judged as before, the same lateness leaves logs counted by no check
 *     and logs counted twice.
 *
 * Opt in by pointing TEST_CLICKHOUSE_URL at a disposable server (it runs
 * about five minutes of real time):
 *
 *   docker run -d --rm -p 18248:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18248 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/TelemetryMonitorWindowsClickhouse.test.ts
 *
 * TELEMETRY_WINDOWS_CLICKHOUSE_REPORT_FILE, when set, is where what it
 * counted is written as JSON.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
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

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return { __esModule: true, default: { monitorResource: jest.fn() } };
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
import LogService from "Common/Server/Services/LogService";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import TelemetryMonitorSchedule from "Common/Server/Utils/Monitor/TelemetryMonitorSchedule";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryIngestBacklog from "Common/Server/Utils/Telemetry/TelemetryIngestBacklog";
import { TelemetryMonitorEvaluationJobData } from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import TelemetryQueueService from "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/ScheduleTelemetryMonitorEvaluations";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  SchedulerRun,
  SpreadHarness,
  StoredMonitor,
} from "./MonitorTelemetryMonitorSpreadHarness";
import {
  JudgedWindow,
  TelemetryQueueModel,
  TilingReport,
  asQueued,
  tilingOf,
} from "./MonitorTelemetryMonitorWindowsHarness";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

jest.setTimeout(15 * 60 * 1000);

const database: string = `telemetry_windows_test_${process.pid}_${Date.now()}`;

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;

// Each service's logs: four a second, each 137 microseconds past a millisecond.
const LOG_EVERY_MS: number = 250;
const LOG_OFFSET_NS: bigint = BigInt(137000);

const MONITORS: number = 24;
const RUN_FOR_MS: number = 4 * MINUTE_MS;

const PROJECT_ID: ObjectID = new ObjectID(
  "11248000-0000-4000-8000-00000000c1c1",
);

const registration: Array<unknown> = (
  RunCron as unknown as jest.Mock
).mock.calls.find((call: Array<unknown>): boolean => {
  return call[0] === "TelemetryMonitor:MonitorTelemetryMonitor";
})!;

const runScheduler: SchedulerRun = registration[2] as SchedulerRun;

const enqueueJob: jest.Mock =
  TelemetryQueueService.addTelemetryMonitorEvaluationJob as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

const harness: SpreadHarness = new SpreadHarness({
  findBy: MonitorService.findBy as unknown as jest.Mock,
  query: mockQuery,
  enqueueJob,
  schedule: (registration[1] as { schedule: string }).schedule,
  runScheduler: runScheduler,
  projectId: PROJECT_ID,
});

// A window a check judged, and how many logs its count found in it.
interface CountedWindow extends JudgedWindow {
  logCount: number;
}

// When the logs were written: from this ms on, every LOG_EVERY_MS, to `logsTo`.
let logsFrom: number = 0;
let logsTo: number = 0;

// The logs of one service between two times, inclusive, from their own times.
function logsBetween(startMs: number, endMs: number): number {
  // A log at logsFrom + k * LOG_EVERY_MS + 0.137 ms: never on a window's edge.
  const first: number = Math.max(
    0,
    Math.ceil((startMs - logsFrom - 0.137) / LOG_EVERY_MS),
  );
  const last: number = Math.min(
    Math.floor((logsTo - logsFrom) / LOG_EVERY_MS),
    Math.floor((endMs - logsFrom - 0.137) / LOG_EVERY_MS),
  );

  return Math.max(0, last - first + 1);
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
}

// A log as ingest stores it, for a monitor's service, at a given nanosecond.
function logRow(serviceId: string, timeNs: bigint): JSONObject {
  const timeMs: number = Number(timeNs / BigInt(1000000));

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: serviceId,
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(
      new Date(timeMs),
      timeNs.toString(),
    ),
    timeUnixNano: timeNs.toString(),
    severityText: "Error",
    severityNumber: 17,
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    body: "payment failed",
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    ),
  };
}

function logStepFor(stored: StoredMonitor): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.setLogMonitor({
    ...MonitorStepLogMonitorUtil.getDefault(),
    lastXSecondsOfLogs: 60,
    telemetryServiceIds: [new ObjectID(stored.id)],
  });

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  return steps;
}

async function sleepUntil(atMs: number): Promise<void> {
  const waitMs: number = atMs - Date.now();

  if (waitMs > 0) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, waitMs);
    });
  }
}

function nextTick(afterMs: number): number {
  return (Math.floor(afterMs / (10 * SECOND_MS)) + 1) * 10 * SECOND_MS;
}

// What a group of monitors' checks counted, from the logs' own times.
interface GroupCounted {
  monitors: number;
  windows: number;
  tiling: TilingReport;
  // Counts that were not the logs in their window.
  wrongCounts: number;
  // From each monitor's first window's start to its last's end.
  logs: number;
  logsCounted: number;
  logsCountedByNoCheck: number;
  logsCountedTwice: number;
}

function countGroup(
  windows: Array<CountedWindow>,
  monitorIds: Set<string>,
): GroupCounted {
  const mine: Array<CountedWindow> = windows.filter(
    (window: CountedWindow) => {
      return monitorIds.has(window.monitorId);
    },
  );

  const counted: GroupCounted = {
    monitors: monitorIds.size,
    windows: mine.length,
    tiling: tilingOf(mine, {
      from: Number.NEGATIVE_INFINITY,
      to: Number.POSITIVE_INFINITY,
    }),
    wrongCounts: 0,
    logs: 0,
    logsCounted: 0,
    logsCountedByNoCheck: 0,
    logsCountedTwice: 0,
  };

  for (const monitorId of monitorIds) {
    const list: Array<CountedWindow> = mine
      .filter((window: CountedWindow) => {
        return window.monitorId === monitorId;
      })
      .sort((a: CountedWindow, b: CountedWindow): number => {
        return a.endsAt - b.endsAt;
      });

    if (list.length === 0) {
      continue;
    }

    counted.logs += logsBetween(list[0]!.startsAt, list[list.length - 1]!.endsAt);

    for (let index: number = 0; index < list.length; index++) {
      const window: CountedWindow = list[index]!;

      counted.logsCounted += window.logCount;

      if (window.logCount !== logsBetween(window.startsAt, window.endsAt)) {
        counted.wrongCounts++;
      }

      if (index === 0) {
        continue;
      }

      const before: CountedWindow = list[index - 1]!;

      if (window.startsAt > before.endsAt) {
        counted.logsCountedByNoCheck += logsBetween(
          before.endsAt,
          window.startsAt,
        );
      }

      if (window.startsAt < before.endsAt) {
        counted.logsCountedTwice += logsBetween(
          window.startsAt,
          before.endsAt,
        );
      }
    }
  }

  return counted;
}

integration(
  "#11248: every log counted once by a monitor's checks, against a real ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: Record<string, unknown> | undefined;

    const windows: Array<CountedWindow> = [];
    const failures: Array<unknown> = [];
    const carried: Set<string> = new Set<string>();
    const asBefore: Set<string> = new Set<string>();
    const measured: Record<string, unknown> = {};

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 120000,
        max_open_connections: 100,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      await createTable(client, clickhouse, Log);

      original = {
        database: LogService.database,
        databaseClient: LogService.databaseClient,
        ingestDatabase: LogService.ingestDatabase,
        ingestDatabaseClient: LogService.ingestDatabaseClient,
      };

      Object.assign(LogService, {
        database: clickhouse,
        databaseClient: client,
        ingestDatabase: clickhouse,
        ingestDatabaseClient: client,
      });

      // Every minute, no interval: the Dashboard's monitors.
      harness.seed([
        { monitoringInterval: undefined, intervalMs: MINUTE_MS, count: MONITORS },
      ]);
      harness.serveFromTheStore();
      harness.applyStatementsToTheStore();

      harness.sortedIds.forEach((id: string, index: number) => {
        (index % 2 === 0 ? carried : asBefore).add(id);
      });

      // Four logs a second for each service, from 3 minutes ago to past the run.
      logsFrom = Math.floor((Date.now() - 3 * MINUTE_MS) / 1000) * 1000;
      logsTo = Date.now() + RUN_FOR_MS + 3 * MINUTE_MS;

      let batch: Array<JSONObject> = [];

      for (const id of harness.sortedIds) {
        for (let at: number = logsFrom; at <= logsTo; at += LOG_EVERY_MS) {
          batch.push(
            logRow(id, BigInt(at) * BigInt(1000000) + LOG_OFFSET_NS),
          );

          if (batch.length >= 50000) {
            await client.insert({
              table: `${database}.${new Log().tableName}`,
              format: "JSONEachRow",
              values: batch,
            });
            batch = [];
          }
        }
      }

      if (batch.length > 0) {
        await client.insert({
          table: `${database}.${new Log().tableName}`,
          format: "JSONEachRow",
          values: batch,
        });
      }

      (MonitorService.findOneById as unknown as jest.Mock).mockImplementation(
        async (args: { id: ObjectID }): Promise<Monitor> => {
          const stored: StoredMonitor = harness.store.get(args.id.toString())!;
          const monitor: Monitor = new Monitor(new ObjectID(stored.id));
          monitor.projectId = PROJECT_ID;
          monitor.monitorType = MonitorType.Logs;
          monitor.monitorSteps = logStepFor(stored);
          return monitor;
        },
      );

      monitorResource.mockImplementation(
        async (
          response: { monitorId: ObjectID; logCount: number },
          options: { judgedWindow: { startsAt: Date; endsAt: Date } },
        ): Promise<null> => {
          windows.push({
            monitorId: response.monitorId.toString(),
            startsAt: options.judgedWindow.startsAt.getTime(),
            endsAt: options.judgedWindow.endsAt.getTime(),
            ranAt: Date.now(),
            dueAt: null,
            logCount: response.logCount,
          });
          return null;
        },
      );

      // No receiving ledger and no ingest queue: OneUptime kept up throughout.
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);
      jest
        .spyOn(TelemetryIngestBacklog, "getOldestWaitingSince")
        .mockResolvedValue(null);
      ReceivingCoverage.clearCache();
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();

      if (original) {
        Object.assign(LogService, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }

      const reportFile: string | undefined =
        process.env["TELEMETRY_WINDOWS_CLICKHOUSE_REPORT_FILE"];

      if (reportFile) {
        fs.writeFileSync(reportFile, JSON.stringify(measured, null, 2));
      }
    });

    test("with the due time carried every log is counted once, through late, refused and retried checks; judged as before, some by no check and some twice", async () => {
      const random: SeededRandom = seededRandom(11248);
      const lateBy: Map<string, number> = new Map();
      let late: number = 0;
      let refused: number = 0;
      const refusedLastTime: Set<string> = new Set<string>();

      // Each check's lateness, drawn once per job: a retry waits as long again.
      const latenessOf: (data: TelemetryMonitorEvaluationJobData) => number = (
        data: TelemetryMonitorEvaluationJobData,
      ): number => {
        const key: string = `${data.monitorId}@${String(data.dueAt)}`;

        if (!lateBy.has(key)) {
          const draw: number = random(10);
          // Three checks in ten wait 2 to 25 seconds for a worker.
          lateBy.set(key, draw < 3 ? 2 * SECOND_MS + random(23000) : 0);
        }

        return lateBy.get(key)!;
      };

      const queue: TelemetryQueueModel = new TelemetryQueueModel(
        {
          workers: 100,
          holdMs: (): number => {
            return 0;
          },
          // One check in eight fails its first try and is tried again 5 s on.
          fails: (_monitorId: string, attempt: number): boolean => {
            return attempt === 1 && random(8) === 0;
          },
          dataForEvaluation: (
            data: TelemetryMonitorEvaluationJobData,
          ): TelemetryMonitorEvaluationJobData => {
            return asBefore.has(data.monitorId)
              ? ({
                  monitorId: data.monitorId,
                  projectId: data.projectId,
                } as TelemetryMonitorEvaluationJobData)
              : data;
          },
        },
        async (
          data: TelemetryMonitorEvaluationJobData,
          queued: TelemetryMonitorEvaluationJobData,
        ): Promise<void> => {
          const waitMs: number = latenessOf(queued);

          if (waitMs > 0) {
            late++;
            await new Promise<void>((resolve: () => void) => {
              setTimeout(resolve, waitMs);
            });
          }

          try {
            await processTelemetryMonitorEvaluationFromQueue(data);
          } catch (error) {
            failures.push(error);
            throw error;
          }
        },
      );

      enqueueJob.mockImplementation(
        async (job: {
          monitorId: ObjectID;
          projectId?: ObjectID | undefined;
          dueAt?: Date | undefined;
        }): Promise<void> => {
          const id: string = job.monitorId.toString();

          // One job in ten refused; the next run queues it, 10 s on.
          if (!refusedLastTime.delete(id) && random(10) === 0) {
            refusedLastTime.add(id);
            refused++;
            throw new Error("the queue refused the job");
          }

          queue.addCheck(asQueued(job));
        },
      );

      // Each monitor next due at its own moment, from the next tick on.
      const startAt: number = nextTick(Date.now() + 2 * SECOND_MS);

      for (const id of harness.sortedIds) {
        harness.store.get(id)!.nextMonitorAt =
          TelemetryMonitorSchedule.getNextRunAt({
            monitorId: id,
            monitoringInterval: undefined,
            after: new Date(startAt),
          });
      }

      for (
        let tick: number = startAt;
        tick < startAt + RUN_FOR_MS;
        tick += 10 * SECOND_MS
      ) {
        await sleepUntil(tick + 5);
        await runScheduler();
      }

      // What is still waiting, running or waiting out a retry finishes.
      for (let wait: number = 0; wait < 120 && !queue.isIdle(); wait++) {
        await sleepUntil(Date.now() + SECOND_MS);
      }

      expect(queue.isIdle()).toBe(true);
      expect(failures).toEqual([]);

      const withDueAt: GroupCounted = countGroup(windows, carried);
      const judgedAsBefore: GroupCounted = countGroup(windows, asBefore);

      measured["late"] = late;
      measured["refused"] = refused;
      measured["retried"] = queue.counts.retried;
      measured["withDueAt"] = withDueAt;
      measured["judgedAsBefore"] = judgedAsBefore;

      // The checks did run late, were refused and were tried again.
      expect(late).toBeGreaterThan(10);
      expect(refused).toBeGreaterThan(3);
      expect(queue.counts.retried).toBeGreaterThan(3);
      expect(queue.counts.droppedWhileWaiting).toBe(0);

      // Four minutes, a check a minute each: at least three windows a monitor.
      expect(withDueAt.windows).toBeGreaterThanOrEqual(3 * withDueAt.monitors);
      expect(judgedAsBefore.windows).toBeGreaterThanOrEqual(
        3 * judgedAsBefore.monitors,
      );

      // ClickHouse counted exactly the logs in each window, in both halves.
      expect(withDueAt.wrongCounts).toBe(0);
      expect(judgedAsBefore.wrongCounts).toBe(0);

      // Carried: the windows follow on, and every log is counted once.
      expect(withDueAt.tiling).toMatchObject({
        breaks: 0,
        gapMs: 0,
        overlapMs: 0,
      });
      expect(withDueAt.logsCountedByNoCheck).toBe(0);
      expect(withDueAt.logsCountedTwice).toBe(0);
      expect(withDueAt.logsCounted).toBe(withDueAt.logs);

      // As before: the same lateness, logs counted by no check and twice.
      expect(judgedAsBefore.tiling.breaks).toBeGreaterThan(0);
      expect(judgedAsBefore.logsCountedByNoCheck).toBeGreaterThan(0);
      expect(judgedAsBefore.logsCountedTwice).toBeGreaterThan(0);
      expect(judgedAsBefore.logsCounted).not.toBe(judgedAsBefore.logs);
    });
  },
);
