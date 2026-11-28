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
 * #11333 RUNS THREE MORE: the probes as they ask since then - each worker
 * at its own moment of the minute, the same every minute (ProbeFetchMoments,
 * which the probe's FetchList asks by) - with the probes' defaults and with
 * the Helm chart's three workers a probe, and today's way with three workers
 * too, to compare with. Beside how bursty the results are, each run says how
 * far apart each monitor probe's checks were: before, a worker waited a new
 * random second every minute, so a one-minute monitor's checks were 15 to
 * 105 seconds apart; at its own moment, a minute, give or take how long its
 * probe takes to get through what is due (its round). "today" below is how
 * probes asked before #11333, as #11247 measured it.
 *
 * #11386 RUNS THREE MORE, with the workers ticked as FetchList's cron ticks
 * them and each probe's moments pinned: a busy probe of one worker, the
 * Helm chart's three workers, and a probe whose round passes the next
 * minute every time. Each says how far a monitor probe's place in its
 * probe's round moved from one round to the next, and who missed a minute -
 * by when results landed and by when the claim handed each out - and
 * whether a monitor probe missed a second before every one of its probe's
 * had missed one. Before #11386 the claim handed out the monitors due at
 * the same moment in the order the table held them: a busy probe's monitor
 * moved up to 16.6 s in its round, and when the probe fell behind, 350 of
 * its 600 monitor probes took all its missed minutes, up to four each. Now
 * a place moves under 2 s, and every monitor probe takes its turn.
 *
 * Opt in with RUN_POSTGRES_PROBE_RESULTS_BURST_TESTS=true against a Postgres
 * migrated to head, e.g. the Postgres Schema Drift workflow's database:
 *
 *   RUN_POSTGRES_PROBE_RESULTS_BURST_TESTS=true \
 *   PROBE_RESULTS_BURST_TEST_DATABASE_HOST=127.0.0.1 \
 *   PROBE_RESULTS_BURST_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Monitor/ProbeResultsBurstPostgres.test.ts
 *
 * It runs about 37 minutes of real time, more than a CI job has: the
 * Postgres Schema Drift workflow shares its tests out between three shards
 * by name (jest's -t), a test that reads another's report (measured) in
 * that test's shard. PROBE_RESULTS_BURST_REPORT_FILE,
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
import MonitorProbeService, {
  ClaimedMonitorProbe,
} from "../../../../Server/Services/MonitorProbeService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import TelemetryMonitorSchedule from "../../../../Server/Utils/Monitor/TelemetryMonitorSchedule";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import OneUptimeDate from "../../../../Types/Date";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ProbeFetchMoments from "../../../../Utils/Probe/ProbeFetchMoments";
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

/*
 * How far a monitor's two results can land from a minute plus its probe's
 * round: each check takes 100 to 900 ms here, so two of them end up to
 * 800 ms further apart than they started; the rest is timers.
 */
const GAP_SLACK_MS: number = 2 * SECOND_MS;

/*
 * #11386's runs: long enough for each monitor probe to be handed out in
 * several rounds of its probe, and for a probe that falls behind to have
 * monitors miss a minute in four of its rounds.
 */
const CLAIM_ORDER_RUN_MS: number = 5 * MINUTE_MS;
const FALLING_BEHIND_RUN_MS: number = 9 * MINUTE_MS;
const CLAIM_ORDER_RUN_TIMEOUT_MS: number = 8 * MINUTE_MS;

/*
 * How far a monitor's place in its probe's round may move from one round to
 * the next when the claim keeps their order: its checks before it in the
 * round take 100 to 900 ms each, so the time its probe takes to reach it
 * varies a little; nothing else moves it.
 */
const PLACE_SLACK_MS: number = 3 * SECOND_MS;

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
  /*
   * Each worker asks at its own moment of the minute, the same every minute,
   * as the probe does since #11333 (ProbeFetchMoments); otherwise at a new
   * random moment of the first staggerMaxMs every minute, as it did before.
   */
  askAtOwnMoment?: boolean | undefined;
  /*
   * Each probe's workers' moments of the minute, in ms from its start,
   * worker 1 first, in place of the moments drawn for the probe (#11386):
   * a probe that keeps up with its round, or one whose moment plus its
   * round passes the next minute.
   */
  offsetsMs?: Array<Array<number>> | undefined;
  /*
   * The workers tick as FetchList's cron ticks them (#11386): at every
   * minute, a worker that is not still fetching waits for its moment and
   * asks; one still fetching - its round ran past the minute - skips that
   * minute's tick, as workerRunsInProgress has it. Otherwise each worker
   * goes from one minute's round straight to the next.
   */
  ticksLikeTheCron?: boolean | undefined;
  // How long the run lasts, from its first whole minute (RUN_FOR_MS).
  runForMs?: number | undefined;
}

// How the probes' claims went, over a run (#11386).
export interface ClaimsMeasured {
  claims: number;
  // How long each claim took, as the probe waited for it.
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  // Monitor probes handed out, a claim.
  handedOutMean: number;
  /*
   * Monitor probes handed out a second of claiming: what one claim at a
   * time hands out, the work the statement does, not the probes' checks.
   */
  handedOutPerClaimingSecond: number;
}

/*
 * Where in its probe's round each monitor probe is handed out, from one
 * round to the next (#11386): how far its place moved. A monitor whose
 * place holds is checked a minute after it last was; one handed out
 * anywhere in the round is checked a minute apart give or take the round.
 */
export interface PlaceInRound {
  moves: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/*
 * The minutes a monitor probe was not checked in, after the run's first
 * (#11386): who waits when a probe falls behind. When the waits take turns,
 * no monitor probe waits a second time before every one of its probe's has
 * waited once.
 */
export interface SkipsMeasured {
  total: number;
  // Monitor probes that missed at least one minute.
  monitorProbes: number;
  // The most minutes one monitor probe missed.
  mostOfOne: number;
  /*
   * Minutes missed by a monitor probe that had missed one before, while
   * more than a batch of its probe's had missed none yet.
   */
  againBeforeOthersOnce: number;
  // Minutes missed by a monitor probe that missed the minute before too.
  inARow: number;
}

// The time between two checks of one monitor probe, over a run.
export interface BetweenChecks {
  gaps: number;
  minMs: number;
  p5Ms: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  // The farthest a gap was from a minute, either way.
  farthestFromAMinuteMs: number;
  // The share of gaps within a second of a minute.
  withinASecondShare: number;
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
  betweenChecks: BetweenChecks;
  /*
   * A probe's round: in one minute, from the first of its claims that handed
   * it monitors to the last. The longest of the run. A monitor is checked
   * somewhere in its probe's round, and where depends on the order the
   * claim hands out monitors due at the same moment.
   */
  longestRoundMs: number;
  checksSkipped: number;
  claims: number;
  claimsMeasured: ClaimsMeasured;
  placeInRound: PlaceInRound;
  // Minutes missed by when each result reached the server.
  skips: SkipsMeasured;
  /*
   * Minutes missed by when each monitor probe was handed out: who the claim
   * made wait. A check handed out just before a minute whose result lands
   * just after it misses that minute by its result alone.
   */
  skipsHandedOut: SkipsMeasured;
  // Minutes a worker's round ran past, so the cron's next tick was skipped.
  ticksSkipped: number;
}

// One monitor probe handed out: by which probe's round, and when (#11386).
interface HandedOut {
  monitorProbeId: string;
  probeId: string;
  // The minute whose round handed it out: the tick the worker asked at.
  roundMinute: number;
  claimedAt: number;
}

function percentile(values: Array<number>, share: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });

  return sorted[
    Math.min(sorted.length - 1, Math.floor(share * sorted.length))
  ]!;
}

