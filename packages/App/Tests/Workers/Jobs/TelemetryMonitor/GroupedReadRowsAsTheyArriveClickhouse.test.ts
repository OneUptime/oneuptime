import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AggregateBy from "Common/Server/Types/AnalyticsDatabase/AggregateBy";
import { ClickhouseRowsRead } from "Common/Server/Utils/AnalyticsDatabase/ClickhouseReadResult";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import QueryTimeoutException from "Common/Types/Exception/QueryTimeoutException";
import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import ObjectID from "Common/Types/ObjectID";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
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
 * A grouped metric query's rows, read as they stream in, against a real
 * ClickHouse (issue #10316).
 *
 * An aggregate grouped by attribute keys - a grouped Metrics monitor's read,
 * a row per series and bucket - is now asked for as
 * JSONCompactEachRowWithNames and read a line at a time as its bytes arrive
 * (AnalyticsDatabaseService.readRowsAsTheyArrive), where it was read whole
 * as one FORMAT JSON document. What a stand-in cannot show is what a real
 * server writes: that each value of every column type reads exactly as
 * FORMAT JSON writes it, that an answer with no rows still has its names
 * line, and how the server itself ends an answer that fails after its rows
 * - 26.x's __exception__ block and dropped connection, 24.x's error row -
 * or stops at its time limit. So this suite reads the same statements both
 * ways from a real server, and the grouped reads of a fleet both ways
 * through MetricService.aggregateBy and the worker's readQueryDataPoints.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server
 * (26.7, which docker-compose ships; 24.8 reads the same):
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/GroupedReadRowsAsTheyArriveClickhouse.test.ts
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

import MetricService from "Common/Server/Services/MetricService";
import {
  QueryDataPoints,
  readQueryDataPoints,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `grouped_rows_arrive_test_${process.pid}_${Date.now()}`;

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

const WINDOW_END_MS: number =
  Math.floor(Date.now() / MINUTE) * MINUTE - 3 * MINUTE;
const WINDOW_START_MS: number = WINDOW_END_MS - 15 * MINUTE;

const projectId: ObjectID = new ObjectID(
  "6a1d2c3b-0000-4000-8000-0000000a0316",
);
const otherProjectId: ObjectID = new ObjectID(
  "6a1d2c3b-0000-4000-8000-0000000b0316",
);

const HOST_KEY: string = "resource.host.name";
const CONTAINER_KEY: string = "resource.container.name";
const CPU: string = "container.cpu.utilization";

// Hosts by every script, and the text a label can hold.
const HOST_TEXTS: Array<string> = [
  "docker-host-0001.prod.fleet.internal",
  "é→😀 host",
  "中文主机-東京",
  "خادم الدفع",
  'quote " and backslash \\',
  "tab\tand newline\n",
  "🇩🇪🏳️‍🌈",
  "",
];

const HOSTS: number = 40;
const CONTAINERS_PER_HOST: number = 30;
const POINT_SECONDS: Array<number> = [5, 25, 45];

const inThirtyDays: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

let rowIndex: number = 0;

function hostName(index: number): string {
  return `${HOST_TEXTS[index % HOST_TEXTS.length]!}-${index}`;
}

function metricRow(data: {
  timeMs: number;
  value: number;
  attributes: Record<string, string>;
  projectId: ObjectID;
}): JSONObject {
  rowIndex++;

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: data.projectId.toString(),
    primaryEntityId: "6a1d2c3b-0000-4000-8000-0000000000ff",
    primaryEntityType: "Service",
    name: CPU,
    aggregationTemporality: "Delta",
    metricPointType: "Gauge",
    time: OneUptimeDate.toClickhouseDateTime64(new Date(data.timeMs)),
    timeUnixNano: String(data.timeMs * 1000000 + (rowIndex % 1000000)),
    attributes: data.attributes,
    attributeKeys: Object.keys(data.attributes).sort(),
    entityKeys: [],
    value: data.value,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    retentionDate: inThirtyDays,
  };
}

// 1,200 containers over 40 hosts, three points a minute for 15 minutes.
function fleetRows(random: SeededRandom): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (let host: number = 0; host < HOSTS; host++) {
    for (
      let container: number = 0;
      container < CONTAINERS_PER_HOST;
      container++
    ) {
      for (let minute: number = 0; minute < 15; minute++) {
        for (const second of POINT_SECONDS) {
          rows.push(
            metricRow({
              timeMs: WINDOW_START_MS + minute * MINUTE + second * SECOND,
              /*
               * Quarters, which binary floating point holds exactly: a
               * sum is the same in whatever order the threads of a
               * server's aggregation add it up, and so is an average.
               */
              value: random(10000) / 4,
              attributes: {
                [HOST_KEY]: hostName(host),
                [CONTAINER_KEY]: `container-${host}-${container}`,
              },
              projectId: projectId,
            }),
          );
        }
      }
    }
  }

  // Another project's rows: no read of this one may see them.
  for (let index: number = 0; index < 200; index++) {
    rows.push(
      metricRow({
        timeMs: WINDOW_START_MS + 5 * MINUTE,
        value: 999,
        attributes: { [HOST_KEY]: hostName(0), [CONTAINER_KEY]: "other" },
        projectId: otherProjectId,
      }),
    );
  }

  return rows;
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

function windowRange(): InBetween<Date> {
  return new InBetween<Date>(
    new Date(WINDOW_START_MS),
    new Date(WINDOW_END_MS),
  );
}

function groupedRequest(
  overrides: Partial<AggregateBy<Metric>> = {},
): AggregateBy<Metric> {
  return {
    query: {
      projectId: projectId,
      time: windowRange(),
      name: CPU,
    },
    aggregationType: AggregationType.Avg,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    aggregationInterval: AggregationInterval.Minute,
    startTimestamp: new Date(WINDOW_START_MS),
    endTimestamp: new Date(WINDOW_END_MS),
    groupByAttributeKeys: [HOST_KEY, CONTAINER_KEY],
    limit: 50_000,
    skip: 0,
    props: { isRoot: true },
    ...overrides,
  } as AggregateBy<Metric>;
}

/*
 * An aggregate's rows with those of one bucket in one order. Its statement
 * orders by time, newest first, and ClickHouse is free to hand the series of
 * a minute over in any order - two runs of one statement on 24.8, which
 * aggregates on several threads, do not agree on it - so two reads are held
 * to the same rows, ties in a fixed order. How the rows of one answer are
 * read, in its order, is ClickhouseReadRows' and the suite of every column
 * type's above.
 */
function inBucketOrder(result: AggregatedResult): AggregatedResult {
  const keyOf: (row: AggregatedModel) => string = (
    row: AggregatedModel,
  ): string => {
    return `${new Date(row.timestamp).toISOString()}|${JSON.stringify(row["attributes"])}`;
  };

  return {
    ...result,
    data: [...result.data].sort(
      (a: AggregatedModel, b: AggregatedModel): number => {
        const left: string = keyOf(a);
        const right: string = keyOf(b);
        return left < right ? -1 : left > right ? 1 : 0;
      },
    ),
  };
}

// The same work, with every read of an aggregate as one FORMAT JSON document.
async function asOneDocument<T>(work: () => Promise<T>): Promise<T> {
  const spy: ReturnType<typeof jest.spyOn> = jest
    .spyOn(
      MetricService as unknown as {
        readsAggregateRowsAsTheyArrive: () => boolean;
      },
      "readsAggregateRowsAsTheyArrive",
    )
    .mockReturnValue(false);

  try {
    return await work();
  } finally {
    spy.mockRestore();
  }
}

// How often the rows-as-they-arrive read ran during `work`.
async function streamedReadsDuring(
  work: () => Promise<unknown>,
): Promise<number> {
  const spy: ReturnType<typeof jest.spyOn> = jest.spyOn(
    MetricService,
    "readRowsAsTheyArrive",
  );

  try {
    await work();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

async function rowsOf(statement: string): Promise<{
  rows: Array<JSONObject>;
  read: ClickhouseRowsRead;
}> {
  const rows: Array<JSONObject> = [];
  const read: ClickhouseRowsRead = await MetricService.readRowsAsTheyArrive({
    statement: statement,
    onRow: (row: JSONObject): void => {
      rows.push(row);
    },
  });

  return { rows, read };
}

async function documentRowsOf(statement: string): Promise<Array<JSONObject>> {
  const result: { data: Array<JSONObject> } = (await (
    await MetricService.executeQuery(statement)
  ).json()) as { data: Array<JSONObject> };

  return result.data;
}

/*
 * The client's ClickHouseError, by its name: App reads ClickHouse through
 * Common, and does not depend on the client itself.
 */
interface ClickHouseError extends Error {
  code: string;
  type: string;
}

function expectClickHouseError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).constructor.name).toBe("ClickHouseError");
  expect((error as ClickHouseError).code).toBe(code);
}

