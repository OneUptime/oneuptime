import { beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import path from "path";

/*
 * A GROUPED METRIC MONITOR OVER 16,000 SERIES NEVER BLOCKS THE SERVER
 * (issue #10108).
 *
 * The issue's monitor - four queries grouped by host and container, a
 * formula, three criteria, 16,250 series on one App container - held the
 * Node event loop for 20 to 30 seconds at every evaluation: telemetry
 * inserts waited, /api/status took 18 s, the monitor's lock was lost. This
 * runs the benchmark (scripts/benchmark-grouped-metric-monitor.ts: the real
 * evaluation path over the issue's fleet, with the stores stood in for at
 * their clients) and holds what it measures to bounds.
 *
 * In a child Node process that loads the code as the containers do
 * (ts-node, transpile only), not inside Jest, whose vm context makes every
 * lookup of a global builtin slower than production (see
 * MessagingEntityKeysBenchmark.test.ts). The best of two runs counts, after
 * a warm-up, so one garbage collection at the wrong moment does not decide.
 *
 * Measured on the development machine for #10108 (16,250 series): before,
 * 8.7 to 11 s an evaluation with its longest block 3.7 to 4.2 s, 8 or 9
 * blocks over 100 ms, a 73 MB monitor log row and 8 ClickHouse reads; after,
 * about 1.9 s with its longest block 50 to 75 ms, none over 100 ms, a 280 KB
 * row and 7 reads. The bounds leave a CI runner four to five times slower
 * room, and still fail the code before by an order of magnitude.
 */

const APP_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const SCRIPT: string = path.join(
  APP_ROOT,
  "scripts",
  "benchmark-grouped-metric-monitor.ts",
);
const RESULTS_PREFIX: string = "GROUPED_METRIC_MONITOR_BENCHMARK ";

const SERIES: number = 16_250;

// The bounds, sized for a CI runner.
const LONGEST_BLOCK_BOUND_MS: number = 400;
const TOTAL_BOUND_MS: number = 15_000;
const MONITOR_LOG_BOUND_BYTES: number = 1024 * 1024;

interface RunMeasurement {
  totalMs: number;
  longestBlockMs: number;
  longestStallMs: number;
  stallsOver100Ms: number;
  lockLost: boolean;
  unhandledRejections: Array<string>;
  clickhouseReads: number;
  monitorLogBytes: number;
}

interface RunSummary {
  measurement: RunMeasurement;
  createdAlerts: number;
  resolvedAlerts: number;
  error: string | null;
}

interface BenchmarkSummary {
  series: number;
  runs: Array<RunSummary>;
}

let summary: BenchmarkSummary | null = null;
let childOutput: string = "";

function bestOf(read: (measurement: RunMeasurement) => number): number {
  return Math.min(
    ...summary!.runs.map((run: RunSummary): number => {
      return read(run.measurement);
    }),
  );
}

beforeAll(() => {
  const child: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--max-old-space-size=4096",
      "--require",
      "ts-node/register",
      SCRIPT,
      "--series",
      String(SERIES),
      "--runs",
      "2",
      "--json",
    ],
    {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: "1",
        TS_NODE_PROJECT: path.join(APP_ROOT, "tsconfig.json"),
      },
      encoding: "utf8",
      timeout: 540_000,
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
}, 600_000);

describe("the #10108 monitor over 16,250 series, timed in production's runtime", () => {
  test("ran, both runs, without an error", () => {
    expect({
      ran: summary !== null && summary.runs.length === 2,
      // The child's own output, shown only when it did not run.
      output: summary ? "" : childOutput.slice(-4000),
    }).toEqual({ ran: true, output: "" });

    for (const run of summary!.runs) {
      expect(run.error).toBeNull();
      // It still judges and acts: alerts open and resolve.
      expect(run.createdAlerts).toBeGreaterThan(0);
      expect(run.resolvedAlerts).toBeGreaterThan(0);
    }
  });

  test(`never holds the event loop for ${LONGEST_BLOCK_BOUND_MS} ms`, () => {
    expect(
      bestOf((measurement: RunMeasurement): number => {
        return measurement.longestBlockMs;
      }),
    ).toBeLessThan(LONGEST_BLOCK_BOUND_MS);
    expect(
      bestOf((measurement: RunMeasurement): number => {
        return measurement.longestStallMs;
      }),
    ).toBeLessThan(LONGEST_BLOCK_BOUND_MS);
  });

  test(`evaluates within ${TOTAL_BOUND_MS / 1000} s`, () => {
    expect(
      bestOf((measurement: RunMeasurement): number => {
        return measurement.totalMs;
      }),
    ).toBeLessThan(TOTAL_BOUND_MS);
  });

  test("keeps its lock, with nothing left unhandled", () => {
    for (const run of summary!.runs) {
      expect(run.measurement.lockLost).toBe(false);
      expect(run.measurement.unhandledRejections).toEqual([]);
    }
  });

  test("writes a bounded monitor log row, and reads the shared arrivals once", () => {
    for (const run of summary!.runs) {
      expect(run.measurement.monitorLogBytes).toBeGreaterThan(0);
      expect(run.measurement.monitorLogBytes).toBeLessThan(
        MONITOR_LOG_BOUND_BYTES,
      );
      // Four reads, and three arrival reads: two queries share theirs.
      expect(run.measurement.clickhouseReads).toBe(7);
    }
  });
});
