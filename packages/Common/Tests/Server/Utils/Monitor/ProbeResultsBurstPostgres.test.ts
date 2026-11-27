/*
 * HOW BURSTY PROBE RESULTS ARE WHERE THEY ARE EVALUATED (OneUptime issue
 * #11247).
 *
 * #11060 found every telemetry monitor's evaluation queued at the same
 * instant - the start of the minute - and the telemetry store read by all of
 * them at once. #11247 asked whether probe-checked monitors (Website, API,
 * Ping, Port, SSL, DNS ...) do the same to the server: each claimed monitor
 * probe's nextPingAt is its cron's next run, a whole minute, so every
 * monitor on "* * * * *" is due at :00 together. This measures it where
 * the results land, with a few hundred monitors:
 *
 *   - The probes, as packages/Probe/Jobs/Monitor/FetchList.ts runs them (and
 *     App/Tests/Telemetry/ProbeDispatch/ProbeDispatchProbes.ts mirrors): at
 *     every minute each worker of each replica waits a random 0 to 45
 *     seconds (MONITOR_FETCH_STAGGER_MAX_MS), then claims as many due
 *     monitors as it has room for (MonitorCheckSlots: workers x fetch
 *     limit), through the real claim on Postgres
 *     (MonitorProbeService.claimMonitorProbesForProbing), checks each (100 to
 *     900 ms, as a website answers) and claims again while it is handed a
 *     full batch.
 *   - Each result goes to the Telemetry queue as a probe-ingest job, and the
 *     queue's workers (TELEMETRY_CONCURRENCY, 100) run the real
 *     MonitorResourceUtil.monitorResource on it, against the same Postgres.
 *     Stubbed, as MonitorResultStatementsPostgres.test.ts stubs them: the
 *     per-monitor lock and the caches (Redis, kept in memory), the
 *     ClickHouse writers, and the criteria (a healthy verdict).
 *
 * Three runs of three minutes, each over 300 Ping monitors checked every
 * minute from two probes (600 checks a minute):
 *
 *   - TODAY: every monitor due at the whole minute, the probes' defaults (one
 *     worker of 10 checks a replica).
 *   - THE WORST OF TODAY: the same, with three workers a replica and no
 *     stagger - every worker of both probes asking at :00, 30 checks at once
 *     each - which no probe does (it always staggers), as a bound.
 *   - EACH MONITOR AT ITS OWN MOMENT: what #11247 proposed, every claimed row
 *     stamped with TelemetryMonitorSchedule.getNextRunAt instead of the
 *     cron's whole minute, the probes' defaults.
 *
 * Measured on the development machine (2026-11-27, Postgres 15 in Docker):
 * the burst does not reach the server. A probe worker checks at most its
 * check slots at once and starts at its own random second, so results
 * arrive at a few dozen a second at most - whatever the stamps say - and
 * the queue's 100 workers run at most a handful of evaluations at once,
 * none waiting for a worker. And stamping each monitor at its own moment
 * makes today's probes skip checks: a worker asks once a minute, at a random
 * second, so a monitor whose moment comes just after it asked waits for the
 * next minute's ask, a second later or most of a minute. The numbers are in
 * the issue and in the pull request that closed it.
 *
 * Opt in with RUN_POSTGRES_PROBE_RESULTS_BURST_TESTS=true against a Postgres
 * migrated to head, e.g. the Postgres Schema Drift workflow's database:
 *
 *   RUN_POSTGRES_PROBE_RESULTS_BURST_TESTS=true \
 *   PROBE_RESULTS_BURST_TEST_DATABASE_HOST=127.0.0.1 \
 *   PROBE_RESULTS_BURST_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Monitor/ProbeResultsBurstPostgres.test.ts
 *
 * It runs about ten minutes of real time. PROBE_RESULTS_BURST_REPORT_FILE,
 * when set, is where the measurements are written as JSON. The tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards; every row is synthetic.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

import fs from "fs";
import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../../Server/Infrastructure/Redis";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import TelemetryMonitorSchedule from "../../../../Server/Utils/Monitor/TelemetryMonitorSchedule";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger, QueryRunner } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROBE_RESULTS_BURST_TESTS"] === "true"
    ? describe
    : describe.skip;

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const SETUP_TIMEOUT_MS: number = 5 * 60 * 1000;
const RUN_TIMEOUT_MS: number = 6 * 60 * 1000;

const MONITORS: number = 300;
const PROBES: number = 2;
const RUN_FOR_MS: number = 3 * MINUTE_MS;

// The probe's own: MONITOR_FETCH_STAGGER_MAX_MS and PROBE_MONITOR_FETCH_LIMIT.
const STAGGER_MAX_MS: number = 45 * SECOND_MS;
const FETCH_LIMIT: number = 10;

// The Telemetry queue's workers in one process (TELEMETRY_CONCURRENCY).
const INGEST_WORKERS: number = 100;

const DASHES: RegExp = /-/g;

const BASE_TABLES: Array<string> = [
  "Project",
  "Probe",
  "Monitor",
  "MonitorProbe",
  "MonitorStatus",
  "MonitorStatusTimeline",
  "Incident",
  "IncidentState",
  "IncidentSeverity",
  "IncidentStateTimeline",
  "Alert",
  "AlertState",
  "AlertSeverity",
  "AlertStateTimeline",
  "ScheduledMaintenance",
  "ScheduledMaintenanceState",
];

const RELATIONS_READ: Array<{
  entity: typeof Monitor | typeof Incident;
  relation: string;
}> = [
  { entity: Monitor, relation: "labels" },
  { entity: Monitor, relation: "dependsOnMonitors" },
  { entity: Monitor, relation: "suppressAlertsWhenParentMonitorStatuses" },
  { entity: Incident, relation: "monitors" },
];

const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/i;

// When each statement was sent while a run is measured.
class StatementTimes implements Logger {
  public sentAt: Array<number> = [];
  public isRecording: boolean = false;

  public logQuery(
    query: string,
    _parameters?: Array<unknown>,
    _queryRunner?: QueryRunner,
  ): void {
    if (this.isRecording && !TRANSACTION_CONTROL.test(query)) {
      this.sentAt.push(Date.now());
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

interface ProbeFleetSettings {
  // PROBE_MONITORING_WORKERS of each probe's one replica.
  workers: number;
  // The longest a worker waits before its first ask of a minute.
  staggerMaxMs: number;
  // Each claimed row stamped at its monitor's own moment, as #11247 proposed.
  atOwnMoment: boolean;
}

// One probe result, from its check to its evaluation.
interface ResultTimes {
  monitorProbeId: string;
  checkedAt: number;
  startedAt: number;
  endedAt: number;
}

// What a run measured, over its whole minutes.
export interface BurstMeasured {
  results: number;
  minutes: number;
  // Results reaching the server, a second.
  resultsPerSecondMean: number;
  resultsPerSecondMax: number;
  // Seconds of the run with any result at all.
  busySecondsShare: number;
  // The share of a minute's results in its busiest 10 seconds.
  busiestTenSecondsShare: number;
  evaluationsAtOnceMax: number;
  evaluationMsP50: number;
  evaluationMsP95: number;
  evaluationMsMax: number;
  // How long a result waited for one of the queue's workers.
  waitForAWorkerMsMax: number;
  statementsPerSecondMax: number;
  // Each monitor probe's checks: the longest between two, and minutes it was not checked in.
  longestBetweenChecksMs: number;
  checksSkipped: number;
  claims: number;
}

function percentile(values: Array<number>, share: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });

  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
}

function mostAtOnce(spans: Array<{ startedAt: number; endedAt: number }>): number {
  const edges: Array<[number, number]> = [];

  for (const span of spans) {
    edges.push([span.startedAt, 1]);
    edges.push([Math.max(span.endedAt, span.startedAt + 0.001), -1]);
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

async function sleepUntil(atMs: number): Promise<void> {
  const waitMs: number = atMs - Date.now();

  if (waitMs > 0) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, waitMs);
    });
  }
}

// MonitorCheckSlots, as the probe has it.
class CheckSlots {
  private inUse: number = 0;
  private waiters: Array<() => void> = [];

  public constructor(private readonly capacity: number) {}

  // Room for at least `atLeast` checks, then as many as there is, up to `want`.
  public async reserve(want: number, atLeast: number): Promise<number> {
    while (this.capacity - this.inUse < atLeast) {
      await new Promise<void>((resolve: () => void) => {
        this.waiters.push(resolve);
      });
    }

    const taken: number = Math.min(want, this.capacity - this.inUse);
    this.inUse += taken;
    return taken;
  }

  public release(count: number): void {
    this.inUse = Math.max(0, this.inUse - count);

    for (const waiter of this.waiters.splice(0)) {
      waiter();
    }
  }
}

describePostgres(
  "#11247: probe results where they are evaluated, a few hundred monitors (Postgres)",
  () => {
    const schema: string = `probe_results_burst_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    const statementTimes: StatementTimes = new StatementTimes();
    let database: DataSource;

    const projectId: ObjectID = ObjectID.generate();
    const operationalStatusId: ObjectID = ObjectID.generate();
    const onlineCriteriaId: string = ObjectID.generate().toString();

    const probeIds: Array<ObjectID> = [];
    const stepIdOf: Map<string, ObjectID> = new Map();
    // Each monitor probe's monitor and probe.
    const assignmentOf: Map<string, { monitorId: string; probeId: string }> =
      new Map();

    const cache: Map<string, string> = new Map<string, string>();
    const measured: Record<string, BurstMeasured> = {};

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PROBE_RESULTS_BURST_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["PROBE_RESULTS_BURST_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PROBE_RESULTS_BURST_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["query"],
        logger: statementTimes,
        // An App pod's pool: DATABASE_MAX_OPEN_CONNECTIONS.
        extra: {
          max: 50,
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      const tables: Set<string> = new Set<string>(BASE_TABLES);

      for (const read of RELATIONS_READ) {
        const relation: RelationMetadata | undefined = database
          .getMetadata(read.entity)
          .findRelationWithPropertyPath(read.relation);

        expect(relation?.junctionEntityMetadata).toBeTruthy();

        tables.add(relation!.junctionEntityMetadata!.tableName);
        tables.add(relation!.inverseEntityMetadata.tableName);
      }

      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // A fixture names only what the path reads; keys stay NOT NULL.
      const columns: Array<{ table_name: string; column_name: string }> =
        await database.query(
          `SELECT c.table_name, c.column_name FROM information_schema.columns c
           WHERE c.table_schema = $1 AND c.is_nullable = 'NO'
             AND NOT EXISTS (
               SELECT 1 FROM information_schema.table_constraints t
               JOIN information_schema.key_column_usage k
                 ON k.constraint_name = t.constraint_name
                AND k.table_schema = t.table_schema
               WHERE t.constraint_type = 'PRIMARY KEY'
                 AND t.table_schema = c.table_schema
                 AND k.table_name = c.table_name
                 AND k.column_name = c.column_name
             )`,
          [schema],
        );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }

      await seed();
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }

      const reportFile: string | undefined =
        process.env["PROBE_RESULTS_BURST_REPORT_FILE"];

      if (reportFile) {
        fs.writeFileSync(reportFile, JSON.stringify(measured, null, 2));
      }
    });

    beforeEach(() => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

      jest.spyOn(Redis, "isConnected").mockReturnValue(true);
      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (namespace: string, key: string) => {
          return cache.get(`${namespace}-${key}`) ?? null;
        });
      jest
        .spyOn(GlobalCache, "getStrings")
        .mockImplementation(async (namespace: string, keys: Array<string>) => {
          return keys.map((key: string) => {
            return cache.get(`${namespace}-${key}`) ?? null;
          });
        });
      jest
        .spyOn(GlobalCache, "setString")
        .mockImplementation(
          async (namespace: string, key: string, value: string) => {
            cache.set(`${namespace}-${key}`, value);
          },
        );
      jest
        .spyOn(GlobalCache, "setStringIfNotExists")
        .mockImplementation(
          async (namespace: string, key: string, value: string) => {
            if (cache.has(`${namespace}-${key}`)) {
              return false;
            }

            cache.set(`${namespace}-${key}`, value);
            return true;
          },
        );
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (namespace: string, key: string) => {
          cache.delete(`${namespace}-${key}`);
        });

      jest
        .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
        .mockImplementation(async (): Promise<SeriesResolvedResourceIds> => {
          return (
            MonitorResourceContextUtil as unknown as {
              emptyContext: () => SeriesResolvedResourceIds;
            }
          ).emptyContext();
        });

      (Semaphore.lock as jest.Mock).mockResolvedValue({} as never);
      (Semaphore.release as jest.Mock).mockResolvedValue(undefined as never);

      // Every check is healthy: the criteria that keeps the monitor online.
      (
        MonitorCriteriaEvaluator.processMonitorStep as jest.Mock
      ).mockImplementation((async (input: {
        probeApiIngestResponse: ProbeApiIngestResponse;
      }): Promise<ProbeApiIngestResponse> => {
        return {
          ...input.probeApiIngestResponse,
          criteriaMetId: onlineCriteriaId,
          rootCause: "The check is online.",
        };
      }) as never);
    });

    async function seed(): Promise<void> {
      await database.query(
        `INSERT INTO "Project" ("_id", "name", "slug", "isBlocked") VALUES ($1::uuid, 'Probe results', $1::text, false)`,
        [projectId.toString()],
      );

      await database.query(
        `INSERT INTO "MonitorStatus" ("_id", "projectId", "name", "slug", "color", "priority", "isOperationalState", "isOfflineState")
         VALUES ($1::uuid, $2, 'Operational', $1::text, '#000000', 1, true, false)`,
        [operationalStatusId.toString(), projectId.toString()],
      );

      for (let index: number = 0; index < PROBES; index++) {
        const probeId: ObjectID = ObjectID.generate();
        probeIds.push(probeId);

        await database.query(
          `INSERT INTO "Probe" ("_id", "projectId", "key", "name", "slug", "isGlobalProbe", "connectionStatus", "createdAt", "updatedAt", "version")
           VALUES ($1::uuid, $2, $3, $4, $1::text, false, 'connected', now(), now(), 1)`,
          [
            probeId.toString(),
            projectId.toString(),
            ObjectID.generate().toString(),
            `Probe ${index + 1}`,
          ],
        );
      }

      for (let index: number = 0; index < MONITORS; index++) {
        const monitorId: ObjectID = ObjectID.generate();
        const stepId: ObjectID = ObjectID.generate();
        stepIdOf.set(monitorId.toString(), stepId);

        const online: MonitorCriteriaInstance = new MonitorCriteriaInstance();
        online.data!.id = onlineCriteriaId;
        online.data!.name = "online";
        online.data!.changeMonitorStatus = true;
        online.data!.monitorStatusId = operationalStatusId;

        const monitorCriteria: MonitorCriteria = new MonitorCriteria();
        monitorCriteria.data = { monitorCriteriaInstanceArray: [online] };

        const step: MonitorStep = new MonitorStep();
        step.id = stepId;
        step.data!.id = stepId.toString();
        step.data!.monitorCriteria = monitorCriteria;

        const monitorSteps: MonitorSteps = new MonitorSteps();
        monitorSteps.data = {
          monitorStepsInstanceArray: [step],
          defaultMonitorStatusId: operationalStatusId,
        };

        await database.query(
          `INSERT INTO "Monitor" ("_id", "projectId", "name", "slug", "monitorType", "monitorSteps", "monitoringInterval", "currentMonitorStatusId", "isArchived", "disableActiveMonitoring", "disableActiveMonitoringBecauseOfManualIncident", "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent", "createdAt", "updatedAt", "version")
           VALUES ($1::uuid, $2, $3, $1::text, $4, $5::jsonb, '* * * * *', $6, false, false, false, false, now(), now(), 1)`,
          [
            monitorId.toString(),
            projectId.toString(),
            `Checkout ${index + 1}`,
            MonitorType.Ping,
            JSON.stringify(monitorSteps.toJSON()),
            operationalStatusId.toString(),
          ],
        );

        for (const probeId of probeIds) {
          const monitorProbeId: string = ObjectID.generate().toString();
          assignmentOf.set(monitorProbeId, {
            monitorId: monitorId.toString(),
            probeId: probeId.toString(),
          });

          await database.query(
            `INSERT INTO "MonitorProbe" ("_id", "projectId", "monitorId", "probeId", "isEnabled", "nextPingAt", "createdAt", "updatedAt", "version")
             VALUES ($1, $2, $3, $4, true, now(), now(), now(), 1)`,
            [
              monitorProbeId,
              projectId.toString(),
              monitorId.toString(),
              probeId.toString(),
            ],
          );
        }
      }
    }

    // Each monitor probe's next check, as #11247 proposed: its own moment.
    async function stampAtOwnMoments(
      monitorProbeIds: Array<string>,
      after: Date,
    ): Promise<void> {
      if (monitorProbeIds.length === 0) {
        return;
      }

      await database.query(
        `UPDATE "MonitorProbe" AS mp SET "nextPingAt" = own."nextPingAt"
         FROM unnest($1::uuid[], $2::timestamptz[]) AS own("id", "nextPingAt")
         WHERE mp."_id" = own."id"`,
        [
          monitorProbeIds,
          monitorProbeIds.map((id: string): Date => {
            return TelemetryMonitorSchedule.getNextRunAt({
              monitorId: assignmentOf.get(id)!.monitorId,
              monitoringInterval: "* * * * *",
              after: after,
            });
          }),
        ],
      );
    }

    function resultOf(monitorProbeId: string): ProbeMonitorResponse {
      const assignment: { monitorId: string; probeId: string } =
        assignmentOf.get(monitorProbeId)!;

      return {
        projectId: projectId,
        monitorId: new ObjectID(assignment.monitorId),
        probeId: new ObjectID(assignment.probeId),
        monitorStepId: stepIdOf.get(assignment.monitorId)!,
        isOnline: true,
        responseTimeInMs: 42,
        failureCause: "",
        monitoredAt: OneUptimeDate.getCurrentDate(),
      } as unknown as ProbeMonitorResponse;
    }

    /*
     * Runs the probes and the queue's workers for RUN_FOR_MS from the next
     * whole minute, and measures where the results are evaluated.
     */
    async function runFleet(
      name: string,
      settings: ProbeFleetSettings,
      seedNumber: number,
    ): Promise<BurstMeasured> {
      const random: SeededRandom = seededRandom(seedNumber);
      const startAt: number =
        (Math.floor(Date.now() / MINUTE_MS) + 1) * MINUTE_MS;
      const stopAt: number = startAt + RUN_FOR_MS;

      // Every monitor probe due as the run starts.
      if (settings.atOwnMoment) {
        await stampAtOwnMoments(
          Array.from(assignmentOf.keys()),
          new Date(startAt - 1),
        );
      } else {
        await database.query(`UPDATE "MonitorProbe" SET "nextPingAt" = $1`, [
          new Date(startAt),
        ]);
      }

      // The Telemetry queue: results in the order they arrive, 100 workers.
      const waiting: Array<{ monitorProbeId: string; checkedAt: number }> = [];
      const times: Array<ResultTimes> = [];
      const failures: Array<unknown> = [];
      const evaluations: Set<Promise<void>> = new Set();
      let active: number = 0;
      let claims: number = 0;

      const pump: () => void = (): void => {
        while (active < INGEST_WORKERS && waiting.length > 0) {
          const next: { monitorProbeId: string; checkedAt: number } =
            waiting.shift()!;
          active++;

          const startedAt: number = Date.now();
          const evaluation: Promise<void> = MonitorResourceUtil.monitorResource(
            resultOf(next.monitorProbeId),
            {
              reportingProbeId: new ObjectID(
                assignmentOf.get(next.monitorProbeId)!.probeId,
              ),
            },
          )
            .then(() => {
              times.push({
                monitorProbeId: next.monitorProbeId,
                checkedAt: next.checkedAt,
                startedAt: startedAt,
                endedAt: Date.now(),
              });
            })
            .catch((error: unknown) => {
              failures.push(error);
            })
            .finally(() => {
              active--;
              evaluations.delete(evaluation);
              pump();
            });

          evaluations.add(evaluation);
        }
      };

      // One worker of a probe's replica: once a minute, as FetchList runs it.
      const runWorker: (data: {
        probeId: ObjectID;
        slots: CheckSlots;
      }) => Promise<void> = async (data: {
        probeId: ObjectID;
        slots: CheckSlots;
      }): Promise<void> => {
        const checks: Set<Promise<void>> = new Set();

        for (
          let minute: number = startAt;
          minute < stopAt;
          minute += MINUTE_MS
        ) {
          await sleepUntil(
            minute +
              (settings.staggerMaxMs > 0 ? random(settings.staggerMaxMs) : 0),
          );

          for (;;) {
            const room: number = await data.slots.reserve(
              FETCH_LIMIT,
              Math.ceil(FETCH_LIMIT / 2),
            );

            const claimed: Array<ObjectID> =
              await MonitorProbeService.claimMonitorProbesForProbing({
                probeId: data.probeId,
                limit: room,
              });
            claims++;

            data.slots.release(room - claimed.length);

            if (settings.atOwnMoment) {
              await stampAtOwnMoments(
                claimed.map((id: ObjectID): string => {
                  return id.toString();
                }),
                new Date(),
              );
            }

            for (const id of claimed) {
              const check: Promise<void> = new Promise<void>(
                (resolve: () => void) => {
                  setTimeout(resolve, 100 + random(800));
                },
              ).then(() => {
                waiting.push({
                  monitorProbeId: id.toString(),
                  checkedAt: Date.now(),
                });
                data.slots.release(1);
                checks.delete(check);
                pump();
              });

              checks.add(check);
            }

            // A short batch: nothing more is due for this probe.
            if (claimed.length < room) {
              break;
            }
          }
        }

        await Promise.all(Array.from(checks));
      };

      statementTimes.sentAt = [];
      statementTimes.isRecording = true;

      try {
        await Promise.all(
          probeIds.flatMap((probeId: ObjectID): Array<Promise<void>> => {
            const slots: CheckSlots = new CheckSlots(
              settings.workers * FETCH_LIMIT,
            );

            return Array.from({ length: settings.workers }, () => {
              return runWorker({ probeId, slots });
            });
          }),
        );

        while (evaluations.size > 0 || waiting.length > 0) {
          await Promise.all(Array.from(evaluations));
        }
      } finally {
        statementTimes.isRecording = false;
      }

      expect(failures).toEqual([]);

      const report: BurstMeasured = measure({
        times,
        statementsSentAt: statementTimes.sentAt,
        startAt,
        stopAt,
        claims,
      });

      measured[name] = report;
      return report;
    }

    function measure(data: {
      times: Array<ResultTimes>;
      statementsSentAt: Array<number>;
      startAt: number;
      stopAt: number;
      claims: number;
    }): BurstMeasured {
      const seconds: number = (data.stopAt - data.startAt) / SECOND_MS;
      const perSecond: Array<number> = new Array<number>(seconds).fill(0);
      const statementsPerSecond: Map<number, number> = new Map();

      for (const time of data.times) {
        const second: number = Math.floor(
          (time.checkedAt - data.startAt) / SECOND_MS,
        );

        if (second >= 0 && second < seconds) {
          perSecond[second]! += 1;
        }
      }

      for (const sentAt of data.statementsSentAt) {
        const second: number = Math.floor(sentAt / SECOND_MS);
        statementsPerSecond.set(
          second,
          (statementsPerSecond.get(second) || 0) + 1,
        );
      }

      // Each minute's busiest 10 seconds, as a share of the minute.
      let busiestShare: number = 0;

      for (let minute: number = 0; minute * 60 < seconds; minute++) {
        const minuteSeconds: Array<number> = perSecond.slice(
          minute * 60,
          minute * 60 + 60,
        );
        const minuteTotal: number = minuteSeconds.reduce(
          (sum: number, value: number) => {
            return sum + value;
          },
          0,
        );

        for (let from: number = 0; from + 10 <= minuteSeconds.length; from++) {
          const ten: number = minuteSeconds
            .slice(from, from + 10)
            .reduce((sum: number, value: number) => {
              return sum + value;
            }, 0);

          if (minuteTotal > 0) {
            busiestShare = Math.max(busiestShare, ten / minuteTotal);
          }
        }
      }

      // Each monitor probe's checks, in order.
      const byAssignment: Map<string, Array<number>> = new Map();

      for (const time of data.times) {
        const list: Array<number> = byAssignment.get(time.monitorProbeId) || [];
        list.push(time.checkedAt);
        byAssignment.set(time.monitorProbeId, list);
      }

      let longestBetween: number = 0;
      let skipped: number = 0;

      for (const list of byAssignment.values()) {
        list.sort((a: number, b: number) => {
          return a - b;
        });

        for (let index: number = 1; index < list.length; index++) {
          const between: number = list[index]! - list[index - 1]!;
          longestBetween = Math.max(longestBetween, between);
        }
      }

      // A monitor probe with no check in a whole minute of the run.
      for (const id of assignmentOf.keys()) {
        const list: Array<number> = byAssignment.get(id) || [];

        for (
          let minute: number = data.startAt;
          minute < data.stopAt;
          minute += MINUTE_MS
        ) {
          if (
            !list.some((checkedAt: number) => {
              return checkedAt >= minute && checkedAt < minute + MINUTE_MS;
            })
          ) {
            skipped++;
          }
        }
      }

      const durations: Array<number> = data.times.map(
        (time: ResultTimes): number => {
          return time.endedAt - time.startedAt;
        },
      );

      return {
        results: data.times.length,
        minutes: seconds / 60,
        resultsPerSecondMean: data.times.length / seconds,
        resultsPerSecondMax: Math.max(0, ...perSecond),
        busySecondsShare:
          perSecond.filter((value: number) => {
            return value > 0;
          }).length / seconds,
        busiestTenSecondsShare: busiestShare,
        evaluationsAtOnceMax: mostAtOnce(data.times),
        evaluationMsP50: percentile(durations, 0.5),
        evaluationMsP95: percentile(durations, 0.95),
        evaluationMsMax: Math.max(0, ...durations),
        waitForAWorkerMsMax: Math.max(
          0,
          ...data.times.map((time: ResultTimes): number => {
            return time.startedAt - time.checkedAt;
          }),
        ),
        statementsPerSecondMax: Math.max(0, ...statementsPerSecond.values()),
        longestBetweenChecksMs: longestBetween,
        checksSkipped: skipped,
        claims: data.claims,
      };
    }

    test(
      "today: every monitor due at the whole minute, the probes' defaults - the results arrive spread by each worker's own second, and no evaluation waits for a worker",
      async () => {
        const report: BurstMeasured = await runFleet(
          "today",
          { workers: 1, staggerMaxMs: STAGGER_MAX_MS, atOwnMoment: false },
          11247,
        );

        // 300 monitors from two probes, every minute, for three minutes.
        expect(report.results).toBeGreaterThanOrEqual(
          MONITORS * PROBES * 3 - MONITORS * PROBES * 0.05,
        );

        // Bounded by each worker's 10 check slots: tens a second at most.
        expect(report.resultsPerSecondMax).toBeLessThan(80);
        // Never near the queue's 100 workers, and nothing waits for one.
        expect(report.evaluationsAtOnceMax).toBeLessThan(INGEST_WORKERS / 2);
        expect(report.waitForAWorkerMsMax).toBeLessThan(SECOND_MS);
        // Every monitor probe checked in every minute.
        expect(report.checksSkipped).toBe(0);
      },
      RUN_TIMEOUT_MS,
    );

    test(
      "the worst of today: three workers a probe and no stagger, every worker asking at :00 - still a few dozen results a second, and nothing waits for a worker",
      async () => {
        const report: BurstMeasured = await runFleet(
          "worst of today",
          { workers: 3, staggerMaxMs: 0, atOwnMoment: false },
          11248,
        );

        expect(report.results).toBeGreaterThanOrEqual(
          MONITORS * PROBES * 3 - MONITORS * PROBES * 0.05,
        );
        expect(report.evaluationsAtOnceMax).toBeLessThan(INGEST_WORKERS);
        expect(report.waitForAWorkerMsMax).toBeLessThan(SECOND_MS);
        expect(report.checksSkipped).toBe(0);
      },
      RUN_TIMEOUT_MS,
    );

    test(
      "each monitor at its own moment, as #11247 proposed: no smoother where it is evaluated, and today's probes skip checks - they ask once a minute",
      async () => {
        const today: BurstMeasured = measured["today"]!;
        const report: BurstMeasured = await runFleet(
          "own moments",
          { workers: 1, staggerMaxMs: STAGGER_MAX_MS, atOwnMoment: true },
          11247,
        );

        // A probe asks once a minute: a monitor due after it asked waits for the next.
        expect(report.checksSkipped).toBeGreaterThan(0);
        expect(report.longestBetweenChecksMs).toBeGreaterThan(
          today.longestBetweenChecksMs,
        );

        // Where it is evaluated, no calmer than today.
        expect(report.waitForAWorkerMsMax).toBeLessThan(SECOND_MS);
        expect(report.evaluationsAtOnceMax).toBeLessThan(INGEST_WORKERS / 2);
      },
      RUN_TIMEOUT_MS,
    );
  },
);
