/*
 * HANDING MONITORS OUT TO PROBES AT THE SCALE OF ISSUE #10819, MEASURED.
 *
 * Run from packages/App, with config.env's DATABASE_* pointing at a Postgres
 * migrated to the current head:
 *
 *   node --require ts-node/register/transpile-only \
 *     scripts/benchmark-probe-dispatch.ts [--seconds 60] [--runs 1]
 *
 * The issue's install - 28,200 one-minute and 11,500 five-minute monitor
 * assignments - over `--probes` probes, each run as `--probe-replicas`
 * replicas of `--workers` workers asking for `--fetch-limit` monitors a time
 * (the Helm chart's 3 and 10 by default), against `--app-replicas` App
 * replicas: the real /monitor/list and /monitor-test/list, the real probe
 * scheduling limit and the real claim statements, each replica a process
 * with its own Postgres pool of `--pool` connections
 * (ProbeDispatchHarness). With `--schedule due` (the default) every
 * assignment is due when the run starts, and the run measures how fast the
 * probes are handed them; `--schedule scheduled` has them due as a running
 * install has them, each minute's at once. A "Test monitor" run is asked
 * for every `--tests-every-ms`.
 *
 * It reports monitors handed out a second, how long the backlog took to
 * drain, the probes' fetches (full, short, empty, busy) and their latency,
 * how long each test waited to be handed out, and where each App replica's
 * time went: each statement, the wait for a pool connection, the wait for a
 * scheduling slot, its CPU and its event loop. `--json` prints one line a
 * test can read (ProbeDispatchThroughputPostgres.test.ts); `--profile-dir
 * <dir>` writes a CPU profile of each App replica
 * (Scripts/Perf/profile-summary.js summarises one). pg_stat_statements, if
 * the server loads it, adds the statements' own times.
 *
 * Settings for the App replicas go in as `--app-env NAME=value`. A busier
 * system than the machine it runs on: `--statement-latency-ms <n>` answers
 * every statement of an App replica n ms later, as a database under load
 * does, and `--app-busy-percent <n>` gives n% of each replica's event loop
 * to other work, as the results, telemetry and jobs an App pod also
 * handles do.
 */
import {
  ProbeDispatchBenchmarkOptions,
  ProbeDispatchRun,
  runProbeDispatchBenchmark,
} from "../Tests/Telemetry/ProbeDispatch/ProbeDispatchHarness";
import { TimingSummary } from "../Tests/Telemetry/ProbeDispatch/ProbeDispatchAppReplica";
import { ISSUE_10819_FLEET } from "../Tests/Telemetry/ProbeDispatch/ProbeDispatchFleet";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import { JSONObject } from "Common/Types/JSON";
import path from "path";

export const RESULTS_PREFIX: string = "PROBE_DISPATCH_BENCHMARK ";

interface Arguments {
  options: ProbeDispatchBenchmarkOptions;
  runs: number;
  json: boolean;
}

