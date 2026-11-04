import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  ClickHouseSettings,
  ClickhouseExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricSeriesArrival from "Common/Types/Monitor/MetricMonitor/MetricSeriesArrival";
import ObjectID from "Common/Types/ObjectID";
import { MetricSeriesArrivalAggregates } from "Common/Utils/Metrics/MetricSeriesArrivalUtil";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * When a monitor's series got their data, against a real ClickHouse
 * (#4912's follow-ups, #5281, #5437).
 *
 * A metric row carries the time its source measured and the second
 * OneUptime wrote it (createdAt). MetricService.readSeriesArrivals folds a
 * query's rows per series: the newest and oldest createdAt, the minutes
 * something arrived in, and the newest data point's createdAt and time -
 * what the monitor worker hands the evaluator to tell a late series from a
 * stopped one. A mock cannot show what ClickHouse makes of that SQL: that
 * argMax picks the newest data point's createdAt, that uniq counts a batch
 * as one minute, that DateTime64(9) times keep their milliseconds, that the
 * query's filters, window and retention hold, and that the older analyzer
 * reads the same. So this suite loads rows with chosen createdAt into a
 * table built from the real Metric model and reads them through
 * readSeriesArrivals and the worker's readQueryDataPoints.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/SeriesArrivalsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// The worker module loads the queue and the native isolated-vm addon.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

import MetricService, {
  MetricSeriesArrivalRow,
} from "Common/Server/Services/MetricService";
import {
  QueryDataPoints,
  readQueryDataPoints,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `series_arrivals_test_${process.pid}_${Date.now()}`;

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

/*
 * A 15-minute window ending on a minute ten minutes ago: every row - those
 * written up to nine minutes after their time, too - is in the past, and
 * well within retention.
 */
const WINDOW_END_MS: number =
  Math.floor(Date.now() / MINUTE) * MINUTE - 10 * MINUTE;
const WINDOW_START_MS: number = WINDOW_END_MS - 15 * MINUTE;

const projectId: ObjectID = new ObjectID(
  "6b2e3d4c-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "6b2e3d4c-0000-4000-8000-00000000000b",
);

const CPU: string = "k8s.pod.cpu.utilization";
const POD_KEY: string = "resource.k8s.pod.name";
const CLUSTER_KEY: string = "resource.k8s.cluster.name";

// The cluster the queries read, built apart from them (TS2589, see GroupedReadInSql).
const WATCHED: Dictionary<string> = { [CLUSTER_KEY]: "prod" };
const STOPPED_ONLY: Dictionary<string> = { ...WATCHED, [POD_KEY]: "stopped" };

interface Row {
  pod: string;
  timeMs: number;
  createdAtMs: number;
  cluster?: string;
  projectId?: ObjectID;
  retentionDate?: string;
}

const inThirtyDays: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);
const yesterday: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), -1),
);

// Every minute of the window at :20 and :50, from `fromMinute` to `toMinute`.
function everyMinute(input: {
  pod: string;
  fromMinute?: number;
  toMinute?: number;
  arrive: (timeMs: number) => number;
}): Array<Row> {
  const rows: Array<Row> = [];

  for (
    let minute: number = input.fromMinute ?? 0;
    minute <= (input.toMinute ?? 14);
    minute++
  ) {
    for (const second of [20, 50]) {
      // A millisecond part, which a DateTime64(9) keeps.
      const timeMs: number =
        WINDOW_START_MS + minute * MINUTE + second * SECOND + 123;
      rows.push({
        pod: input.pod,
        timeMs: timeMs,
        createdAtMs: input.arrive(timeMs),
      });
    }
  }

  return rows;
}

// The next five-minute mark after a time, and 7 seconds: a batch delivery.
function nextDelivery(timeMs: number): number {
  return (
    Math.floor(timeMs / (5 * MINUTE)) * 5 * MINUTE + 5 * MINUTE + 7 * SECOND
  );
}

