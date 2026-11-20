/*
 * THE GROUPED METRIC MONITOR OF ISSUE #10108, EVALUATED AND MEASURED.
 *
 * Run from packages/App:
 *
 *   node --require ts-node/register/transpile-only \
 *     scripts/benchmark-grouped-metric-monitor.ts [--series 16250] [--runs 3]
 *
 * Add `--cpu-prof --cpu-prof-dir=<dir>` before `--require` for a CPU
 * profile of the runs (Scripts/Perf/profile-summary.js summarises one), and
 * `--json` after the script for one line of JSON a test can read.
 *
 * One Metrics monitor over a Docker fleet: four queries grouped by host and
 * container, a formula and three criteria that open and resolve alerts
 * (GroupedMetricMonitorFleet), evaluated on the real path - the worker's
 * reads, MonitorResourceUtil.monitorResource under the monitor's lock, the
 * criteria, the alerts, the monitor log - with ClickHouse, Postgres and
 * Valkey stood in for at their clients (GroupedMetricMonitorHarness). A run
 * of 500 series warms the process up first, as the evaluations before it
 * would have; then each run judges a fleet of --series series and reports
 * how long it took, the longest the event loop was blocked, the CPU, the
 * heap, the database calls and whether the monitor's lock held.
 *
 * Measured on the development machine for #10108 (one core of an Azure
 * D-series VM, Node 26), 16,250 series: see the pull request.
 */
import fs from "fs";
import inspector from "inspector";
import path from "path";
import {
  GroupedMetricFleet,
  buildGroupedMetricFleet,
} from "../Tests/Workers/Jobs/TelemetryMonitor/GroupedMetricMonitorFleet";
import {
  EvaluationRun,
  StallRecord,
  runFleetEvaluation,
} from "../Tests/Workers/Jobs/TelemetryMonitor/GroupedMetricMonitorHarness";

export const RESULTS_PREFIX: string = "GROUPED_METRIC_MONITOR_BENCHMARK ";

interface Arguments {
  series: number;
  runs: number;
  json: boolean;
  // Where a CPU profile of each measured run is written, when asked.
  profileDirectory: string | null;
}

function readArguments(argv: Array<string>): Arguments {
  const profileIndex: number = argv.indexOf("--profile-dir");

  const valueOf: (name: string, fallback: number) => number = (
    name: string,
    fallback: number,
  ): number => {
    const index: number = argv.indexOf(name);

    if (index < 0 || index + 1 >= argv.length) {
      return fallback;
    }

    const value: number = Number(argv[index + 1]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  };

  return {
    series: valueOf("--series", 16_250),
    runs: valueOf("--runs", 3),
    json: argv.includes("--json"),
    profileDirectory:
      profileIndex >= 0 && argv[profileIndex + 1]
        ? path.resolve(argv[profileIndex + 1]!)
        : null,
  };
}

// The inspector's profiler, over the measured runs only.
class RunProfiler {
  private session: inspector.Session = new inspector.Session();

  public constructor() {
    this.session.connect();
  }

  private post<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>(
      (resolve: (value: T) => void, reject: (error: Error) => void): void => {
        this.session.post(
          method,
          params || {},
          (error: Error | null, result?: unknown): void => {
            if (error) {
              reject(error);
              return;
            }

            resolve(result as T);
          },
        );
      },
    );
  }

  public async start(): Promise<void> {
    await this.post("Profiler.enable");
    await this.post("Profiler.setSamplingInterval", { interval: 250 });
    await this.post("Profiler.start");
  }

  public async stop(file: string): Promise<void> {
    const result: { profile: unknown } = await this.post<{
      profile: unknown;
    }>("Profiler.stop");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result.profile));
  }
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fleetFor(seriesCount: number): GroupedMetricFleet {
  // A window that ended a second ago, on a whole second.
  const windowEndMs: number = Math.floor(Date.now() / 1000) * 1000 - 1000;

  return buildGroupedMetricFleet({
    seriesCount: seriesCount,
    windowEndMs: windowEndMs,
  });
}

