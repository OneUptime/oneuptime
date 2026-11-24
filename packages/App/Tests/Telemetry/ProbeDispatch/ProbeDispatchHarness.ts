import { AppReplicaMessage, AppReplicaStats } from "./ProbeDispatchAppReplica";
import {
  ProbeDispatchFleetOptions,
  RunSql,
  SeededFleet,
  benchmarkSchemaName,
  createFleetSchema,
  createMonitorTest,
  dropFleetSchema,
  scheduleFleet,
  seedFleet,
} from "./ProbeDispatchFleet";
import SimulatedProbeFleet, {
  FetchRecord,
  TestHandOut,
} from "./ProbeDispatchProbes";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import { ChildProcess, fork } from "child_process";
import path from "path";
import { IntervalHistogram, monitorEventLoopDelay } from "perf_hooks";

/*
 * THE PROBE DISPATCH BENCHMARK, RUN (issue #10819).
 *
 * Seeds the issue's fleet into a schema of its own (ProbeDispatchFleet),
 * starts `appReplicas` App replicas (ProbeDispatchAppReplica: the real
 * routes, limit and services, each with its own pool and its own limit, as
 * pods have) and the probes' replicas (ProbeDispatchProbes), and lets them
 * run for `durationMs`. Meanwhile it writes a "Test monitor" run every
 * `testsEveryMs`, as people on the Dashboard do, and reads, every second,
 * how many assignments are due and how long the oldest has waited - how late
 * monitors are handed out. Then it gathers what each replica measured, and
 * drops the schema.
 *
 * Postgres is the App's own, from DATABASE_* (config.env): it must be
 * migrated to the current head, as the Postgres Schema Drift workflow's
 * database is.
 */

export interface ProbeDispatchBenchmarkOptions {
  fleet: ProbeDispatchFleetOptions;
  appReplicas: number;
  // DATABASE_MAX_OPEN_CONNECTIONS of each App replica.
  poolSize: number;
  // PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS of each, when set.
  probeSchedulingMaxConcurrentRequests: number | null;
  probeReplicas: number;
  workers: number;
  fetchLimit: number;
  checkMs: { min: number; max: number };
  staggerMaxMs: number;
  durationMs: number;
  // A Test Monitor run this often, for a probe in turn; 0 for none.
  testsEveryMs: number;
  seed: number;
  // Where a CPU profile of each App replica is written, when asked.
  profileDirectory: string | null;
  // More settings for the App replicas.
  appEnvironment: Record<string, string>;
  // The scheduling metrics route each replica is read through, when any.
  metricsPath: string | null;
}

export interface Distribution {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface BacklogSample {
  atMs: number;
  due: number;
  oldestDueAgeMs: number;
  // Of the assignments due when the run started, those still not handed out.
  initialRemaining: number;
}

export interface ProbeDispatchRun {
  assignments: number;
  checksPerMinute: number;
  durationMs: number;
  monitorsHandedOut: number;
  monitorsPerSecond: number;
  // The best five seconds.
  peakMonitorsPerSecond: number;
  initialBacklog: number;
  // When the assignments due at the start had all been handed out.
  drainedAtMs: number | null;
  // How long until 95% of them had been.
  drained95AtMs: number | null;
  backlog: Array<BacklogSample>;
  oldestDueAgeMs: Distribution;
  monitorFetches: {
    total: number;
    outcomes: Record<string, number>;
    full: number;
    short: number;
    empty: number;
    latencyMs: Distribution;
    /*
     * Of the fetches answered with fewer monitors than asked for while
     * monitors were due: a worker that stops until the next minute.
     */
    shortWhileDue: number;
  };
  tests: {
    created: number;
    handedOut: number;
    waitMs: Distribution;
    // Created but never handed out before the run ended.
    neverHandedOut: number;
    fetchOutcomes: Record<string, number>;
  };
  replicas: Array<AppReplicaStats>;
  harnessEventLoopDelayP99Ms: number;
  topStatements: Array<{
    statement: string;
    calls: number;
    totalMs: number;
    meanMs: number;
    rows: number;
  }>;
}

const APP_ROOT: string = path.resolve(__dirname, "..", "..", "..");
const REPLICA_ENTRY: string = path.join(
  __dirname,
  "ProbeDispatchAppReplica.ts",
);
// ts-node loads the App's code at start: minutes on a busy machine.
const REPLICA_STARTUP_TIMEOUT_MS: number = 10 * 60 * 1000;

export function distribution(values: Array<number>): Distribution {
  if (values.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }

  const sorted: Array<number> = values.slice().sort((a: number, b: number) => {
    return a - b;
  });
  const at: (fraction: number) => number = (fraction: number): number => {
    return sorted[
      Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
    ]!;
  };
  const total: number = sorted.reduce((sum: number, value: number) => {
    return sum + value;
  }, 0);

  return {
    count: sorted.length,
    p50: Math.round(at(0.5)),
    p95: Math.round(at(0.95)),
    p99: Math.round(at(0.99)),
    max: Math.round(sorted[sorted.length - 1]!),
    mean: Math.round(total / sorted.length),
  };
}

function sqlRunner(): RunSql {
  return async (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    const rows: unknown = await PostgresAppInstance.getDataSource()!.query(
      sql,
      parameters,
    );
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  };
}

class AppReplica {
  private child: ChildProcess;
  private pending: Map<number, (stats: AppReplicaStats) => void> = new Map<
    number,
    (stats: AppReplicaStats) => void
  >();
  private nextId: number = 1;
  private waiters: Map<string, Array<() => void>> = new Map<
    string,
    Array<() => void>
  >();
  public port: number = 0;
  public readonly ready: Promise<void>;

