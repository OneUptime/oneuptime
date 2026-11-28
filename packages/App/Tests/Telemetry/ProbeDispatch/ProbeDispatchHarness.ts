import {
  AppReplicaMessage,
  AppReplicaSample,
  AppReplicaStats,
} from "./ProbeDispatchAppReplica";
import ConnectionBalancer from "./ProbeDispatchConnectionBalancer";
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
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
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
  /*
   * A busier system than this one: each App replica's statements answer
   * this much later (a database under load), and this share of each
   * replica's event loop goes to other work (the results, telemetry and
   * jobs an App pod also handles).
   */
  statementLatencyMs: number;
  busyPercent: number;
  /*
   * How the probes' requests reach the App replicas (issue #11121):
   * "request", each to a replica picked at random on a connection of its
   * own, as the benchmark always did; or "connection", over kept-alive
   * connections to one Service address that sends each new connection to
   * a replica picked at random, as kube-proxy does (ConnectionBalancer).
   */
  balance?: "request" | "connection" | undefined;
  // The balancer's port (0: any), for a front origin configured to it.
  balancerPort?: number | undefined;
  /*
   * Where the probes send instead of the balancer: an nginx in front of it,
   * as probes outside the cluster reach the App; null: the balancer.
   */
  frontOrigin?: string | null | undefined;
  /*
   * Replicas started with the others but sent connections only from
   * `laterAtMs` into the run: the pods KEDA adds, once Ready.
   */
  laterAppReplicas?: number | undefined;
  laterAtMs?: number | undefined;
  // Whether each check sends its result, on the probe's connections.
  postResults?: boolean | undefined;
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

// Five seconds of a run.
export interface TimelinePoint {
  atSecond: number;
  handedOutPerSecond: number;
  due: number;
  busyAnswers: number;
}

/*
 * One minute of a scheduled run: its monitors come due at once on the
 * minute, and this is how long it took to hand them all out.
 */
export interface MinuteDispatch {
  // Seconds into the run the minute started.
  atSecond: number;
  // The most due at once after it started.
  peakDue: number;
  // Seconds until no more than 1% of that was still due; null: not by the end.
  handedOutWithinSeconds: number | null;
}

// A few seconds of each replica's work (issue #11121).
export interface ReplicaTimelinePoint {
  atSecond: number;
  replicas: Array<{
    replica: number;
    answeredPerSecond: number;
    // Averages over the window's samples.
    running: number;
    waiting: number;
    connectionsOpen: number;
    connectionsAcceptedInWindow: number;
    closingAnswersInWindow: number;
  }>;
}

export interface ProbeDispatchRun {
  minutes: Array<MinuteDispatch>;
  assignments: number;
  // How long the App replicas took to start (ts-node loads their code).
  replicasStartedInMs: number;
  timeline: Array<TimelinePoint>;
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
    /*
     * Of those, the ones answered while more than a tenth of the backlog
     * the run started with was still due - a second short of the sample
     * that said it was not: a worker sent away for nothing (#10819).
     */
    shortBeforeDrained: number;
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
  /*
   * Each App replica, every few seconds (issue #11121): its fetches
   * answered a second, its scheduling requests running and waiting, its
   * connections. Empty unless sampled.
   */
  replicaTimeline: Array<ReplicaTimelinePoint>;
  // Connections the balancer sent to each replica.
  connectionsSentToReplicas: Record<string, number>;
  // When the later replicas were sent connections from, into the run.
  laterAtSecond: number | null;
  laterReplicas: Array<number>;
  resultsPosted: number;
  resultsFailed: number;
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

/*
 * A probe asks for tests every ten seconds: one asked for this close to the
 * run's end may simply not have met a tick.
 */
const TEST_GRACE_MS: number = 12 * 1000;

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
  private pendingSamples: Map<number, (sample: AppReplicaSample) => void> =
    new Map<number, (sample: AppReplicaSample) => void>();
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

