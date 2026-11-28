import { beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import path from "path";

/*
 * APP PODS MADE READY MID-RUN GET PROBE REQUESTS OVER KEPT-ALIVE CONNECTIONS
 * (issue #11393).
 *
 * Probes keep their connections to the App open, and kube-proxy sends each
 * new connection, not each request, to a pod, so the pods KEDA adds while
 * probe requests wait for a scheduling slot used to get almost none of them:
 * measured with the benchmark in #11121, two pods backed up and two made
 * Ready, the new ones answered 9% of the probes' fetches for 30 seconds,
 * and the old ones kept 17 to 35 requests waiting for two minutes. Since
 * #11121 a pod whose requests wait answers a few a second with
 * "Connection: close" (ProbeSchedulingReconnect), so the probes' next
 * requests open new connections, which go anywhere. Nothing held that in
 * CI: a change that keeps connections longer - a larger keepalive_requests,
 * the agent's settings, the reconnect dropped - would bring the stickiness
 * back unnoticed.
 *
 * This runs the benchmark (scripts/benchmark-probe-dispatch.ts) with the
 * probes' requests over kept-alive connections, one Node agent per probe
 * replica as a probe has, to one address that sends each new connection to
 * an App replica at random, as kube-proxy does (--balance connection; no
 * nginx in front, which CI does not have). Two App replicas serve from the
 * start, with every statement LATER_STATEMENT_LATENCY_MS slower so they
 * cannot keep up with the issue's 39,700 due monitors; two more are made
 * Ready LATER_AT_SECONDS in. From SETTLED_AFTER_SECONDS after that it holds
 * the new replicas to 40% of the fetches answered or more (half is an even
 * share) and the old ones to a few requests waiting at most.
 *
 * Measured on the development machine, three runs each (the pull request
 * that closed #11393): with the reconnect, from 30 s after they were Ready
 * the new replicas answered 50 to 51% of the fetches, and the old ones had
 * 1.4 to 1.7 requests waiting (3.4 at most); with it taken out, 25 to 32%,
 * and 22 to 25 waiting. A third, as the issue first put it, does not tell
 * the two apart; 40% does, with room either side, and the waiting differs
 * tenfold. Each run took about three minutes, the replicas' start and the
 * seed of the issue's install included.
 *
 * In a child Node process that loads the code as the containers do
 * (ts-node, transpile only), not inside Jest, as
 * ProbeDispatchThroughputPostgres runs the benchmark.
 *
 * Opt in with RUN_POSTGRES_PROBE_DISPATCH_LATER_REPLICAS_TESTS=true against
 * a Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The benchmark copies the
 * tables it uses into a schema of its own and drops it afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * PROBE_DISPATCH_LATER_REPLICAS_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from PROBE_DISPATCH_LATER_REPLICAS_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROBE_DISPATCH_LATER_REPLICAS_TESTS"] === "true"
    ? describe
    : describe.skip;

const APP_ROOT: string = path.resolve(__dirname, "..", "..");
const SCRIPT: string = path.join(
  APP_ROOT,
  "scripts",
  "benchmark-probe-dispatch.ts",
);
const RESULTS_PREFIX: string = "PROBE_DISPATCH_BENCHMARK ";

// The run: two replicas from the start, two more made Ready 30 s in, 90 s in all.
const APP_REPLICAS: number = 2;
const LATER_APP_REPLICAS: number = 2;
const LATER_AT_SECONDS: number = 30;
const RUN_SECONDS: number = 90;
// Every statement this much slower: the first two replicas cannot keep up.
const LATER_STATEMENT_LATENCY_MS: number = 250;

// From when after the new replicas are Ready the bounds hold.
const SETTLED_AFTER_SECONDS: number = 30;

// The bounds: the new replicas' share of the fetches, and what waits on the old.
const NEW_REPLICAS_SHARE_AT_LEAST: number = 0.4;
const OLD_REPLICAS_WAITING_AT_MOST: number = 8;

interface ReplicaSample {
  replica: number;
  answeredPerSecond: number;
  running: number;
  waiting: number;
  connectionsOpen: number;
  connectionsAcceptedInWindow: number;
  closingAnswersInWindow: number;
}

interface ReplicaTimelinePoint {
  atSecond: number;
  replicas: Array<ReplicaSample>;
}

interface RunSummary {
  durationMs: number;
  monitorsPerSecond: number;
  laterAtSecond: number | null;
  laterReplicas: Array<number>;
  replicaTimeline: Array<ReplicaTimelinePoint>;
  connectionsSentToReplicas: Record<string, number>;
  monitorFetches: { total: number; outcomes: Record<string, number> };
}

interface BenchmarkSummary {
  runs: Array<RunSummary>;
}

// What the replicas did once the new ones had had time to fill.
interface SettledReplicas {
  points: number;
  newShare: number;
  oldWaitingMean: number;
  oldWaitingMax: number;
  newRunningMean: number;
}

/*
 * Of the timeline's points from SETTLED_AFTER_SECONDS after the new
 * replicas were Ready: the share of the fetches the new replicas answered,
 * and the requests waiting on the old ones (the mean of each point's sum).
 */
function settledReplicas(run: RunSummary): SettledReplicas {
  const laterAt: number = run.laterAtSecond ?? LATER_AT_SECONDS;
  const later: Set<number> = new Set<number>(run.laterReplicas);
  const points: Array<ReplicaTimelinePoint> = run.replicaTimeline.filter(
    (point: ReplicaTimelinePoint): boolean => {
      return point.atSecond >= laterAt + SETTLED_AFTER_SECONDS;
    },
  );

  let newAnswered: number = 0;
  let allAnswered: number = 0;
  let oldWaiting: number = 0;
  let oldWaitingMax: number = 0;
  let newRunning: number = 0;

  for (const point of points) {
    let pointOldWaiting: number = 0;
    let pointNewRunning: number = 0;

    for (const sample of point.replicas) {
      allAnswered += sample.answeredPerSecond;

      if (later.has(sample.replica)) {
        newAnswered += sample.answeredPerSecond;
        pointNewRunning += sample.running;
      } else {
        pointOldWaiting += sample.waiting;
      }
    }

    oldWaiting += pointOldWaiting;
    oldWaitingMax = Math.max(oldWaitingMax, pointOldWaiting);
    newRunning += pointNewRunning;
  }

  return {
    points: points.length,
    newShare: allAnswered > 0 ? newAnswered / allAnswered : 0,
    oldWaitingMean: points.length > 0 ? oldWaiting / points.length : 0,
    oldWaitingMax: oldWaitingMax,
    newRunningMean: points.length > 0 ? newRunning / points.length : 0,
  };
}

let summary: BenchmarkSummary | null = null;
let childOutput: string = "";

beforeAll(() => {
  if (
    process.env["RUN_POSTGRES_PROBE_DISPATCH_LATER_REPLICAS_TESTS"] !== "true"
  ) {
    return;
  }

  const child: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=4096",
      "--require",
      "ts-node/register",
      SCRIPT,
      "--balance",
      "connection",
      "--post-results",
      "--app-replicas",
      String(APP_REPLICAS),
      "--later-app-replicas",
      String(LATER_APP_REPLICAS),
      "--later-at-seconds",
      String(LATER_AT_SECONDS),
      "--statement-latency-ms",
      String(LATER_STATEMENT_LATENCY_MS),
      "--probes",
      "1",
      "--probe-replicas",
      "20",
      "--workers",
      "3",
      "--fetch-limit",
      "10",
      "--seconds",
      String(RUN_SECONDS),
      "--json",
    ],
    {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: "1",
        TS_NODE_PROJECT: path.join(APP_ROOT, "tsconfig.json"),
        DATABASE_HOST:
          process.env["PROBE_DISPATCH_LATER_REPLICAS_TEST_DATABASE_HOST"] ||
          "localhost",
        DATABASE_PORT:
          process.env["PROBE_DISPATCH_LATER_REPLICAS_TEST_DATABASE_PORT"] ||
          "5400",
        DATABASE_NAME:
          process.env["PROBE_DISPATCH_LATER_REPLICAS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
        DATABASE_SLOW_QUERY_LOG_THRESHOLD_MS: "0",
        LOG_LEVEL: "ERROR",
      },
      encoding: "utf8",
      timeout: 900_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  childOutput = `${child.stdout ?? ""}${child.stderr ?? ""}`;

  const line: string | undefined = (child.stdout ?? "")
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.startsWith(RESULTS_PREFIX);
    });

  summary = line
    ? (JSON.parse(line.substring(RESULTS_PREFIX.length)) as BenchmarkSummary)
    : null;
}, 1_000_000);