function readArguments(argv: Array<string>): Arguments {
  const valueOf: (name: string, fallback: number) => number = (
    name: string,
    fallback: number,
  ): number => {
    const index: number = argv.indexOf(name);

    if (index < 0 || index + 1 >= argv.length) {
      return fallback;
    }

    const value: number = Number(argv[index + 1]);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  };

  const textOf: (name: string) => string | null = (
    name: string,
  ): string | null => {
    const index: number = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1]! : null;
  };

  const appEnvironment: Record<string, string> = {};

  argv.forEach((argument: string, index: number): void => {
    if (argument === "--app-env" && argv[index + 1]) {
      const [name, ...value] = argv[index + 1]!.split("=");

      if (name) {
        appEnvironment[name] = value.join("=");
      }
    }
  });

  const profileDirectory: string | null = textOf("--profile-dir");
  const schedulingMax: number = valueOf("--scheduling-max", 0);

  return {
    runs: Math.max(1, valueOf("--runs", 1)),
    json: argv.includes("--json"),
    options: {
      fleet: {
        oneMinuteAssignments: valueOf(
          "--one-minute",
          ISSUE_10819_FLEET.oneMinuteAssignments,
        ),
        fiveMinuteAssignments: valueOf(
          "--five-minute",
          ISSUE_10819_FLEET.fiveMinuteAssignments,
        ),
        probes: Math.max(1, valueOf("--probes", ISSUE_10819_FLEET.probes)),
        projects: Math.max(
          1,
          valueOf("--projects", ISSUE_10819_FLEET.projects),
        ),
        schedule: textOf("--schedule") === "scheduled" ? "scheduled" : "due",
      },
      appReplicas: Math.max(1, valueOf("--app-replicas", 3)),
      poolSize: Math.max(1, valueOf("--pool", 50)),
      probeSchedulingMaxConcurrentRequests:
        schedulingMax > 0 ? schedulingMax : null,
      probeReplicas: Math.max(1, valueOf("--probe-replicas", 5)),
      workers: Math.max(1, valueOf("--workers", 3)),
      fetchLimit: Math.max(1, valueOf("--fetch-limit", 10)),
      checkMs: {
        min: valueOf("--check-ms-min", 200),
        max: Math.max(1, valueOf("--check-ms-max", 800)),
      },
      staggerMaxMs: valueOf("--stagger-ms", 0),
      durationMs: Math.max(5, valueOf("--seconds", 60)) * 1000,
      testsEveryMs: valueOf("--tests-every-ms", 5000),
      seed: valueOf("--seed", 10819),
      profileDirectory: profileDirectory
        ? path.resolve(profileDirectory)
        : null,
      appEnvironment: appEnvironment,
      metricsPath: textOf("--metrics-path"),
      statementLatencyMs: valueOf("--statement-latency-ms", 0),
      busyPercent: valueOf("--app-busy-percent", 0),
    },
  };
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function describeTiming(name: string, timing: TimingSummary): string {
  return `${name} ${timing.count}x mean ${timing.meanMs} ms p95 ${timing.p95Ms} ms max ${timing.maxMs} ms (total ${Math.round(timing.totalMs)} ms)`;
}

interface LaneMetrics {
  slotWaitMs?: { p95?: number; max?: number };
  refused?: number;
  maxConcurrentRequests?: number;
}

interface SchedulingMetrics {
  lanes?: Record<string, LaneMetrics>;
  monitorsHandedOut?: number;
  dispatchLagSeconds?: { p50?: number; p95?: number; max?: number };
  monitorsLateByAnInterval?: number;
  monitorTestsHandedOut?: number;
  monitorTestWaitSeconds?: { p95?: number; max?: number };
}

/*
 * A replica's probe scheduling metrics (ProbeSchedulingMetrics), as the
 * code under test keeps them: what its /metrics/probe-scheduling adds up.
 */
function describeSchedulingMetrics(metrics: JSONObject): string {
  const snapshot: SchedulingMetrics = metrics as SchedulingMetrics;

  if (!snapshot.lanes) {
    return `metrics ${JSON.stringify(metrics)}`;
  }

  const lanes: string = Object.entries(snapshot.lanes)
    .map(([lane, state]: [string, LaneMetrics]): string => {
      return `${lane}: ${state.maxConcurrentRequests} slots, wait p95 ${Math.round(state.slotWaitMs?.p95 || 0)} ms max ${Math.round(state.slotWaitMs?.max || 0)} ms, refused ${state.refused}`;
    })
    .join("; ");

  return `scheduling metrics (last minute): ${lanes} | ${snapshot.monitorsHandedOut} monitors handed out, dispatch lag p50 ${snapshot.dispatchLagSeconds?.p50} s p95 ${snapshot.dispatchLagSeconds?.p95} s max ${Math.round(snapshot.dispatchLagSeconds?.max || 0)} s, ${snapshot.monitorsLateByAnInterval} a whole interval late | ${snapshot.monitorTestsHandedOut} tests, wait p95 ${snapshot.monitorTestWaitSeconds?.p95} s max ${Math.round(snapshot.monitorTestWaitSeconds?.max || 0)} s`;
}