const ROWS: Array<Row> = [
  // Sent as read: written two seconds after each reading.
  ...everyMinute({
    pod: "on-time",
    arrive: (timeMs: number) => {
      return timeMs + 2 * SECOND;
    },
  }),
  // A collector whose clock runs three minutes behind.
  ...everyMinute({
    pod: "clock-behind",
    arrive: (timeMs: number) => {
      return timeMs + 3 * MINUTE;
    },
  }),
  // Five minutes of readings delivered at once, every five minutes.
  ...everyMinute({ pod: "batched", arrive: nextDelivery }),
  // Reported for the first five minutes, then stopped.
  ...everyMinute({
    pod: "stopped",
    toMinute: 4,
    arrive: (timeMs: number) => {
      return timeMs + 2 * SECOND;
    },
  }),
  // Sent as read, and one old reading sent again long after - a retry.
  ...everyMinute({
    pod: "resent",
    arrive: (timeMs: number) => {
      return timeMs + 2 * SECOND;
    },
  }),
  {
    pod: "resent",
    timeMs: WINDOW_START_MS + 3 * MINUTE + 20 * SECOND + 123,
    createdAtMs: WINDOW_END_MS + 4 * MINUTE,
  },
];

/*
 * Rows the reads must leave out: another cluster, another project, a time
 * after the window, and rows past their retention - each written later than
 * any row read, so any that slipped in would change the newest arrival.
 */
const LEFT_OUT: Array<Row> = [
  { pod: "on-time", cluster: "staging" },
  { pod: "on-time", projectId: otherProjectId },
  { pod: "on-time", timeMs: WINDOW_END_MS + 30 * SECOND },
  { pod: "on-time", retentionDate: yesterday },
].map((shape: Partial<Row>): Row => {
  return {
    pod: shape.pod!,
    timeMs: shape.timeMs ?? WINDOW_START_MS + 7 * MINUTE,
    createdAtMs: WINDOW_END_MS + 9 * MINUTE,
    ...(shape.cluster ? { cluster: shape.cluster } : {}),
    ...(shape.projectId ? { projectId: shape.projectId } : {}),
    ...(shape.retentionDate ? { retentionDate: shape.retentionDate } : {}),
  };
});

let rowIndex: number = 0;

function metricRow(row: Row): JSONObject {
  rowIndex++;

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date(row.createdAtMs)),
    projectId: (row.projectId || projectId).toString(),
    primaryEntityId: "6b2e3d4c-0000-4000-8000-0000000000ff",
    primaryEntityType: "Service",
    name: CPU,
    aggregationTemporality: "Delta",
    metricPointType: "Gauge",
    time: OneUptimeDate.toClickhouseDateTime64(new Date(row.timeMs)),
    timeUnixNano: String(row.timeMs * 1000000 + (rowIndex % 1000000)),
    attributes: {
      [POD_KEY]: row.pod,
      [CLUSTER_KEY]: row.cluster || "prod",
    },
    attributeKeys: [CLUSTER_KEY, POD_KEY],
    entityKeys: [],
    value: 0.5,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    retentionDate: row.retentionDate || inThirtyDays,
  };
}

// What a series' rows fold to, worked out from the rows themselves.
function expectedAggregates(pod: string): MetricSeriesArrivalAggregates {
  const rows: Array<Row> = ROWS.filter((row: Row) => {
    return row.pod === pod;
  });
  // createdAt is a DateTime: kept to the second.
  const arrivalsMs: Array<number> = rows.map((row: Row) => {
    return Math.floor(row.createdAtMs / SECOND) * SECOND;
  });
  const newestPoint: Row = rows.reduce((newest: Row, row: Row) => {
    return row.timeMs > newest.timeMs ? row : newest;
  });

  return {
    newestArrivalMs: Math.max(...arrivalsMs),
    oldestArrivalMs: Math.min(...arrivalsMs),
    arrivalMinuteCount: new Set(
      arrivalsMs.map((arrivedMs: number) => {
        return Math.floor(arrivedMs / MINUTE);
      }),
    ).size,
    newestPointArrivalMs: Math.floor(newestPoint.createdAtMs / SECOND) * SECOND,
    newestPointTimeMs: newestPoint.timeMs,
  };
}

function windowRange(): InBetween<Date> {
  return new InBetween<Date>(
    new Date(WINDOW_START_MS),
    new Date(WINDOW_END_MS),
  );
}

async function readGrouped(): Promise<Array<MetricSeriesArrivalRow>> {
  return await MetricService.readSeriesArrivals({
    query: {
      projectId: projectId,
      time: windowRange(),
      name: CPU,
      attributes: WATCHED,
    },
    groupByAttributeKeys: [POD_KEY],
    limit: 50000,
    props: { isRoot: true },
  });
}