  public constructor(index: number, environment: Record<string, string>) {
    this.child = fork(REPLICA_ENTRY, [], {
      cwd: APP_ROOT,
      execArgv: ["--max-old-space-size=2048", "--require", "ts-node/register"],
      env: {
        ...process.env,
        ...environment,
        PROBE_DISPATCH_REPLICA: String(index),
        TS_NODE_TRANSPILE_ONLY: "1",
        TS_NODE_PROJECT: path.join(APP_ROOT, "tsconfig.json"),
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });

    let errorOutput: string = "";
    this.child.stderr?.on("data", (chunk: Buffer): void => {
      errorOutput = (errorOutput + chunk.toString()).slice(-8000);
    });

    this.ready = new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {
        const startup: ReturnType<typeof setTimeout> = setTimeout((): void => {
          reject(
            new Error(
              `App replica ${index} was not ready within ${REPLICA_STARTUP_TIMEOUT_MS / 1000} s: ${errorOutput}`,
            ),
          );
        }, REPLICA_STARTUP_TIMEOUT_MS);

        this.child.once("exit", (code: number | null): void => {
          clearTimeout(startup);
          reject(
            new Error(
              `App replica ${index} exited (${String(code)}) before it was ready: ${errorOutput}`,
            ),
          );
        });

        this.child.on("message", (message: unknown): void => {
          const typed: { type?: string; port?: number; id?: number } =
            message as { type?: string; port?: number; id?: number };

          if (typed.type === "ready") {
            clearTimeout(startup);
            this.port = typed.port || 0;
            resolve();
            return;
          }

          if (typed.type === "stats" && typed.id !== undefined) {
            this.pending.get(typed.id)?.(
              (message as { stats: AppReplicaStats }).stats,
            );
            this.pending.delete(typed.id);
            return;
          }

          for (const done of this.waiters.get(typed.type || "") || []) {
            done();
          }
          this.waiters.delete(typed.type || "");
        });
      },
    );
  }

  public get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private send(message: AppReplicaMessage): void {
    this.child.send(message);
  }

  private request(message: AppReplicaMessage, reply: string): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      const list: Array<() => void> = this.waiters.get(reply) || [];
      list.push(resolve);
      this.waiters.set(reply, list);
      this.send(message);
    });
  }

  public reset(): Promise<void> {
    return this.request({ type: "reset" }, "reset-done");
  }

  public startProfile(): Promise<void> {
    return this.request({ type: "profile-start" }, "profile-started");
  }

  public stopProfile(file: string): Promise<void> {
    return this.request({ type: "profile-stop", file }, "profile-stopped");
  }

  public stats(): Promise<AppReplicaStats> {
    const id: number = this.nextId++;

    return new Promise<AppReplicaStats>(
      (resolve: (stats: AppReplicaStats) => void): void => {
        this.pending.set(id, resolve);
        this.send({ type: "stats", id });
      },
    );
  }

  public stop(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      if (this.child.exitCode !== null) {
        resolve();
        return;
      }

      const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
        this.child.kill("SIGKILL");
      }, 10_000);

      this.child.once("exit", (): void => {
        clearTimeout(timer);
        resolve();
      });

      this.send({ type: "stop" });
    });
  }
}