function describeStalls(stalls: Array<StallRecord>): string {
  return stalls
    .slice()
    .sort((left: StallRecord, right: StallRecord): number => {
      return right.durationMs - left.durationMs;
    })
    .slice(0, 8)
    .map((stall: StallRecord): string => {
      return `${stall.durationMs} ms at ${stall.atMs} ms (${stall.phase})`;
    })
    .join(", ");
}

function median(values: Array<number>): number {
  const sorted: Array<number> = values
    .slice()
    .sort((a: number, b: number): number => {
      return a - b;
    });
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

async function main(): Promise<void> {
  const args: Arguments = readArguments(process.argv.slice(2));

  // Warm up: the evaluations before this one would have.
  await runFleetEvaluation({ fleet: fleetFor(500) });

  const runs: Array<EvaluationRun> = [];
  const profiler: RunProfiler | null = args.profileDirectory
    ? new RunProfiler()
    : null;

  for (let run: number = 0; run < args.runs; run++) {
    const fleet: GroupedMetricFleet = fleetFor(args.series);
    const valueRows: number = Array.from(fleet.valueRowCounts.values()).reduce(
      (sum: number, rows: number): number => {
        return sum + rows;
      },
      0,
    );

    if (profiler) {
      await profiler.start();
    }

    const result: EvaluationRun = await runFleetEvaluation({ fleet: fleet });
    runs.push(result);

    if (profiler && args.profileDirectory) {
      const file: string = path.join(
        args.profileDirectory,
        `grouped-metric-monitor-run-${run + 1}.cpuprofile`,
      );
      await profiler.stop(file);

      if (!args.json) {
        write(`  CPU profile: ${file}`);
      }
    }

    if (!args.json) {
      const m: EvaluationRun["measurement"] = result.measurement;
      write(
        `run ${run + 1}: ${args.series} series, ${valueRows} rows over ${fleet.valueRowCounts.size} reads` +
          ` | total ${m.totalMs} ms, CPU ${m.cpuUserMs + m.cpuSystemMs} ms` +
          ` | longest block ${m.longestBlockMs} ms (timer: ${m.longestStallMs} ms), ${m.stallsOver100Ms} over 100 ms, ELU ${m.eventLoopUtilization}` +
          ` | heap ${m.heapUsedBeforeMb} -> peak ${m.heapUsedPeakMb} MB, GC ${m.gcCount}x ${m.gcTotalMs} ms (longest ${m.gcLongestMs} ms)` +
          ` | Postgres ${m.postgresCallCount} calls, ClickHouse ${m.clickhouseReads} reads (${Math.round(m.clickhouseReadBytes / 1024)} KiB), ${m.clickhouseInserts} inserts (${Math.round(m.clickhouseInsertBytes / 1024)} KiB)` +
          ` | lock refreshed ${m.lockRefreshes}x, lost: ${m.lockLost}` +
          ` | alerts created ${result.outcome.createdAlerts.length}, resolved ${result.outcome.resolvedAlerts.length}` +
          (result.error ? ` | ERROR ${result.error}` : ""),
      );
      write(`  longest stalls: ${describeStalls(m.stalls)}`);
      write(
        `  Postgres calls: ${Object.entries(m.postgresCalls)
          .map(([key, count]: [string, number]): string => {
            return `${key} ${count}`;
          })
          .join(", ")}`,
      );
    }
  }

  const summary: Record<string, unknown> = {
    series: args.series,
    runs: runs.map((run: EvaluationRun): Record<string, unknown> => {
      return {
        measurement: run.measurement,
        createdAlerts: run.outcome.createdAlerts.length,
        resolvedAlerts: run.outcome.resolvedAlerts.length,
        statusChanges: run.outcome.statusChanges.length,
        monitorLogBytes: run.measurement.monitorLogBytes,
        error: run.error,
      };
    }),
    medianTotalMs: median(
      runs.map((run: EvaluationRun): number => {
        return run.measurement.totalMs;
      }),
    ),
    medianLongestBlockMs: median(
      runs.map((run: EvaluationRun): number => {
        return run.measurement.longestBlockMs;
      }),
    ),
  };

  if (args.json) {
    write(`${RESULTS_PREFIX}${JSON.stringify(summary)}`);
  } else {
    write(
      `median of ${args.runs}: total ${String(summary["medianTotalMs"])} ms, longest block ${String(summary["medianLongestBlockMs"])} ms`,
    );
  }
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