function byPod(
  rows: Array<MetricSeriesArrivalRow>,
): Record<string, MetricSeriesArrivalAggregates> {
  const result: Record<string, MetricSeriesArrivalAggregates> = {};

  for (const row of rows) {
    result[String(row.attributes[POD_KEY])] = row.aggregates;
  }

  return result;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
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

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration(
  "When a monitor's series got their data, read from ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: ServiceConnection | undefined;

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      // Connecting creates the database.
      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 120000,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      await createTable(client, clickhouse, Metric);

      original = {
        database: MetricService.database,
        databaseClient: MetricService.databaseClient,
        ingestDatabase: MetricService.ingestDatabase,
        ingestDatabaseClient: MetricService.ingestDatabaseClient,
      };
      MetricService.database = clickhouse;
      MetricService.databaseClient = client;
      MetricService.ingestDatabase = clickhouse;
      MetricService.ingestDatabaseClient = client;

      await MetricService.insertJsonRows(
        [...ROWS, ...LEFT_OUT].map(metricRow),
        {
          clickhouseSettings: { wait_for_async_insert: 1 },
        },
      );
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(MetricService, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test("a row a series, each folded from its own rows - and only the rows the query reads", async () => {
      const rows: Array<MetricSeriesArrivalRow> = await readGrouped();

      expect(rows).toHaveLength(5);
      expect(byPod(rows)).toEqual({
        "on-time": expectedAggregates("on-time"),
        "clock-behind": expectedAggregates("clock-behind"),
        batched: expectedAggregates("batched"),
        stopped: expectedAggregates("stopped"),
        resent: expectedAggregates("resent"),
      });

      // Each row's map is the grouped key alone, as a grouped read's.
      for (const row of rows) {
        expect(Object.keys(row.attributes)).toEqual([POD_KEY]);
      }
    });

    test("the newest data point's createdAt and time - not the newest createdAt - give the lag", async () => {
      const aggregates: MetricSeriesArrivalAggregates = byPod(
        await readGrouped(),
      )["clock-behind"]!;

      // A DateTime64(9) keeps its milliseconds.
      expect(aggregates.newestPointTimeMs % SECOND).toBe(123);
      expect(
        aggregates.newestPointArrivalMs - aggregates.newestPointTimeMs,
      ).toBe(3 * MINUTE - 123);
    });

    test("an old reading sent again moves the newest arrival, never the lag", async () => {
      const resent: MetricSeriesArrivalAggregates = byPod(await readGrouped())[
        "resent"
      ]!;

      expect(resent.newestArrivalMs).toBe(WINDOW_END_MS + 4 * MINUTE);
      // The newest data point's own arrival: two seconds after it was taken.
      expect(resent.newestPointArrivalMs - resent.newestPointTimeMs).toBe(
        2 * SECOND - 123,
      );
    });

    test("a batch written at once is one arrival minute: 30 readings delivered five minutes at a time arrive in three or four", async () => {
      const read: Record<string, MetricSeriesArrivalAggregates> = byPod(
        await readGrouped(),
      );

      expect(read["batched"]!.arrivalMinuteCount).toBeGreaterThanOrEqual(3);
      expect(read["batched"]!.arrivalMinuteCount).toBeLessThanOrEqual(4);
      // Sent as read, one minute's two readings arrive in the same minute.
      expect(read["on-time"]!.arrivalMinuteCount).toBe(15);
    });

    test("an ungrouped query reads one row; a window with nothing in it reads none", async () => {
      const one: Array<MetricSeriesArrivalRow> =
        await MetricService.readSeriesArrivals({
          query: {
            projectId: projectId,
            time: windowRange(),
            name: CPU,
            attributes: STOPPED_ONLY,
          },
          limit: 50000,
          props: { isRoot: true },
        });

      expect(one).toEqual([
        { attributes: {}, aggregates: expectedAggregates("stopped") },
      ]);

      expect(
        await MetricService.readSeriesArrivals({
          query: {
            projectId: projectId,
            time: new InBetween<Date>(
              new Date(WINDOW_END_MS + 2 * MINUTE),
              new Date(WINDOW_END_MS + 3 * MINUTE),
            ),
            name: CPU,
            attributes: WATCHED,
          },
          limit: 50000,
          props: { isRoot: true },
        }),
      ).toEqual([]);
    });

    test("the worker's read of a query that looks behind hands over each series' arrivals by fingerprint, measured to the window's end", async () => {
      const read: QueryDataPoints = await readQueryDataPoints({
        query: {
          projectId: projectId,
          time: windowRange(),
          name: CPU,
          attributes: WATCHED,
        },
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKeys: [POD_KEY],
        groupBy: undefined,
        startAndEndDate: windowRange(),
        judgesFreshness: true,
      });

      expect(read.arrivals).not.toBeNull();

      const arrivalOf: (pod: string) => MetricSeriesArrival = (
        pod: string,
      ): MetricSeriesArrival => {
        return read.arrivals!.bySeries.get(
          MetricSeriesFingerprint.computeFingerprint({ [POD_KEY]: pod }),
        )!;
      };

      // The stopped series' newest row arrived five minutes into the window.
      expect(arrivalOf("stopped").sinceNewestArrivalMs).toBe(
        WINDOW_END_MS - expectedAggregates("stopped").newestArrivalMs,
      );
      expect(arrivalOf("stopped").sinceNewestArrivalMs).toBeGreaterThan(
        9 * MINUTE,
      );
      // Sent as read: its newest row arrived eight seconds before the end.
      expect(arrivalOf("on-time").sinceNewestArrivalMs).toBe(8 * SECOND);
      // What arrived after the window's end counts as arrived at it.
      expect(arrivalOf("clock-behind").sinceNewestArrivalMs).toBe(0);
      expect(arrivalOf("resent").sinceNewestArrivalMs).toBe(0);
      expect(arrivalOf("resent").lagMs).toBe(2 * SECOND - 123);

      expect(arrivalOf("clock-behind").lagMs).toBe(3 * MINUTE - 123);
      expect(arrivalOf("on-time").lagMs).toBe(2 * SECOND - 123);
      // Delivered every five minutes.
      expect(arrivalOf("batched").arrivalIntervalMs).toBeGreaterThanOrEqual(
        4 * MINUTE,
      );
      expect(arrivalOf("on-time").arrivalIntervalMs).toBeLessThan(1.2 * MINUTE);
    });

    test("a step that judges no freshness reads no arrivals", async () => {
      const read: QueryDataPoints = await readQueryDataPoints({
        query: {
          projectId: projectId,
          time: windowRange(),
          name: CPU,
          attributes: WATCHED,
        },
        aggregationType: MetricsAggregationType.Avg,
        groupByAttributeKeys: [POD_KEY],
        groupBy: undefined,
        startAndEndDate: windowRange(),
      });

      expect(read.arrivals).toBeNull();
      // The data points are read as ever.
      expect(read.aggregatedResult.data.length).toBeGreaterThan(0);
    });

    test("the older analyzer reads the same arrivals", async () => {
      const found: { json: () => Promise<unknown> } = await client.query({
        query:
          "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
        format: "JSONEachRow",
      });
      const [setting] = (await found.json()) as Array<{ name: string }>;

      if (!setting) {
        return;
      }

      const current: Record<string, MetricSeriesArrivalAggregates> = byPod(
        await readGrouped(),
      );

      const executeQuery: typeof MetricService.executeQuery =
        MetricService.executeQuery.bind(MetricService);
      const settingsSeen: Array<unknown> = [];

      jest
        .spyOn(MetricService, "executeQuery")
        .mockImplementation(
          (
            statement: Statement | string,
            runOptions?: ClickhouseExecuteOptions,
          ): Promise<never> => {
            const clickhouseSettings: ClickHouseSettings = {
              ...(runOptions?.clickhouseSettings || {}),
              [setting.name]: 0,
            } as ClickHouseSettings;
            settingsSeen.push(
              (clickhouseSettings as Record<string, unknown>)[setting.name],
            );
            return executeQuery(statement, {
              ...(runOptions || {}),
              clickhouseSettings: clickhouseSettings,
            }) as Promise<never>;
          },
        );

      try {
        const older: Record<string, MetricSeriesArrivalAggregates> = byPod(
          await readGrouped(),
        );

        expect(settingsSeen.length).toBeGreaterThan(0);
        expect(new Set(settingsSeen)).toEqual(new Set([0]));
        expect(older).toEqual(current);
      } finally {
        jest.restoreAllMocks();
      }
    });
  },
);

describe("Series arrivals ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