          if (typed.type === "sample" && typed.id !== undefined) {
            this.pendingSamples.get(typed.id)?.(
              (message as { sample: AppReplicaSample }).sample,
            );
            this.pendingSamples.delete(typed.id);
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

  public sample(): Promise<AppReplicaSample> {
    const id: number = this.nextId++;

    return new Promise<AppReplicaSample>(
      (resolve: (sample: AppReplicaSample) => void): void => {
        this.pendingSamples.set(id, resolve);
        this.send({ type: "sample", id });
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
  const laterAppReplicas: number = Math.max(0, options.laterAppReplicas || 0);
  let balancer: ConnectionBalancer | null = null;
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
      PROBE_DISPATCH_STATEMENT_LATENCY_MS: String(options.statementLatencyMs),
      PROBE_DISPATCH_BUSY_PERCENT: String(options.busyPercent),
      ...options.appEnvironment,
    };

    const replicasStartingAt: number = Date.now();

    for (
      let index: number = 0;
      index < options.appReplicas + laterAppReplicas;
      index++
    ) {
      replicas.push(new AppReplica(index, environment));
    }

    await Promise.all(
      replicas.map((replica: AppReplica): Promise<void> => {
        return replica.ready;
      }),
    );

    const replicasStartedInMs: number = Date.now() - replicasStartingAt;

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

    /*
     * Connections balanced as kube-proxy does: the first replicas are the
     * Service's endpoints from the start, the later ones once Ready.
     */
    let keepAliveOrigin: string | null = null;

    if (options.balance === "connection") {
      balancer = new ConnectionBalancer(seededRandom(options.seed + 1));

      for (let index: number = 0; index < options.appReplicas; index++) {
        balancer.addEndpoint({
          replica: index,
          port: replicas[index]!.port,
        });
      }

      const balancerPort: number = await balancer.start(
        options.balancerPort || 0,
      );
      keepAliveOrigin =
        options.frontOrigin || `http://127.0.0.1:${balancerPort}`;
    }

    fleet = new SimulatedProbeFleet({
      probeIds: seeded.probeIds,
      replicasPerProbe: options.probeReplicas,
      workersPerReplica: options.workers,
      fetchLimit: options.fetchLimit,
      checkMs: options.checkMs,
      staggerMaxMs: options.staggerMaxMs,
      appOrigins: replicas
        .slice(0, options.appReplicas)
        .map((replica: AppReplica): string => {
          return replica.origin;
        }),
      keepAliveOrigin: keepAliveOrigin,
      postResults: Boolean(options.postResults),
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

    const samples: Array<{ atMs: number; samples: Array<AppReplicaSample> }> =
      [];
    let sampling: boolean = false;

    timers.push(
      setInterval((): void => {
        if (sampling) {
          return;
        }

        sampling = true;
        const atMs: number = Date.now() - startedAt;

        Promise.all(
          replicas.map((replica: AppReplica): Promise<AppReplicaSample> => {
            return replica.sample();
          }),
        )
          .then((replicaSamples: Array<AppReplicaSample>): void => {
            samples.push({ atMs: atMs, samples: replicaSamples });
          })
          .catch((): void => {
            // A missed sample.
          })
          .finally((): void => {
            sampling = false;
          });
      }, 1000),
    );

    let laterAtMs: number | null = null;

    if (laterAppReplicas > 0) {
      const later: number = Math.max(0, options.laterAtMs || 0);

      timers.push(
        setTimeout((): void => {
          laterAtMs = Date.now() - startedAt;

          for (
            let index: number = options.appReplicas;
            index < replicas.length;
            index++
          ) {
            if (balancer) {
              balancer.addEndpoint({
                replica: index,
                port: replicas[index]!.port,
              });
            } else {
              fleet!.options.appOrigins.push(replicas[index]!.origin);
            }
          }
        }, later) as unknown as ReturnType<typeof setInterval>,
      );
    }

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

    fleet.destroyConnections();

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

    const mostlyDrained: BacklogSample | undefined = backlog.find(
      (backlogSample: BacklogSample): boolean => {
        return backlogSample.initialRemaining <= initialBacklog * 0.1;
      },
    );
    const backlogUntilMs: number = mostlyDrained
      ? mostlyDrained.atMs - 1000
      : Date.now() - startedAt;

    const shortBeforeDrained: number = okFetches.filter(
      (fetchRecord: FetchRecord): boolean => {
        return (
          fetchRecord.handed < fetchRecord.asked &&
          fetchRecord.at + fetchRecord.ms - startedAt < backlogUntilMs
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

      if (handedAt !== undefined) {
        testWaits.push(handedAt - createdAt);
        continue;
      }

      /*
       * A test asked for in the run's last seconds may not have met a probe
       * tick yet: it is not counted against the run.
       */
      if (startedAt + durationMs - createdAt > TEST_GRACE_MS) {
        neverHandedOut++;
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

    const minutes: Array<MinuteDispatch> = [];

    for (
      let minuteAt: number = Math.ceil(startedAt / 60_000) * 60_000;
      minuteAt < startedAt + durationMs;
      minuteAt += 60_000
    ) {
      const atMs: number = minuteAt - startedAt;
      const nextMs: number = atMs + 60_000;
      const within: Array<BacklogSample> = backlog.filter(
        (backlogSample: BacklogSample): boolean => {
          return backlogSample.atMs >= atMs && backlogSample.atMs < nextMs;
        },
      );
      const peakDue: number = within.reduce(
        (peak: number, backlogSample: BacklogSample): number => {
          return Math.max(peak, backlogSample.due);
        },
        0,
      );
      const peakAt: number = within.findIndex(
        (backlogSample: BacklogSample): boolean => {
          return backlogSample.due === peakDue;
        },
      );
      const cleared: BacklogSample | undefined = within
        .slice(Math.max(0, peakAt))
        .find((backlogSample: BacklogSample): boolean => {
          return backlogSample.due <= peakDue * 0.01;
        });

      minutes.push({
        atSecond: Math.round(atMs / 1000),
        peakDue: peakDue,
        handedOutWithinSeconds: cleared
          ? Math.round((cleared.atMs - atMs) / 1000)
          : null,
      });
    }

    const timeline: Array<TimelinePoint> = [];

    for (let second: number = 0; second < perSecond.length; second += 5) {
      const handed: number = perSecond
        .slice(second, second + 5)
        .reduce((sum: number, count: number): number => {
          return sum + count;
        }, 0);
      const sampleAt: BacklogSample | undefined = backlog.find(
        (backlogSample: BacklogSample): boolean => {
          return backlogSample.atMs >= (second + 5) * 1000;
        },
      );

      timeline.push({
        atSecond: second,
        handedOutPerSecond: Math.round(handed / 5),
        due: sampleAt ? sampleAt.due : 0,
        busyAnswers: fetches.filter((fetchRecord: FetchRecord): boolean => {
          const at: number = (fetchRecord.at - startedAt) / 1000;
          return (
            fetchRecord.outcome === "busy" && at >= second && at < second + 5
          );
        }).length,
      });
    }

    const replicaTimeline: Array<ReplicaTimelinePoint> = [];

    for (let atMs: number = 0; atMs < durationMs; atMs += 5000) {
      const window: Array<{
        atMs: number;
        samples: Array<AppReplicaSample>;
      }> = samples.filter((sample: { atMs: number }): boolean => {
        return sample.atMs >= atMs && sample.atMs < atMs + 5000;
      });
      const before: { atMs: number; samples: Array<AppReplicaSample> } | null =
        samples
          .filter((sample: { atMs: number }): boolean => {
            return sample.atMs < atMs;
          })
          .pop() || null;
      const last: { atMs: number; samples: Array<AppReplicaSample> } | null =
        window[window.length - 1] || null;

      if (!last) {
        continue;
      }

      const seconds: number = Math.max(
        1,
        (last.atMs - (before ? before.atMs : 0)) / 1000,
      );

      replicaTimeline.push({
        atSecond: Math.round(atMs / 1000),
        replicas: last.samples.map((sample: AppReplicaSample) => {
          const earlier: AppReplicaSample | undefined = before?.samples.find(
            (candidate: AppReplicaSample): boolean => {
              return candidate.replica === sample.replica;
            },
          );
          const mean: (pick: (one: AppReplicaSample) => number) => number = (
            pick: (one: AppReplicaSample) => number,
          ): number => {
            const values: Array<number> = window
              .map((entry: { samples: Array<AppReplicaSample> }) => {
                return entry.samples.find(
                  (candidate: AppReplicaSample): boolean => {
                    return candidate.replica === sample.replica;
                  },
                );
              })
              .filter(Boolean)
              .map((one: AppReplicaSample | undefined): number => {
                return pick(one!);
              });

            return values.length === 0
              ? 0
              : Math.round(
                  (values.reduce((sum: number, value: number): number => {
                    return sum + value;
                  }, 0) /
                    values.length) *
                    10,
                ) / 10;
          };

          return {
            replica: sample.replica,
            answeredPerSecond:
              Math.round(
                ((sample.monitorListAnswered -
                  (earlier?.monitorListAnswered || 0)) /
                  seconds) *
                  10,
              ) / 10,
            running: mean((one: AppReplicaSample): number => {
              return one.running;
            }),
            waiting: mean((one: AppReplicaSample): number => {
              return one.waiting;
            }),
            connectionsOpen: mean((one: AppReplicaSample): number => {
              return one.connectionsOpen;
            }),
            connectionsAcceptedInWindow:
              sample.connectionsAccepted - (earlier?.connectionsAccepted || 0),
            closingAnswersInWindow:
              sample.closingAnswers - (earlier?.closingAnswers || 0),
          };
        }),
      });
    }

    return {
      replicaTimeline: replicaTimeline,
      connectionsSentToReplicas: balancer
        ? Object.fromEntries(
            Array.from(balancer.connectionsSent.entries()).map(
              ([replica, count]: [number, number]): [string, number] => {
                return [String(replica), count];
              },
            ),
          )
        : {},
      laterAtSecond:
        laterAtMs === null ? null : Math.round((laterAtMs as number) / 1000),
      laterReplicas: Array.from(
        { length: laterAppReplicas },
        (_value: unknown, index: number): number => {
          return options.appReplicas + index;
        },
      ),
      resultsPosted: fleet.resultsPosted,
      resultsFailed: fleet.resultsFailed,
      assignments: seeded.assignments,
      replicasStartedInMs: replicasStartedInMs,
      timeline: timeline,
      minutes: minutes,
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
        shortBeforeDrained: shortBeforeDrained,
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
    fleet?.destroyConnections();

    await balancer?.stop().catch((): void => {
      // Already stopped.
    });

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