function describe(run: ProbeDispatchRun): Array<string> {
  const lines: Array<string> = [];
  const fetches: ProbeDispatchRun["monitorFetches"] = run.monitorFetches;

  lines.push(
    `handed out ${run.monitorsHandedOut} monitors in ${Math.round(run.durationMs / 1000)} s: ${run.monitorsPerSecond}/s, best 5 s ${run.peakMonitorsPerSecond}/s` +
      ` | backlog of ${run.initialBacklog} drained ${run.drainedAtMs === null ? "never" : `in ${Math.round(run.drainedAtMs / 1000)} s`}, 95% ${run.drained95AtMs === null ? "never" : `in ${Math.round(run.drained95AtMs / 1000)} s`}` +
      ` | oldest due p50 ${Math.round(run.oldestDueAgeMs.p50 / 1000)} s p95 ${Math.round(run.oldestDueAgeMs.p95 / 1000)} s max ${Math.round(run.oldestDueAgeMs.max / 1000)} s`,
  );
  lines.push(
    `  App replicas started in ${Math.round(run.replicasStartedInMs / 1000)} s; every 5 s, handed out a second / due / busy answers: ${run.timeline
      .map((point: ProbeDispatchRun["timeline"][number]): string => {
        return `${point.handedOutPerSecond}/${point.due}/${point.busyAnswers}`;
      })
      .join(" ")}`,
  );
  lines.push(
    `  monitor fetches ${fetches.total}: ${JSON.stringify(fetches.outcomes)}, full ${fetches.full}, short ${fetches.short}, empty ${fetches.empty} (short while due: ${fetches.shortWhileDue}) | latency p50 ${fetches.latencyMs.p50} ms p95 ${fetches.latencyMs.p95} ms max ${fetches.latencyMs.max} ms`,
  );
  lines.push(
    `  tests: ${run.tests.created} created, ${run.tests.handedOut} handed out, ${run.tests.neverHandedOut} never | wait p50 ${Math.round(run.tests.waitMs.p50 / 1000)} s p95 ${Math.round(run.tests.waitMs.p95 / 1000)} s max ${Math.round(run.tests.waitMs.max / 1000)} s | test fetches ${JSON.stringify(run.tests.fetchOutcomes)}`,
  );

  for (const replica of run.replicas) {
    lines.push(
      `  App replica ${replica.replica + 1}: CPU ${replica.cpuUserMs + replica.cpuSystemMs} ms of ${replica.elapsedMs} ms, event loop delay p99 ${replica.eventLoopDelayP99Ms} ms max ${replica.eventLoopDelayMaxMs} ms, slot refusals ${replica.slotRefusals}, answers ${JSON.stringify(replica.answers)}`,
    );
    lines.push(`    ${describeTiming("slot wait", replica.slotWait)}`);
    lines.push(`    ${describeTiming("pool wait", replica.poolWait)}`);

    for (const [route, timing] of Object.entries(replica.requests)) {
      lines.push(`    ${describeTiming(`request ${route}`, timing)}`);
    }

    for (const [kind, timing] of Object.entries(replica.statements)) {
      lines.push(`    ${describeTiming(`statement ${kind}`, timing)}`);
    }

    if (replica.metrics) {
      lines.push(`    ${describeSchedulingMetrics(replica.metrics)}`);
    }
  }

  for (const statement of run.topStatements.slice(0, 8)) {
    lines.push(
      `  pg: ${statement.calls}x mean ${statement.meanMs} ms total ${statement.totalMs} ms rows ${statement.rows}: ${statement.statement}`,
    );
  }

  lines.push(
    `  harness event loop delay p99 ${run.harnessEventLoopDelayP99Ms} ms`,
  );

  return lines;
}

async function main(): Promise<void> {
  const args: Arguments = readArguments(process.argv.slice(2));
  const runs: Array<ProbeDispatchRun> = [];

  for (let run: number = 0; run < args.runs; run++) {
    const result: ProbeDispatchRun = await runProbeDispatchBenchmark({
      ...args.options,
      seed: args.options.seed + run,
      profileDirectory: args.options.profileDirectory
        ? path.join(args.options.profileDirectory, `run-${run + 1}`)
        : null,
    });
    runs.push(result);

    if (!args.json) {
      write(`run ${run + 1}:`);

      for (const line of describe(result)) {
        write(line);
      }
    }
  }

  if (args.json) {
    write(
      `${RESULTS_PREFIX}${JSON.stringify({
        options: { ...args.options, profileDirectory: null },
        runs: runs.map((run: ProbeDispatchRun): ProbeDispatchRun => {
          // The per-second backlog is long; the summary keeps every tenth.
          return {
            ...run,
            backlog: run.backlog.filter((_sample: unknown, index: number) => {
              return index % 10 === 0;
            }),
          };
        }),
      })}`,
    );
  }

  await PostgresAppInstance.disconnect();
}

main()
  .then((): void => {
    process.exit(0);
  })
  .catch((error: unknown): void => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exit(1);
  });
