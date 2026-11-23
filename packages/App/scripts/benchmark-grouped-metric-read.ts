/*
 * ONE GROUPED METRIC READ OF THE #10108 FLEET, READ BOTH WAYS AND MEASURED
 * (issue #10316).
 *
 * Run from packages/App, against a disposable ClickHouse:
 *
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     node --expose-gc --require ts-node/register/transpile-only \
 *     scripts/benchmark-grouped-metric-read.ts [--series 16250] [--runs 5]
 *
 * Loads three minutes of a fleet's container metric - a series per host and
 * container, a point every 20 seconds - into a database of its own, then
 * reads it as a grouped Metrics monitor does (MetricService.aggregateBy,
 * grouped by host and container, a row per series and minute: about 49,000
 * rows and 10 MB of JSON at 16,250 series), alternately as one FORMAT JSON
 * document, as every grouped read was before, and as rows as they arrive.
 *
 * Two passes. The first times each read: how long it took and the longest
 * the event loop was held (monitorEventLoopDelay, and a 5 ms timer). The
 * second measures the memory each read holds: a 2 ms timer collects the
 * heap and samples what is left (heap and external memory), so a sample is
 * what the read keeps alive, never garbage that is yet to be collected. It
 * reports the highest sample above where the read began, and what is still
 * held once the read has answered: its result. The timer cannot sample in
 * the middle of one block of the event loop, so the one parse of a whole
 * document is also sampled as it returns, its text and the document both
 * held. Collecting the heap every 2 ms slows the read: the second pass is
 * never timed. It needs --expose-gc. The database is dropped at the end.
 */
import { IntervalHistogram, monitorEventLoopDelay } from "perf_hooks";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import MetricService from "Common/Server/Services/MetricService";
import AggregateBy from "Common/Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { StallTracker } from "../Tests/Workers/Jobs/TelemetryMonitor/GroupedMetricMonitorHarness";

const MINUTE: number = 60 * 1000;
const CONTAINERS_PER_HOST: number = 35;
const HOST_KEY: string = "resource.host.name";
const CONTAINER_KEY: string = "resource.container.name";
const METRIC: string = "container.pids.count";

const PROJECT_ID: ObjectID = new ObjectID(
  "10316000-0000-4000-8000-000000000001",
);

type Mode = "one document" | "rows as they arrive";

interface ReadMeasurement {
  mode: Mode;
  rows: number;
  totalMs: number;
  longestBlockMs: number;
}

interface MemoryMeasurement {
  mode: Mode;
  rows: number;
  // The most the read held at once, above where it began.
  peakMb: number;
  // What it still holds once it has answered: the result.
  resultMb: number;
}

type GarbageCollector = () => void;

function getGarbageCollector(): GarbageCollector | undefined {
  return (global as unknown as { gc?: GarbageCollector }).gc;
}

