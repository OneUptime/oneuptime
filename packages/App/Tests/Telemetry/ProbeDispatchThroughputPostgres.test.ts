import { beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import path from "path";

/*
 * HANDING MONITORS OUT TO PROBES AT THE SCALE OF ISSUE #10819 DOES NOT
 * REGRESS.
 *
 * A self-hosted install with 39,800 monitor assignments had its probes
 * handed 110 to 140 monitors a second against the 1,200 its probes could
 * check: claims for the same probe made at once read the same rows, all but
 * one came back empty, and a probe reads an empty batch as "nothing is due"
 * and waits for its next minute. This runs the benchmark
 * (scripts/benchmark-probe-dispatch.ts: the real /monitor/list and
 * /monitor-test/list, the real probe scheduling limit and claim statements,
 * three App replicas, each a process with its own pool) over the issue's
 * fleet, all of it due, on one probe of 20 replicas of 3 workers, and holds
 * what it measures to bounds:
 *
 *   - monitors handed out a second (measured: 121 before #10819, 1,036
 *     after, on the development machine);
 *   - fetches answered short or empty while the backlog was still due
 *     (before: 115 of 1,529; after: none);
 *   - no fetch answered busy, and every Test Monitor run asked for handed
 *     out within the probes' ten-second tick.
 *
 * In a child Node process that loads the code as the containers do
 * (ts-node, transpile only), not inside Jest. The bounds leave a CI runner
 * three to four times slower room, and still fail the code before.
 *
 * Opt in with RUN_POSTGRES_PROBE_DISPATCH_BENCHMARK_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The benchmark copies
 * the tables it uses into a schema of its own and drops it afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * PROBE_DISPATCH_BENCHMARK_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * PROBE_DISPATCH_BENCHMARK_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROBE_DISPATCH_BENCHMARK_TESTS"] === "true"
    ? describe
    : describe.skip;

const APP_ROOT: string = path.resolve(__dirname, "..", "..");
const SCRIPT: string = path.join(
  APP_ROOT,
  "scripts",
  "benchmark-probe-dispatch.ts",
);
const RESULTS_PREFIX: string = "PROBE_DISPATCH_BENCHMARK ";

// The bounds, sized for a CI runner.
const MONITORS_PER_SECOND_BOUND: number = 300;
const SHORT_BEFORE_DRAINED_BOUND: number = 10;
const TEST_WAIT_P95_BOUND_MS: number = 15_000;

interface RunSummary {
  monitorsPerSecond: number;
  peakMonitorsPerSecond: number;
  monitorFetches: {
    total: number;
    outcomes: Record<string, number>;
    empty: number;
    shortBeforeDrained: number;
  };
  tests: {
    created: number;
    handedOut: number;
    neverHandedOut: number;
    waitMs: { p95: number };
  };
}

interface BenchmarkSummary {
  runs: Array<RunSummary>;
}

let summary: BenchmarkSummary | null = null;
let childOutput: string = "";

beforeAll(() => {
  if (process.env["RUN_POSTGRES_PROBE_DISPATCH_BENCHMARK_TESTS"] !== "true") {
    return;
  }

  const child: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=4096",
      "--require",
      "ts-node/register",
      SCRIPT,
      "--probes",
      "1",
      "--probe-replicas",
      "20",
      "--workers",
      "3",
      "--fetch-limit",
      "10",
      "--app-replicas",
      "3",
      "--seconds",
      "45",
      "--tests-every-ms",
      "5000",
      "--json",
    ],
    {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: "1",
        TS_NODE_PROJECT: path.join(APP_ROOT, "tsconfig.json"),
        DATABASE_HOST:
          process.env["PROBE_DISPATCH_BENCHMARK_TEST_DATABASE_HOST"] ||
          "localhost",
        DATABASE_PORT:
          process.env["PROBE_DISPATCH_BENCHMARK_TEST_DATABASE_PORT"] || "5400",
        DATABASE_NAME:
          process.env["PROBE_DISPATCH_BENCHMARK_TEST_DATABASE_NAME"] ||
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
  "handing out the issue's 39,700 due monitors to one probe's 60 workers",
  () => {
    function run(): RunSummary {
      expect({
        ran: summary !== null && summary.runs.length === 1,
        // The child's own output, shown only when it did not run.
        output: summary ? "" : childOutput.slice(-4000),
      }).toEqual({ ran: true, output: "" });

      return summary!.runs[0]!;
    }

    test(`hands out at least ${MONITORS_PER_SECOND_BOUND} monitors a second`, () => {
      expect(run().monitorsPerSecond).toBeGreaterThanOrEqual(
        MONITORS_PER_SECOND_BOUND,
      );
    });

    test("never sends a worker away with a short batch while the backlog is still due", () => {
      expect(run().monitorFetches.shortBeforeDrained).toBeLessThanOrEqual(
        SHORT_BEFORE_DRAINED_BOUND,
      );
    });

    test("answers no fetch busy, with room in the limit", () => {
      expect(run().monitorFetches.outcomes["busy"] || 0).toBe(0);
      expect(run().monitorFetches.outcomes["error"] || 0).toBe(0);
    });

    test("hands every Test Monitor run out within the probes' tick", () => {
      const tests: RunSummary["tests"] = run().tests;

      expect(tests.created).toBeGreaterThan(0);
      expect(tests.neverHandedOut).toBe(0);
      expect(tests.waitMs.p95).toBeLessThanOrEqual(TEST_WAIT_P95_BOUND_MS);
    });
  },
);