describePostgres(
  "app pods made Ready mid-run get the probes' requests over kept-alive connections",
  () => {
    function run(): RunSummary {
      expect({
        ran: summary !== null && summary.runs.length === 1,
        // The child's own output, shown only when it did not run.
        output: summary ? "" : childOutput.slice(-4000),
      }).toEqual({ ran: true, output: "" });

      return summary!.runs[0]!;
    }

    test("the new replicas were made Ready when asked, and sent connections only from then", () => {
      const result: RunSummary = run();

      // When its timer fired: on time, or a moment late on a busy runner.
      expect(result.laterAtSecond).toBeGreaterThanOrEqual(LATER_AT_SECONDS);
      expect(result.laterAtSecond).toBeLessThanOrEqual(LATER_AT_SECONDS + 2);
      expect(result.laterReplicas).toHaveLength(LATER_APP_REPLICAS);

      // Every replica was sent connections, the new ones too.
      for (
        let replica: number = 0;
        replica < APP_REPLICAS + LATER_APP_REPLICAS;
        replica++
      ) {
        expect({
          replica,
          sent: (result.connectionsSentToReplicas[String(replica)] || 0) > 0,
        }).toEqual({ replica, sent: true });
      }

      // None before they were Ready.
      for (const point of result.replicaTimeline) {
        if (point.atSecond + 5 <= LATER_AT_SECONDS) {
          for (const sample of point.replicas) {
            if (result.laterReplicas.includes(sample.replica)) {
              expect(sample.answeredPerSecond).toBe(0);
            }
          }
        }
      }
    });

    test("the old replicas were backed up before the new ones were Ready: requests waited for their slots", () => {
      const result: RunSummary = run();
      const before: Array<ReplicaTimelinePoint> = result.replicaTimeline.filter(
        (point: ReplicaTimelinePoint) => {
          return point.atSecond >= 10 && point.atSecond + 5 <= LATER_AT_SECONDS;
        },
      );

      expect(before.length).toBeGreaterThan(0);
      expect(
        Math.max(
          ...before.map((point: ReplicaTimelinePoint): number => {
            return point.replicas.reduce(
              (sum: number, sample: ReplicaSample): number => {
                return sum + sample.waiting;
              },
              0,
            );
          }),
        ),
      ).toBeGreaterThan(OLD_REPLICAS_WAITING_AT_MOST);
    });

    test(`${SETTLED_AFTER_SECONDS} seconds after they are Ready, the new replicas answer 40% of the probes' fetches or more`, () => {
      const settled: SettledReplicas = settledReplicas(run());

      expect(settled.points).toBeGreaterThan(0);
      expect({
        newShare: settled.newShare,
        atLeast: settled.newShare >= NEW_REPLICAS_SHARE_AT_LEAST,
      }).toEqual({ newShare: settled.newShare, atLeast: true });
    });

    test(`and the old replicas have no more than ${OLD_REPLICAS_WAITING_AT_MOST} requests waiting for a slot`, () => {
      const settled: SettledReplicas = settledReplicas(run());

      expect(settled.points).toBeGreaterThan(0);
      expect({
        oldWaitingMean: settled.oldWaitingMean,
        aFew: settled.oldWaitingMean <= OLD_REPLICAS_WAITING_AT_MOST,
      }).toEqual({ oldWaitingMean: settled.oldWaitingMean, aFew: true });
    });

    test("no fetch failed", () => {
      expect(run().monitorFetches.outcomes["error"] || 0).toBe(0);
    });
  },
);