function valueOf(argv: Array<string>, name: string, fallback: number): number {
  const index: number = argv.indexOf(name);
  const value: number = index >= 0 ? Number(argv[index + 1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function megabytes(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function median(values: Array<number>): number {
  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  database: string,
): Promise<void> {
  const model: AnalyticsBaseModel = new Metric();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Metric,
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

// Three minutes of the fleet: a point a series every 20 seconds.
function fleetRows(
  seriesCount: number,
  windowStartMs: number,
): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  const retention: string = OneUptimeDate.toClickhouseDateTime(
    OneUptimeDate.addRemoveDays(new Date(), 30),
  );

  for (let series: number = 0; series < seriesCount; series++) {
    const host: number = Math.floor(series / CONTAINERS_PER_HOST);
    const attributes: Record<string, string> = {
      [HOST_KEY]: `docker-host-${String(host).padStart(4, "0")}.prod.fleet.internal`,
      [CONTAINER_KEY]: `checkout-api-${host % 7}-${series % CONTAINERS_PER_HOST}`,
    };

    for (let second: number = 0; second < 180; second += 20) {
      const timeMs: number = windowStartMs + second * 1000;

      rows.push({
        _id: ObjectID.generate().toString(),
        createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
        projectId: PROJECT_ID.toString(),
        primaryEntityId: "10316000-0000-4000-8000-0000000000ff",
        primaryEntityType: "Service",
        name: METRIC,
        aggregationTemporality: "Delta",
        metricPointType: "Gauge",
        time: OneUptimeDate.toClickhouseDateTime64(new Date(timeMs)),
        timeUnixNano: String(timeMs * 1000000 + series),
        attributes: attributes,
        attributeKeys: Object.keys(attributes).sort(),
        entityKeys: [],
        value: (series * 7 + second) % 2500,
        count: null,
        sum: null,
        min: null,
        max: null,
        bucketCounts: [],
        explicitBounds: [],
        retentionDate: retention,
      });
    }
  }

  return rows;
}

/*
 * Reads as `mode` says while `read` runs: the one document by switching
 * MetricService's choice off for it.
 */
async function inMode<T>(mode: Mode, read: () => Promise<T>): Promise<T> {
  const service: Record<string, unknown> = MetricService as unknown as Record<
    string,
    unknown
  >;

  if (mode === "one document") {
    service["readsAggregateRowsAsTheyArrive"] = (): boolean => {
      return false;
    };
  }

  try {
    getGarbageCollector()?.();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    return await read();
  } finally {
    delete service["readsAggregateRowsAsTheyArrive"];
  }
}

async function measureRead(
  mode: Mode,
  request: () => AggregateBy<Metric>,
): Promise<ReadMeasurement> {
  return inMode(mode, async (): Promise<ReadMeasurement> => {
    const tracker: StallTracker = new StallTracker();
    const histogram: IntervalHistogram = monitorEventLoopDelay({
      resolution: 1,
    });

    tracker.start();
    histogram.enable();
    const startedAt: number = performance.now();

    const result: AggregatedResult = await MetricService.aggregateBy(request());

    const totalMs: number = performance.now() - startedAt;
    histogram.disable();
    tracker.stop();

    return {
      mode: mode,
      rows: result.data.length,
      totalMs: Math.round(totalMs),
      longestBlockMs: Math.round(
        Math.max(histogram.max / 1e6, tracker.longestStallMs),
      ),
    };
  });
}

// What the process keeps alive: the heap and external memory, collected.
function liveBytes(collect: GarbageCollector): number {
  collect();
  const usage: NodeJS.MemoryUsage = process.memoryUsage();
  return usage.heapUsed + usage.external;
}

async function measureMemory(
  mode: Mode,
  request: () => AggregateBy<Metric>,
  collect: GarbageCollector,
): Promise<MemoryMeasurement> {
  return inMode(mode, async (): Promise<MemoryMeasurement> => {
    const before: number = liveBytes(collect);
    let peak: number = before;
    const sampler: NodeJS.Timeout = setInterval((): void => {
      peak = Math.max(peak, liveBytes(collect));
    }, 2);

    /*
     * The parse of a whole document is one block the timer cannot sample
     * in, and the moment it holds the most: the answer's text and the
     * document parsed from it, both alive. Sampled there, after any parse
     * of more than a megabyte of text (no row is one).
     */
    const parse: typeof JSON.parse = JSON.parse;
    JSON.parse = ((text: string, reviver?: Parameters<typeof parse>[1]) => {
      const value: unknown = parse(text, reviver);

      if (typeof text === "string" && text.length > 1024 * 1024) {
        peak = Math.max(peak, liveBytes(collect));
      }

      return value;
    }) as typeof JSON.parse;

    let result: AggregatedResult;

    try {
      result = await MetricService.aggregateBy(request());
    } finally {
      JSON.parse = parse;
      clearInterval(sampler);
    }

    // Sampled while the result is still held: it is read just below.
    const after: number = liveBytes(collect);
    peak = Math.max(peak, after);

    return {
      mode: mode,
      rows: result.data.length,
      peakMb: megabytes(Math.max(0, peak - before)),
      resultMb: megabytes(Math.max(0, after - before)),
    };
  });
}

async function main(): Promise<void> {
  const argv: Array<string> = process.argv.slice(2);
  const seriesCount: number = valueOf(argv, "--series", 16_250);
  const runs: number = valueOf(argv, "--runs", 5);
  const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

  if (!endpoint) {
    throw new Error(
      "Point TEST_CLICKHOUSE_URL at a local, disposable ClickHouse server.",
    );
  }

  const url: URL = new URL(endpoint);

  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(
      "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
    );
  }

  const database: string = `grouped_read_benchmark_${process.pid}`;
  const options: ClickHouseClientConfigOptions = {
    url: `${url.protocol}//${url.host}`,
    username: decodeURIComponent(url.username) || "default",
    password: decodeURIComponent(url.password),
    database: database,
    request_timeout: 120000,
  };
  const clickhouse: ClickhouseDatabase = new ClickhouseDatabase(options);
  const client: ClickhouseClient = await clickhouse.connect(options);

  try {
    await createTable(client, clickhouse, database);
    MetricService.database = clickhouse;
    MetricService.databaseClient = client;
    MetricService.ingestDatabase = clickhouse;
    MetricService.ingestDatabaseClient = client;

    const windowStartMs: number =
      Math.floor(Date.now() / MINUTE) * MINUTE - 6 * MINUTE;
    const rows: Array<JSONObject> = fleetRows(seriesCount, windowStartMs);

    for (let start: number = 0; start < rows.length; start += 20000) {
      await MetricService.insertJsonRows(rows.slice(start, start + 20000), {
        clickhouseSettings: { wait_for_async_insert: 1 },
      });
    }

    const window: InBetween<Date> = new InBetween<Date>(
      new Date(windowStartMs),
      new Date(windowStartMs + 3 * MINUTE - 1),
    );
    const request: () => AggregateBy<Metric> = (): AggregateBy<Metric> => {
      return {
        query: { projectId: PROJECT_ID, time: window, name: METRIC },
        aggregationType: AggregationType.Max,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        aggregationInterval: AggregationInterval.Minute,
        startTimestamp: window.startValue,
        endTimestamp: window.endValue,
        groupByAttributeKeys: [HOST_KEY, CONTAINER_KEY],
        // As aggregateBy fills it in; the size probe below sends it as is.
        sort: { time: SortOrder.Descending },
        limit: 50_000 + seriesCount * 3,
        skip: 0,
        props: { isRoot: true },
      } as AggregateBy<Metric>;
    };

    const body: string = await (
      await MetricService.executeQuery(
        MetricService.toAggregateStatement(request()).statement,
      )
    ).text();
    write(
      `${seriesCount} series, ${rows.length} rows stored; a read answers ${megabytes(Buffer.byteLength(body))} MB as FORMAT JSON`,
    );

    // A read of each first, as the evaluations before would have warmed up.
    await measureRead("one document", request);
    await measureRead("rows as they arrive", request);

    const measured: Array<ReadMeasurement> = [];

    for (let run: number = 0; run < runs; run++) {
      for (const mode of [
        "one document",
        "rows as they arrive",
      ] as Array<Mode>) {
        const measurement: ReadMeasurement = await measureRead(mode, request);
        measured.push(measurement);
        write(
          `run ${run + 1}, ${mode}: ${measurement.rows} rows in ${measurement.totalMs} ms | longest block ${measurement.longestBlockMs} ms`,
        );
      }
    }

    const collect: GarbageCollector | undefined = getGarbageCollector();
    const remembered: Array<MemoryMeasurement> = [];

    if (collect) {
      for (let run: number = 0; run < runs; run++) {
        for (const mode of [
          "one document",
          "rows as they arrive",
        ] as Array<Mode>) {
          const measurement: MemoryMeasurement = await measureMemory(
            mode,
            request,
            collect,
          );
          remembered.push(measurement);
          write(
            `memory ${run + 1}, ${mode}: ${measurement.rows} rows | held at most ${measurement.peakMb} MB | result ${measurement.resultMb} MB`,
          );
        }
      }
    } else {
      write("memory: not measured, run with --expose-gc");
    }

    for (const mode of ["one document", "rows as they arrive"] as Array<Mode>) {
      const ofMode: Array<ReadMeasurement> = measured.filter(
        (measurement: ReadMeasurement): boolean => {
          return measurement.mode === mode;
        },
      );
      const memoryOfMode: Array<MemoryMeasurement> = remembered.filter(
        (measurement: MemoryMeasurement): boolean => {
          return measurement.mode === mode;
        },
      );
      write(
        `median, ${mode}: ${median(
          ofMode.map((m: ReadMeasurement) => {
            return m.totalMs;
          }),
        )} ms | longest block ${median(
          ofMode.map((m: ReadMeasurement) => {
            return m.longestBlockMs;
          }),
        )} ms (worst ${Math.max(
          ...ofMode.map((m: ReadMeasurement) => {
            return m.longestBlockMs;
          }),
        )} ms)${
          memoryOfMode.length > 0
            ? ` | held at most ${median(
                memoryOfMode.map((m: MemoryMeasurement) => {
                  return m.peakMb;
                }),
              )} MB, result ${median(
                memoryOfMode.map((m: MemoryMeasurement) => {
                  return m.resultMb;
                }),
              )} MB`
            : ""
        }`,
      );
    }
  } finally {
    await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    await clickhouse.disconnect();
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