function mostAtOnce(
  spans: Array<{ startedAt: number; endedAt: number }>,
): number {
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
      const stopAt: number = startAt + (settings.runForMs ?? RUN_FOR_MS);

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
      // Evaluations running now, on the queue's workers.
      const pool: { active: number } = { active: 0 };
      let claims: number = 0;
      // Each claim: how long the probe waited for it, and how many it handed out.
      const claimTimes: Array<{ tookMs: number; handedOut: number }> = [];
      // Each monitor probe handed out, by whose round and when (#11386).
      const handedOut: Array<HandedOut> = [];
      // Ticks of the cron a worker still fetching skipped (ticksLikeTheCron).
      let ticksSkipped: number = 0;
      // Each probe's round of each minute: its first and last claim with monitors.
      const rounds: Map<string, { firstMs: number; lastMs: number }> =
        new Map();

      const pump: () => void = (): void => {
        while (pool.active < INGEST_WORKERS && waiting.length > 0) {
          const next: { monitorProbeId: string; checkedAt: number } =
            waiting.shift()!;
          pool.active++;

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
              pool.active--;
              evaluations.delete(evaluation);
              pump();
            });

          evaluations.add(evaluation);
        }
      };

      /*
       * One worker's round of one minute: it claims as many due monitors as
       * it has room for, starts checking each, and claims again while it is
       * handed a full batch, as FetchList does.
       */
      const runRound: (data: {
        probeId: ObjectID;
        slots: CheckSlots;
        checks: Set<Promise<void>>;
        minute: number;
      }) => Promise<void> = async (data: {
        probeId: ObjectID;
        slots: CheckSlots;
        checks: Set<Promise<void>>;
        minute: number;
      }): Promise<void> => {
        for (;;) {
          const room: number = await data.slots.reserve(
            FETCH_LIMIT,
            Math.ceil(FETCH_LIMIT / 2),
          );

          const sentAt: number = Date.now();
          const claimed: Array<ObjectID> = (
            await MonitorProbeService.claimMonitorProbesForProbing({
              probeId: data.probeId,
              limit: room,
            })
          ).map((claimedMonitorProbe: ClaimedMonitorProbe): ObjectID => {
            return claimedMonitorProbe.monitorProbeId;
          });
          const claimedAt: number = Date.now();
          claims++;
          claimTimes.push({
            tookMs: claimedAt - sentAt,
            handedOut: claimed.length,
          });

          if (claimed.length > 0) {
            const key: string = `${data.probeId.toString()} ${data.minute}`;
            const round: { firstMs: number; lastMs: number } | undefined =
              rounds.get(key);

            rounds.set(key, {
              firstMs: round ? round.firstMs : claimedAt,
              lastMs: claimedAt,
            });

            for (const id of claimed) {
              handedOut.push({
                monitorProbeId: id.toString(),
                probeId: data.probeId.toString(),
                roundMinute: data.minute,
                claimedAt: claimedAt,
              });
            }
          }

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
              data.checks.delete(check);
              pump();
            });

            data.checks.add(check);
          }

          // A short batch: nothing more is due for this probe.
          if (claimed.length < room) {
            return;
          }
        }
      };

      // One worker of a probe's replica: once a minute, as FetchList runs it.
      const runWorker: (data: {
        probeId: ObjectID;
        slots: CheckSlots;
        // Its moment of the minute, when it asks at its own (#11333).
        offsetMs: number;
      }) => Promise<void> = async (data: {
        probeId: ObjectID;
        slots: CheckSlots;
        offsetMs: number;
      }): Promise<void> => {
        const checks: Set<Promise<void>> = new Set();

        if (settings.ticksLikeTheCron) {
          /*
           * The cron ticks at every minute; a worker still fetching skips
           * the tick (FetchList's workerRunsInProgress), so one whose round
           * ran past the minute next asks at its moment of the minute after.
           */
          const worker: { fetching: Promise<void> | null } = {
            fetching: null,
          };

          // The worker's fetching from one tick: its moment, then its round.
          const fetchFrom: (tick: number) => Promise<void> = async (
            tick: number,
          ): Promise<void> => {
            try {
              await sleepUntil(tick + data.offsetMs);
              await runRound({
                probeId: data.probeId,
                slots: data.slots,
                checks: checks,
                minute: tick,
              });
            } finally {
              worker.fetching = null;
            }
          };

          for (
            let minute: number = startAt;
            minute < stopAt;
            minute += MINUTE_MS
          ) {
            await sleepUntil(minute);

            if (worker.fetching) {
              ticksSkipped++;
              continue;
            }

            worker.fetching = fetchFrom(minute);
          }

          await worker.fetching;
        } else {
          for (
            let minute: number = startAt;
            minute < stopAt;
            minute += MINUTE_MS
          ) {
            await sleepUntil(
              minute +
                (settings.askAtOwnMoment
                  ? data.offsetMs
                  : settings.staggerMaxMs > 0
                    ? random(settings.staggerMaxMs)
                    : 0),
            );

            await runRound({
              probeId: data.probeId,
              slots: data.slots,
              checks: checks,
              minute: minute,
            });
          }
        }

        await Promise.all(Array.from(checks));
      };

      statementTimes.sentAt = [];
      statementTimes.isRecording = true;

      try {
        await Promise.all(
          probeIds.flatMap(
            (probeId: ObjectID, probeIndex: number): Array<Promise<void>> => {
              const slots: CheckSlots = new CheckSlots(
                settings.workers * FETCH_LIMIT,
              );
              /*
               * Drawn once for the probe, as it starts (ProbeFetchMoments).
               * Only by a run that asks at its own moments, so a run that asks
               * as before draws the same seconds as before.
               */
              const offsetsMs: Array<number> =
                settings.offsetsMs?.[probeIndex] ||
                (settings.askAtOwnMoment
                  ? ProbeFetchMoments.getWorkerOffsetsMs({
                      workers: settings.workers,
                      spreadMs: settings.staggerMaxMs,
                      random: random(1000000) / 1000000,
                    })
                  : []);

              return Array.from(
                { length: settings.workers },
                (_value: unknown, worker: number) => {
                  return runWorker({
                    probeId,
                    slots,
                    offsetMs: offsetsMs[worker] ?? 0,
                  });
                },
              );
            },
          ),
        );

        while (evaluations.size > 0 || waiting.length > 0) {
          await Promise.all(Array.from(evaluations));
        }
      } finally {
        statementTimes.isRecording = false;
      }

      expect(failures).toEqual([]);

      const report: BurstMeasured = {
        ...measure({
          times,
          statementsSentAt: statementTimes.sentAt,
          startAt,
          stopAt,
          claims,
          rounds: Array.from(rounds.values()),
        }),
        claimsMeasured: measureClaims(claimTimes),
        placeInRound: measurePlaceInRound(handedOut, rounds),
        skips: measureSkips({
          events: times.map((time: ResultTimes) => {
            return {
              monitorProbeId: time.monitorProbeId,
              atMs: time.checkedAt,
            };
          }),
          startAt,
          stopAt,
        }),
        skipsHandedOut: measureSkips({
          events: handedOut.map((handOut: HandedOut) => {
            return {
              monitorProbeId: handOut.monitorProbeId,
              atMs: handOut.claimedAt,
            };
          }),
          startAt,
          stopAt,
        }),
        ticksSkipped: ticksSkipped,
      };

      measured[name] = report;
      return report;
    }

    function measureClaims(
      claimTimes: Array<{ tookMs: number; handedOut: number }>,
    ): ClaimsMeasured {
      const took: Array<number> = claimTimes.map(
        (claim: { tookMs: number }): number => {
          return claim.tookMs;
        },
      );
      const handedOutInAll: number = claimTimes.reduce(
        (sum: number, claim: { handedOut: number }): number => {
          return sum + claim.handedOut;
        },
        0,
      );
      const claimingMs: number = took.reduce(
        (sum: number, tookMs: number): number => {
          return sum + tookMs;
        },
        0,
      );

      return {
        claims: claimTimes.length,
        p50Ms: percentile(took, 0.5),
        p95Ms: percentile(took, 0.95),
        maxMs: Math.max(0, ...took),
        handedOutMean:
          claimTimes.length > 0 ? handedOutInAll / claimTimes.length : 0,
        handedOutPerClaimingSecond:
          claimingMs > 0 ? handedOutInAll / (claimingMs / SECOND_MS) : 0,
      };
    }

    /*
     * Each monitor probe's place in its probe's round: when it was handed
     * out, from the round's first claim with monitors. Compared from one of
     * its probe's rounds to the next one that handed it out.
     */
    function measurePlaceInRound(
      handedOut: Array<HandedOut>,
      rounds: Map<string, { firstMs: number; lastMs: number }>,
    ): PlaceInRound {
      // The first time each monitor probe was handed out in each round.
      const placesOf: Map<string, Map<number, number>> = new Map();

      for (const handOut of handedOut) {
        const round: { firstMs: number } | undefined = rounds.get(
          `${handOut.probeId} ${handOut.roundMinute}`,
        );

        if (!round) {
          continue;
        }

        const places: Map<number, number> =
          placesOf.get(handOut.monitorProbeId) || new Map<number, number>();

        if (!places.has(handOut.roundMinute)) {
          places.set(handOut.roundMinute, handOut.claimedAt - round.firstMs);
        }

        placesOf.set(handOut.monitorProbeId, places);
      }

      const moves: Array<number> = [];

      for (const places of placesOf.values()) {
        const minutes: Array<number> = Array.from(places.keys()).sort(
          (a: number, b: number): number => {
            return a - b;
          },
        );

        for (let index: number = 1; index < minutes.length; index++) {
          moves.push(
            Math.abs(
              places.get(minutes[index]!)! - places.get(minutes[index - 1]!)!,
            ),
          );
        }
      }

      return {
        moves: moves.length,
        p50Ms: percentile(moves, 0.5),
        p95Ms: percentile(moves, 0.95),
        maxMs: Math.max(0, ...moves),
      };
    }

    /*
     * The minutes each monitor probe had no check in, from the run's second
     * minute: in its first, a probe whose moment comes late in the minute has
     * not reached all its monitors yet, through no fault of the order.
     */
    function measureSkips(data: {
      // When each monitor probe was checked (or handed out).
      events: Array<{ monitorProbeId: string; atMs: number }>;
      startAt: number;
      stopAt: number;
    }): SkipsMeasured {
      const checkedMinutesOf: Map<string, Set<number>> = new Map();

      for (const event of data.events) {
        const minute: number = Math.floor(
          (event.atMs - data.startAt) / MINUTE_MS,
        );
        const minutes: Set<number> =
          checkedMinutesOf.get(event.monitorProbeId) || new Set<number>();
        minutes.add(minute);
        checkedMinutesOf.set(event.monitorProbeId, minutes);
      }

      const minutesInRun: number = Math.floor(
        (data.stopAt - data.startAt) / MINUTE_MS,
      );
      const result: SkipsMeasured = {
        total: 0,
        monitorProbes: 0,
        mostOfOne: 0,
        againBeforeOthersOnce: 0,
        inARow: 0,
      };

      for (const probeId of probeIds) {
        const monitorProbeIds: Array<string> = Array.from(
          assignmentOf.keys(),
        ).filter((id: string): boolean => {
          return assignmentOf.get(id)!.probeId === probeId.toString();
        });
        const skipsOf: Map<string, number> = new Map<string, number>();

        for (let minute: number = 1; minute < minutesInRun; minute++) {
          const skippedNow: Array<string> = monitorProbeIds.filter(
            (id: string): boolean => {
              return !checkedMinutesOf.get(id)?.has(minute);
            },
          );

          for (const id of skippedNow) {
            skipsOf.set(id, (skipsOf.get(id) || 0) + 1);
          }

          // Monitor probes of this probe that have not missed a minute yet.
          const notYetOnce: number = monitorProbeIds.filter(
            (id: string): boolean => {
              return !skipsOf.has(id);
            },
          ).length;

          for (const id of skippedNow) {
            result.total++;

            if (skipsOf.get(id)! > 1 && notYetOnce > FETCH_LIMIT) {
              result.againBeforeOthersOnce++;
            }

            if (minute > 1 && !checkedMinutesOf.get(id)?.has(minute - 1)) {
              result.inARow++;
            }
          }
        }

        result.monitorProbes += skipsOf.size;
        result.mostOfOne = Math.max(result.mostOfOne, ...skipsOf.values());
      }

      return result;
    }

    function measure(data: {
      times: Array<ResultTimes>;
      statementsSentAt: Array<number>;
      startAt: number;
      stopAt: number;
      claims: number;
      rounds: Array<{ firstMs: number; lastMs: number }>;
    }): Omit<
      BurstMeasured,
      | "claimsMeasured"
      | "placeInRound"
      | "skips"
      | "skipsHandedOut"
      | "ticksSkipped"
    > {
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
      const gaps: Array<number> = [];

      for (const list of byAssignment.values()) {
        list.sort((a: number, b: number) => {
          return a - b;
        });

        for (let index: number = 1; index < list.length; index++) {
          const between: number = list[index]! - list[index - 1]!;
          longestBetween = Math.max(longestBetween, between);
          gaps.push(between);
        }
      }

      const fromAMinute: Array<number> = gaps.map((gap: number): number => {
        return Math.abs(gap - MINUTE_MS);
      });

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
        betweenChecks: {
          gaps: gaps.length,
          minMs: gaps.length > 0 ? Math.min(...gaps) : 0,
          p5Ms: percentile(gaps, 0.05),
          p50Ms: percentile(gaps, 0.5),
          p95Ms: percentile(gaps, 0.95),
          maxMs: Math.max(0, ...gaps),
          farthestFromAMinuteMs: Math.max(0, ...fromAMinute),
          withinASecondShare:
            gaps.length > 0
              ? fromAMinute.filter((distance: number): boolean => {
                  return distance <= SECOND_MS;
                }).length / gaps.length
              : 0,
        },
        longestRoundMs: Math.max(
          0,
          ...data.rounds.map(
            (round: { firstMs: number; lastMs: number }): number => {
              return round.lastMs - round.firstMs;
            },
          ),
        ),
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
        /*
         * More often than today's asking skips one. Not the longest gap
         * against today's: both are well over a minute and a half, as random
         * as the seconds the probes draw, so which is longer is a coin toss
         * (in two runs for #11333: 108.7 s against 108.2 s, then 92.5 s
         * against 95.3 s; skipped: 635 against 43, then 467 against 0).
         */
        expect(report.checksSkipped).toBeGreaterThan(today.checksSkipped);

        // Where it is evaluated, no calmer than today.
        expect(report.waitForAWorkerMsMax).toBeLessThan(SECOND_MS);
        expect(report.evaluationsAtOnceMax).toBeLessThan(INGEST_WORKERS / 2);
      },
      RUN_TIMEOUT_MS,
    );

    /*
     * #11333: the time between a monitor probe's checks. Before, each worker
     * waited a new random second every minute, so a one-minute monitor's
     * checks were anything from 15 to 105 seconds apart (today's run above).
     * At its own moment of every minute, each worker's checks are a minute
     * apart, give or take how long the probe takes to get through what is
     * due - and the results reach the server as spread as today's.
     */
    test(
      "#11333: each worker at its own moment of the minute, the probes' defaults - a monitor's checks a minute apart, give or take its probe's round, and the results as spread as today's",
      async () => {
        const today: BurstMeasured = measured["today"]!;
        const report: BurstMeasured = await runFleet(
          "own moments of the minute, one worker",
          {
            workers: 1,
            staggerMaxMs: STAGGER_MAX_MS,
            atOwnMoment: false,
            askAtOwnMoment: true,
          },
          11333,
        );

        expect(report.results).toBeGreaterThanOrEqual(
          MONITORS * PROBES * 3 - MONITORS * PROBES * 0.05,
        );
        expect(report.checksSkipped).toBe(0);

        /*
         * A minute apart, give or take the probe's round: one worker with 10
         * check slots takes about 15 s to get through 300 monitors. Where in
         * it a monitor is checked could move from one minute to the next
         * while the claim ordered the monitors due at the same moment by
         * that moment alone; since #11386 it hands them out as the round
         * before did (the #11386 runs below).
         */
        expect(report.betweenChecks.farthestFromAMinuteMs).toBeLessThanOrEqual(
          report.longestRoundMs + GAP_SLACK_MS,
        );
        expect(report.betweenChecks.withinASecondShare).toBeGreaterThan(
          today.betweenChecks.withinASecondShare,
        );

        // Where it is evaluated, as today: no burst, nothing waits for a worker.
        expect(report.resultsPerSecondMax).toBeLessThan(80);
        expect(report.evaluationsAtOnceMax).toBeLessThan(INGEST_WORKERS / 2);
        expect(report.waitForAWorkerMsMax).toBeLessThan(SECOND_MS);
      },
      RUN_TIMEOUT_MS,
    );

    test(
      "#11333: before, with the Helm chart's three workers a probe - each a new random second a minute",
      async () => {
        const report: BurstMeasured = await runFleet(
          "today, three workers",
          { workers: 3, staggerMaxMs: STAGGER_MAX_MS, atOwnMoment: false },
          11334,
        );

        expect(report.checksSkipped).toBe(0);
        // A new random second each minute: checks far from a minute apart.
        expect(report.betweenChecks.farthestFromAMinuteMs).toBeGreaterThan(
          10 * SECOND_MS,
        );
      },
      RUN_TIMEOUT_MS,
    );

    test(
      "#11333: the Helm chart's three workers a probe, each at its own moment - a minute apart, and its workers never ask at once",
      async () => {
        const before: BurstMeasured = measured["today, three workers"]!;
        const report: BurstMeasured = await runFleet(
          "own moments of the minute, three workers",
          {
            workers: 3,
            staggerMaxMs: STAGGER_MAX_MS,
            atOwnMoment: false,
            askAtOwnMoment: true,
          },
          11335,
        );

        expect(report.results).toBeGreaterThanOrEqual(
          MONITORS * PROBES * 3 - MONITORS * PROBES * 0.05,
        );
        expect(report.checksSkipped).toBe(0);
        // A minute apart, give or take a round of three workers' 30 slots.
        expect(report.betweenChecks.farthestFromAMinuteMs).toBeLessThanOrEqual(
          report.longestRoundMs + GAP_SLACK_MS,
        );
        expect(report.betweenChecks.farthestFromAMinuteMs).toBeLessThan(
          10 * SECOND_MS,
        );
        expect(report.betweenChecks.withinASecondShare).toBeGreaterThan(
          before.betweenChecks.withinASecondShare,
        );

        expect(report.evaluationsAtOnceMax).toBeLessThan(INGEST_WORKERS / 2);
        expect(report.waitForAWorkerMsMax).toBeLessThan(SECOND_MS);
      },
      RUN_TIMEOUT_MS,
    );

    /*
     * #11386: WHERE IN ITS PROBE'S ROUND A MONITOR IS HANDED OUT. Every
     * monitor a probe claims is stamped with its next whole minute, so all of
     * a probe's one-minute monitors are due at the same instant, and the
     * claim hands those out in the order it reads them. It read them by
     * when they were due alone, which Postgres answers in the order its
     * index holds rows due at the same instant: where each row's last write
     * put it, which moves as rows are written again. So a busy probe checked
     * a monitor anywhere in its round, somewhere else each minute. These
     * runs tick the workers as FetchList's cron does, and pin each probe's
     * moments, so a run is the same every time it is run.
     */
    test(
      "#11386: one worker a probe (the probe's default), busy - each monitor keeps its place in its probe's round, so its checks are a minute apart",
      async () => {
        const report: BurstMeasured = await runFleet(
          "#11386 one worker a probe",
          {
            workers: 1,
            staggerMaxMs: STAGGER_MAX_MS,
            atOwnMoment: false,
            askAtOwnMoment: true,
            ticksLikeTheCron: true,
            // Rounds of about 16 s from 3 s and 17 s: each ends in its minute.
            offsetsMs: [[3 * SECOND_MS], [17 * SECOND_MS]],
            runForMs: CLAIM_ORDER_RUN_MS,
          },
          11386,
        );

        // Every monitor probe checked in every minute: the probes keep up.
        expect(report.checksSkipped).toBe(0);
        expect(report.ticksSkipped).toBe(0);
        expect(report.longestRoundMs).toBeGreaterThan(10 * SECOND_MS);

        // A monitor's place in its round holds from one minute to the next...
        expect(report.placeInRound.moves).toBeGreaterThan(
          MONITORS * PROBES * 3,
        );
        expect(report.placeInRound.p95Ms).toBeLessThanOrEqual(PLACE_SLACK_MS);
        // ...so its checks are a minute apart, not a minute give or take the round.
        expect(report.betweenChecks.farthestFromAMinuteMs).toBeLessThan(
          report.longestRoundMs / 2,
        );
        expect(report.betweenChecks.p95Ms - MINUTE_MS).toBeLessThanOrEqual(
          PLACE_SLACK_MS,
        );
      },
      CLAIM_ORDER_RUN_TIMEOUT_MS,
    );

    test(
      "#11386: the Helm chart's three workers a probe - each monitor keeps its place in its probe's round",
      async () => {
        const report: BurstMeasured = await runFleet(
          "#11386 three workers a probe",
          {
            workers: 3,
            staggerMaxMs: STAGGER_MAX_MS,
            atOwnMoment: false,
            askAtOwnMoment: true,
            ticksLikeTheCron: true,
            // As ProbeFetchMoments spreads three workers: 15 s apart.
            offsetsMs: [
              [2 * SECOND_MS, 17 * SECOND_MS, 32 * SECOND_MS],
              [9 * SECOND_MS, 24 * SECOND_MS, 39 * SECOND_MS],
            ],
            runForMs: CLAIM_ORDER_RUN_MS,
          },
          11387,
        );

        expect(report.checksSkipped).toBe(0);
        expect(report.ticksSkipped).toBe(0);
        expect(report.placeInRound.moves).toBeGreaterThan(
          MONITORS * PROBES * 3,
        );
        /*
         * A round of about 5 s: its checks before a monitor's hardly vary,
         * so its place holds to well under a second. Handed out anywhere
         * in the round, it moved up to the round's length (5.3 s measured).
         */
        expect(report.placeInRound.maxMs).toBeLessThanOrEqual(2 * SECOND_MS);
        expect(report.betweenChecks.farthestFromAMinuteMs).toBeLessThanOrEqual(
          GAP_SLACK_MS,
        );
        expect(report.betweenChecks.withinASecondShare).toBeGreaterThan(0.95);
      },
      CLAIM_ORDER_RUN_TIMEOUT_MS,
    );

    /*
     * #11386: A PROBE WHOSE ROUND PASSES THE NEXT MINUTE. Its worker asks at
     * 47 s and takes about 16 s, so the monitors it reaches after the minute
     * are stamped with the minute after, and its next round - two minutes on,
     * since the cron's tick at the minute it ran past is skipped - is the
     * first that may hand them out: they miss a minute. Who misses it is the
     * claim's order. Each monitor due at the same moment as others is handed
     * out by when it was handed out last, oldest first, so the ones that
     * waited go first next time and the wait goes round: no monitor misses a
     * second minute before every monitor of its probe has missed one.
     */
    test(
      "#11386: a probe whose round passes the next minute - the monitors that wait for its next round take turns",
      async () => {
        const report: BurstMeasured = await runFleet(
          "#11386 a round past the minute",
          {
            workers: 1,
            staggerMaxMs: STAGGER_MAX_MS,
            atOwnMoment: false,
            askAtOwnMoment: true,
            ticksLikeTheCron: true,
            offsetsMs: [[47 * SECOND_MS], [47 * SECOND_MS]],
            runForMs: FALLING_BEHIND_RUN_MS,
          },
          11388,
        );

        // It falls behind: rounds run past the minute, and monitors miss one.
        expect(report.ticksSkipped).toBeGreaterThan(0);
        expect(report.skipsHandedOut.total).toBeGreaterThan(MONITORS / 10);

        /*
         * The ones the claim makes wait take turns: none waits a second
         * time before every one of its probe's has waited once, and none
         * two minutes running.
         */
        expect(report.skipsHandedOut.againBeforeOthersOnce).toBe(0);
        expect(report.skipsHandedOut.inARow).toBe(0);
        expect(report.skipsHandedOut.monitorProbes).toBe(MONITORS * PROBES);

        /*
         * By when their results land, the same, but for a check handed out
         * just before a minute that finishes after it: it misses that
         * minute by its result alone. So never one monitor more than once
         * beyond its turns, and never two minutes running.
         */
        expect(report.skips.mostOfOne).toBeLessThanOrEqual(
          report.skipsHandedOut.mostOfOne + 1,
        );
        expect(report.skips.inARow).toBe(0);
      },
      CLAIM_ORDER_RUN_TIMEOUT_MS * 2,
    );
  },
);