async function readTopStatements(
  sql: RunSql,
): Promise<ProbeDispatchRun["topStatements"]> {
  try {
    const rows: Array<Record<string, unknown>> = await sql(
      `SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS statement,
              calls, total_exec_time AS "totalMs", mean_exec_time AS "meanMs",
              rows
       FROM pg_stat_statements
       WHERE query ILIKE '%Monitor%'
       ORDER BY total_exec_time DESC
       LIMIT 12`,
    );

    return rows.map((row: Record<string, unknown>) => {
      return {
        statement: String(row["statement"]),
        calls: Number(row["calls"]),
        totalMs: Math.round(Number(row["totalMs"])),
        meanMs: Math.round(Number(row["meanMs"]) * 100) / 100,
        rows: Number(row["rows"]),
      };
    });
  } catch {
    // pg_stat_statements is not loaded on this server.
    return [];
  }
}

export async function runProbeDispatchBenchmark(
  options: ProbeDispatchBenchmarkOptions,
): Promise<ProbeDispatchRun> {
  if (!PostgresAppInstance.isConnected()) {
    await PostgresAppInstance.connect();
  }

  const sql: RunSql = sqlRunner();
  const schema: string = benchmarkSchemaName();
  const replicas: Array<AppReplica> = [];
  let fleet: SimulatedProbeFleet | null = null;
  const timers: Array<ReturnType<typeof setInterval>> = [];

  try {
    await createFleetSchema(sql, schema);
    const seeded: SeededFleet = await seedFleet(sql, schema, options.fleet);
    const projectIds: Array<string> = (
      await sql(`SELECT "_id"::text AS id FROM "${schema}"."Project"`)
    ).map((row: Record<string, unknown>): string => {
      return String(row["id"]);
    });

    const environment: Record<string, string> = {
      // This schema's tables first, everything else from the migrated ones.
      PGOPTIONS: `-c search_path=${schema},public -c jit=off`,
      // So node-postgres sends PGOPTIONS (DataSourceOptions sends its own).
      DATABASE_IDLE_SESSION_TIMEOUT_MS: "0",
      RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
      DATABASE_MAX_OPEN_CONNECTIONS: String(options.poolSize),
      LOG_LEVEL: "ERROR",
      DISABLE_TELEMETRY: "true",
      ...(options.probeSchedulingMaxConcurrentRequests
        ? {
            PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS: String(
              options.probeSchedulingMaxConcurrentRequests,
            ),
          }
        : {}),
      ...(options.metricsPath
        ? { PROBE_DISPATCH_METRICS_PATH: options.metricsPath }
        : {}),
      ...options.appEnvironment,
    };

    for (let index: number = 0; index < options.appReplicas; index++) {
      replicas.push(new AppReplica(index, environment));
    }

    await Promise.all(
      replicas.map((replica: AppReplica): Promise<void> => {
        return replica.ready;
      }),
    );

    // Warm each replica up: its first requests load and compile code.
    for (const replica of replicas) {
      for (const probeId of seeded.probeIds.slice(0, 1)) {
        await fetch(`${replica.origin}/probe-ingest/monitor-test/list`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ probeId: probeId, limit: 1 }),
        }).catch((): void => {
          // Measured below if it matters.
        });
      }
    }

    await Promise.all(
      replicas.map((replica: AppReplica): Promise<void> => {
        return replica.reset();
      }),
    );

    // The schedule, from now: the replicas' start-up ages nothing.
    await scheduleFleet(sql, schema, options.fleet.schedule);

    await sql(`SELECT pg_stat_statements_reset()`).catch((): void => {
      // Not loaded on this server.
    });

    if (options.profileDirectory) {
      await Promise.all(
        replicas.map((replica: AppReplica): Promise<void> => {
          return replica.startProfile();
        }),
      );
    }

    const harnessDelay: IntervalHistogram = monitorEventLoopDelay({
      resolution: 10,
    });
    harnessDelay.enable();

    const startedAt: number = Date.now();
    const runStart: Date = new Date(startedAt);
    const initialBacklog: number = Number(
      (
        await sql(
          `SELECT count(*)::int AS due FROM "${schema}"."MonitorProbe"
           WHERE "isEnabled" = true AND "nextPingAt" <= $1`,
          [runStart],
        )
      )[0]?.["due"] || 0,
    );

    fleet = new SimulatedProbeFleet({
      probeIds: seeded.probeIds,
      replicasPerProbe: options.probeReplicas,
      workersPerReplica: options.workers,
      fetchLimit: options.fetchLimit,
      checkMs: options.checkMs,
      staggerMaxMs: options.staggerMaxMs,
      appOrigins: replicas.map((replica: AppReplica): string => {
        return replica.origin;
      }),
      requestTimeoutMs: 45_000,
      testPollEveryMs: 10_000,
      seed: options.seed,
    });

    const testsCreated: Map<string, number> = new Map<string, number>();
    let testTurn: number = 0;

    if (options.testsEveryMs > 0) {
      timers.push(
        setInterval((): void => {
          const probe: number = testTurn % seeded.probeIds.length;
          const createdAt: number = Date.now();
          testTurn++;

          createMonitorTest(sql, schema, {
            probeId: seeded.probeIds[probe]!,
            projectId: projectIds[probe % projectIds.length]!,
          })
            .then((id: string): void => {
              testsCreated.set(id, createdAt);
            })
            .catch((): void => {
              // A test that could not be written is not measured.
            });
        }, options.testsEveryMs),
      );
    }

    const backlog: Array<BacklogSample> = [];

    const sample: () => Promise<void> = async (): Promise<void> => {
      const row: Record<string, unknown> | undefined = (
        await sql(
          `SELECT count(*) FILTER (WHERE "nextPingAt" <= now())::int AS due,
                  COALESCE(EXTRACT(EPOCH FROM now() - min("nextPingAt")
                    FILTER (WHERE "nextPingAt" <= now())) * 1000, 0) AS "oldestMs",
                  count(*) FILTER (WHERE "nextPingAt" <= $1)::int AS "initialRemaining"
           FROM "${schema}"."MonitorProbe"
           WHERE "isEnabled" = true`,
          [runStart],
        )
      )[0];

      backlog.push({
        atMs: Date.now() - startedAt,
        due: Number(row?.["due"] || 0),
        oldestDueAgeMs: Math.round(Number(row?.["oldestMs"] || 0)),
        initialRemaining: Number(row?.["initialRemaining"] || 0),
      });
    };

    timers.push(
      setInterval((): void => {
        sample().catch((): void => {
          // A missed sample.
        });
      }, 1000),
    );

    fleet.start();

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, options.durationMs);
    });

    for (const timer of timers.splice(0)) {
      clearInterval(timer);
    }

    fleet.stop();
    const durationMs: number = Date.now() - startedAt;
    harnessDelay.disable();

    // The answers still on their way.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 2000);
    });

    if (options.profileDirectory) {
      await Promise.all(
        replicas.map((replica: AppReplica, index: number): Promise<void> => {
          return replica.stopProfile(
            path.join(
              options.profileDirectory!,
              `probe-dispatch-app-replica-${index + 1}.cpuprofile`,
            ),
          );
        }),
      );
    }

    const replicaStats: Array<AppReplicaStats> = await Promise.all(
      replicas.map((replica: AppReplica): Promise<AppReplicaStats> => {
        return replica.stats();
      }),
    );

    const topStatements: ProbeDispatchRun["topStatements"] =
      await readTopStatements(sql);

    const fetches: Array<FetchRecord> = fleet.monitorFetches;
    const outcomes: Record<string, number> = {};

    for (const fetchRecord of fetches) {
      outcomes[fetchRecord.outcome] = (outcomes[fetchRecord.outcome] || 0) + 1;
    }

    const okFetches: Array<FetchRecord> = fetches.filter(
      (fetchRecord: FetchRecord): boolean => {
        return fetchRecord.outcome === "ok";
      },
    );

    // Whether assignments were due when a fetch was answered short.
    const dueAt: (atMs: number) => number = (atMs: number): number => {
      let due: number = 0;

      for (const backlogSample of backlog) {
        if (backlogSample.atMs > atMs) {
          break;
        }
        due = backlogSample.due;
      }

      return due;
    };

    const shortWhileDue: number = okFetches.filter(
      (fetchRecord: FetchRecord): boolean => {
        return (
          fetchRecord.handed < fetchRecord.asked &&
          dueAt(fetchRecord.at + fetchRecord.ms - startedAt) >
            fetchRecord.asked * 4
        );
      },
    ).length;

    const testOutcomes: Record<string, number> = {};

    for (const fetchRecord of fleet.testFetches) {
      testOutcomes[fetchRecord.outcome] =
        (testOutcomes[fetchRecord.outcome] || 0) + 1;
    }

    const firstHandOut: Map<string, number> = new Map<string, number>();

    for (const handOut of fleet.testsHandedOut as Array<TestHandOut>) {
      if (!firstHandOut.has(handOut.testId)) {
        firstHandOut.set(handOut.testId, handOut.at);
      }
    }

    const testWaits: Array<number> = [];
    let neverHandedOut: number = 0;

    for (const [id, createdAt] of testsCreated.entries()) {
      const handedAt: number | undefined = firstHandOut.get(id);

      if (handedAt === undefined) {
        neverHandedOut++;
      } else {
        testWaits.push(handedAt - createdAt);
      }
    }

    const perSecond: Array<number> = fleet.handedOutPerSecond;
    let peak: number = 0;

    for (let second: number = 0; second + 5 <= perSecond.length; second++) {
      const window: number = perSecond
        .slice(second, second + 5)
        .reduce((sum: number, count: number): number => {
          return sum + count;
        }, 0);
      peak = Math.max(peak, window / 5);
    }

    const drained: BacklogSample | undefined = backlog.find(
      (backlogSample: BacklogSample): boolean => {
        return backlogSample.initialRemaining === 0;
      },
    );
    const drained95: BacklogSample | undefined = backlog.find(
      (backlogSample: BacklogSample): boolean => {
        return backlogSample.initialRemaining <= initialBacklog * 0.05;
      },
    );

    return {
      assignments: seeded.assignments,
      checksPerMinute: seeded.checksPerMinute,
      durationMs: durationMs,
      monitorsHandedOut: fleet.monitorsHandedOut,
      monitorsPerSecond: Math.round(
        fleet.monitorsHandedOut / (durationMs / 1000),
      ),
      peakMonitorsPerSecond: Math.round(peak),
      initialBacklog: initialBacklog,
      drainedAtMs: drained ? drained.atMs : null,
      drained95AtMs: drained95 ? drained95.atMs : null,
      backlog: backlog,
      oldestDueAgeMs: distribution(
        backlog.map((backlogSample: BacklogSample): number => {
          return backlogSample.oldestDueAgeMs;
        }),
      ),
      monitorFetches: {
        total: fetches.length,
        outcomes: outcomes,
        full: okFetches.filter((fetchRecord: FetchRecord): boolean => {
          return fetchRecord.handed >= fetchRecord.asked;
        }).length,
        short: okFetches.filter((fetchRecord: FetchRecord): boolean => {
          return (
            fetchRecord.handed > 0 && fetchRecord.handed < fetchRecord.asked
          );
        }).length,
        empty: okFetches.filter((fetchRecord: FetchRecord): boolean => {
          return fetchRecord.handed === 0;
        }).length,
        latencyMs: distribution(
          fetches.map((fetchRecord: FetchRecord): number => {
            return fetchRecord.ms;
          }),
        ),
        shortWhileDue: shortWhileDue,
      },
      tests: {
        created: testsCreated.size,
        handedOut: testWaits.length,
        waitMs: distribution(testWaits),
        neverHandedOut: neverHandedOut,
        fetchOutcomes: testOutcomes,
      },
      replicas: replicaStats,
      harnessEventLoopDelayP99Ms:
        Math.round((harnessDelay.percentile(99) / 1e6) * 100) / 100,
      topStatements: topStatements,
    };
  } finally {
    for (const timer of timers) {
      clearInterval(timer);
    }

    fleet?.stop();

    await Promise.all(
      replicas.map((replica: AppReplica): Promise<void> => {
        return replica.stop().catch((): void => {
          // Already gone.
        });
      }),
    );

    await dropFleetSchema(sql, schema).catch((): void => {
      // Left for whoever cleans the database.
    });
  }
}