async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to fail, and it succeeded.");
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration("A grouped metric query's rows, read as they stream in", () => {
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

    const rows: Array<JSONObject> = fleetRows(seededRandom(10316));
    for (let start: number = 0; start < rows.length; start += 20000) {
      await MetricService.insertJsonRows(rows.slice(start, start + 20000), {
        clickhouseSettings: { wait_for_async_insert: 1 },
      });
    }
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

  describe("every value reads as FORMAT JSON writes it", () => {
    test("every column type a read returns, 20,000 rows of it", async () => {
      const statement: string = `
        SELECT
          toNullable(number / 7) AS value,
          toDateTime64('2026-11-17 10:04:00', 9) + number AS time,
          toDateTime('2026-11-17 10:04:00') AS whole_second,
          map('${HOST_KEY}', concat('host-', toString(number % 40)), 'k"q', 'é→😀\\n\\t\\\\', '中文', 'خادم') AS attributes,
          toUInt64(number) * 1000000007 AS u64,
          -toInt64(number) AS i64,
          toUInt32(number) AS u32,
          toDecimal64(number / 3, 4) AS dec,
          [number, number + 1] AS list,
          if(number % 5 = 0, NULL, toString(number)) AS maybe_text,
          toLowCardinality(toString(number % 3)) AS low_cardinality,
          number % 2 = 0 AS flag,
          generateUUIDv4(number) IS NOT NULL AS has_uuid,
          if(number % 11 = 0, nan, if(number % 13 = 0, inf, number / 3)) AS odd_float,
          toString(number) AS __total_groups
        FROM numbers(20000)
      `;

      const streamed: { rows: Array<JSONObject>; read: ClickhouseRowsRead } =
        await rowsOf(statement);

      expect(streamed.read.rowCount).toBe(20000);
      expect(streamed.read.columns).toEqual([
        "value",
        "time",
        "whole_second",
        "attributes",
        "u64",
        "i64",
        "u32",
        "dec",
        "list",
        "maybe_text",
        "low_cardinality",
        "flag",
        "has_uuid",
        "odd_float",
        "__total_groups",
      ]);
      expect(streamed.rows).toEqual(await documentRowsOf(statement));
    });

    test("an answer with no rows: no rows, and its columns", async () => {
      const statement: string =
        "SELECT number AS value, toDateTime64(now(), 9) AS time FROM numbers(10) WHERE number > 100";
      const streamed: { rows: Array<JSONObject>; read: ClickhouseRowsRead } =
        await rowsOf(statement);

      expect(streamed.rows).toEqual([]);
      expect(streamed.read.columns).toEqual(["value", "time"]);
      expect(await documentRowsOf(statement)).toEqual([]);
    });

    test("one row", async () => {
      const statement: string = "SELECT 1.5 AS value, 'é→😀' AS label";

      expect((await rowsOf(statement)).rows).toEqual(
        await documentRowsOf(statement),
      );
    });
  });

  describe("an answer ClickHouse ends early is the error it ends with", () => {
    test("an error after the rows, as the server frames it, is a ClickHouseError with its code", async () => {
      // No time limit: the server streams, and writes the error after rows.
      const error: unknown = await failureOf(() => {
        return rowsOf(
          "SELECT number AS value, throwIf(number = 50000, 'boom after rows') AS t FROM numbers(100000) SETTINGS max_block_size = 1000",
        );
      });

      expectClickHouseError(error, "395");
      expect((error as ClickHouseError).type).toBe(
        "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      );
    });

    test("the same under a time limit, which waits for the end of the query", async () => {
      const error: unknown = await failureOf(() => {
        return rowsOf(
          "SELECT number AS value, throwIf(number = 50000, 'boom after rows') AS t FROM numbers(100000) SETTINGS max_execution_time = 45, timeout_overflow_mode = 'throw', max_block_size = 1000",
        );
      });

      expectClickHouseError(error, "395");
    });

    test("a read stopped at its time limit is a QueryTimeoutException that names it", async () => {
      const error: unknown = await failureOf(() => {
        return rowsOf(
          "SELECT sleepEachRow(0.05) AS slept, number AS value FROM numbers(200) SETTINGS max_execution_time = 1, timeout_overflow_mode = 'throw', max_block_size = 1",
        );
      });

      expect(error).toBeInstanceOf(QueryTimeoutException);
      expect((error as Error).message).toBe(
        "This query took longer than 1 second and was stopped before it finished. Try a shorter time range or more specific filters.",
      );
    });
  });

  describe("a fleet's grouped reads aggregate the same as one document", () => {
    test.each([
      AggregationType.Avg,
      AggregationType.Sum,
      AggregationType.Min,
      AggregationType.Max,
      AggregationType.Count,
    ])(
      "%s: a row per container and minute, the same rows both ways",
      async (aggregationType: AggregationType) => {
        const request: () => AggregateBy<Metric> = (): AggregateBy<Metric> => {
          return groupedRequest({ aggregationType: aggregationType });
        };

        let streamed: AggregatedResult | undefined = undefined;
        const streamedReads: number = await streamedReadsDuring(async () => {
          streamed = await MetricService.aggregateBy(request());
        });
        const whole: AggregatedResult = await asOneDocument(() => {
          return MetricService.aggregateBy(request());
        });

        expect(streamedReads).toBe(1);
        expect(inBucketOrder(streamed!)).toEqual(inBucketOrder(whole));
        // Every container's every minute, and no other project's row.
        expect(streamed!.data).toHaveLength(HOSTS * CONTAINERS_PER_HOST * 15);
        expect(streamed!.truncated).toBe(false);
      },
    );

    test("a read past its limit is cut and says so, the same both ways", async () => {
      /*
       * Two whole minutes of the fleet: a cut inside a minute would keep
       * whichever of its series ClickHouse handed over first.
       */
      const limit: number = HOSTS * CONTAINERS_PER_HOST * 2;
      const streamed: AggregatedResult = await MetricService.aggregateBy(
        groupedRequest({ limit: limit }),
      );
      const whole: AggregatedResult = await asOneDocument(() => {
        return MetricService.aggregateBy(groupedRequest({ limit: limit }));
      });

      expect(streamed.truncated).toBe(true);
      expect(streamed.data).toHaveLength(limit);
      expect(inBucketOrder(streamed)).toEqual(inBucketOrder(whole));
    });

    test("a window with no data, the same both ways", async () => {
      const future: InBetween<Date> = new InBetween<Date>(
        new Date(WINDOW_END_MS + 60 * MINUTE),
        new Date(WINDOW_END_MS + 75 * MINUTE),
      );
      const request: () => AggregateBy<Metric> = (): AggregateBy<Metric> => {
        return groupedRequest({
          query: { projectId: projectId, time: future, name: CPU },
          startTimestamp: future.startValue,
          endTimestamp: future.endValue,
        });
      };

      const streamed: AggregatedResult =
        await MetricService.aggregateBy(request());

      expect(streamed).toEqual({ data: [], truncated: false });
      expect(streamed).toEqual(
        await asOneDocument(() => {
          return MetricService.aggregateBy(request());
        }),
      );
    });

    test("the monitor's own read of a query - the series, their samples' attributes - the same both ways", async () => {
      const read: () => Promise<QueryDataPoints> =
        (): Promise<QueryDataPoints> => {
          return readQueryDataPoints({
            query: {
              projectId: projectId,
              time: windowRange(),
              name: CPU,
            },
            aggregationType: MetricsAggregationType.Max,
            groupByAttributeKeys: [HOST_KEY, CONTAINER_KEY],
            groupBy: undefined,
            startAndEndDate: windowRange(),
          });
        };

      let streamed: QueryDataPoints | undefined = undefined;
      const streamedReads: number = await streamedReadsDuring(async () => {
        streamed = await read();
      });
      const whole: QueryDataPoints = await asOneDocument(read);

      expect(streamedReads).toBeGreaterThanOrEqual(1);
      expect({
        ...streamed!,
        aggregatedResult: inBucketOrder(streamed!.aggregatedResult),
      }).toEqual({
        ...whole,
        aggregatedResult: inBucketOrder(whole.aggregatedResult),
      });
      expect(streamed!.aggregatedResult.data).toHaveLength(
        HOSTS * CONTAINERS_PER_HOST * 15,
      );
    });
  });
});

describe("Grouped rows-as-they-arrive ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
