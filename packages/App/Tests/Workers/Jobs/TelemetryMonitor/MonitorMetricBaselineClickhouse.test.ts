import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "Common/Types/Metrics/MetricQueryData";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricBaselineHourly from "Common/Models/AnalyticsModels/MetricBaselineHourly";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import MetricBaselineService, {
  BandPoint,
  BaselineBand,
  BaselineSummary,
  MetricBaselineQuery,
  MetricBaselineService as MetricBaselineServiceClass,
} from "Common/Server/Services/MetricBaselineService";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import MetricMonitorCriteria from "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MetricHourBaseline from "Common/Server/Utils/Monitor/MetricHourBaseline";
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
 * A metric's baseline against a real ClickHouse server.
 *
 * MetricHourBaseline.test.ts pins the arithmetic and MetricBaselineService.test.ts
 * the words of the SQL. What they cannot show is that the SQL does what it
 * says: that the hour being judged really is left out of what it is judged
 * against, that the rows of the other days are the same hour of the day, across
 * the end of the week, that the states merge as the arithmetic takes them to,
 * and that all of it holds in a server of another zone. So this suite builds
 * the rollup and its view from the real models, writes samples as ingest writes
 * them, and reads them back through getBaseline.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/MonitorMetricBaselineClickhouse.test.ts
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

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `metric_baseline_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const WEEK: number = 7 * DAY;

/*
 * The minute judged, in a clock hour that has passed, and well inside its day:
 * the hour is read back on every day before it, so nothing here is near now.
 */
const dayStart: number = Math.floor((Date.now() - 2 * DAY) / DAY) * DAY;
const hourStart: number = dayStart + 9 * HOUR;
const judgedAt: Date = new Date(hourStart + 40 * MINUTE);

// The latest Monday 00:00 UTC two days behind us, for a read across the week's end.
const weekTurn: number =
  Math.floor((Date.now() - 2 * DAY - 4 * DAY) / WEEK) * WEEK + 4 * DAY;

const METRIC: string = "queue.depth";

const checkoutId: ObjectID = new ObjectID("7b00000000000000000000b1");
const otherServiceId: ObjectID = new ObjectID("7b00000000000000000000b2");

let nextProject: number = 1;

// A project of its own, so a test reads only the rows it wrote.
function newProject(): ObjectID {
  return new ObjectID(
    `7b00000000000000000000${(nextProject++).toString(16).padStart(2, "0")}`,
  );
}

const retention: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

let rowIndex: number = 0;

interface Sample {
  project: ObjectID;
  time: number;
  value: number;
  metric?: string;
  serviceId?: ObjectID;
  // A histogram's datapoint: how many observations `value` is the sum of.
  count?: number;
}

// A sample as ingest writes it: UTC text with no zone.
function rowOf(sample: Sample): JSONObject {
  const time: Date = new Date(sample.time);

  rowIndex++;

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: sample.project.toString(),
    primaryEntityId: (sample.serviceId || checkoutId).toString(),
    primaryEntityType: "Service",
    name: sample.metric || METRIC,
    aggregationTemporality: "Delta",
    metricPointType: sample.count === undefined ? "Gauge" : "Histogram",
    ...(sample.count === undefined
      ? {}
      : { count: sample.count, sum: sample.value }),
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + rowIndex),
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    value: sample.value,
    retentionDate: retention,
  };
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

  // The rollup's own view, read from the table it is written for.
  for (const view of model.materializedViews || []) {
    await client.command({ query: view.query });
  }
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration("A metric's baseline against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let zoned: ClickhouseDatabase;
  let zonedClient: ClickhouseClient;
  let original: ServiceConnection | undefined;

  async function write(
    samples: Array<Sample>,
    connection?: ClickhouseClient,
  ): Promise<void> {
    await (connection || client).insert({
      table: `${database}.${new Metric().tableName}`,
      format: "JSONEachRow",
      values: samples.map(rowOf),
    });
  }

  /*
   * An hour's samples: one a minute around `mean`, so that the hour has a
   * spread of `spread`, in equal parts above and below it.
   */
  function hourOf(data: {
    project: ObjectID;
    start: number;
    mean: number;
    spread?: number;
    minutes?: number;
    serviceId?: ObjectID;
    metric?: string;
  }): Array<Sample> {
    const spread: number = data.spread ?? 0;

    return new Array<number>(data.minutes ?? 60)
      .fill(0)
      .map((_: number, minute: number): Sample => {
        return {
          project: data.project,
          time: data.start + minute * MINUTE,
          value: data.mean + (minute % 2 === 0 ? spread : -spread),
          ...(data.serviceId ? { serviceId: data.serviceId } : {}),
          ...(data.metric ? { metric: data.metric } : {}),
        };
      });
  }

  function read(
    project: ObjectID,
    input: {
      at?: Date;
      primaryEntityId?: ObjectID | Array<ObjectID>;
      windowDays?: number;
      query?: Partial<MetricBaselineQuery>;
    } = {},
  ): Promise<BaselineSummary | null> {
    const at: Date = input.at || judgedAt;

    return MetricBaselineService.getBaseline({
      projectId: project,
      metricName: METRIC,
      hourOfWeek: MetricBaselineServiceClass.computeHourOfWeek(at),
      judgedAt: at,
      ...(input.primaryEntityId
        ? { primaryEntityId: input.primaryEntityId }
        : {}),
      ...(input.windowDays ? { windowDays: input.windowDays } : {}),
      ...(input.query
        ? {
            query: {
              aggregationType: AggregationType.Avg,
              isNarrowedByAttributes: false,
              interval: AggregationInterval.Minute,
              ...input.query,
            },
          }
        : {}),
    });
  }

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
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    /*
     * A server in another zone, without one to hand: every statement of a
     * session in that zone reads and writes as such a server does.
     */
    const zonedOptions: ClickHouseClientConfigOptions = {
      ...options,
      clickhouse_settings: { session_timezone: "Asia/Tokyo" },
    };

    zoned = new ClickhouseDatabase(zonedOptions);
    zonedClient = await zoned.connect(zonedOptions);

    await createTable(client, clickhouse, Metric);
    await createTable(client, clickhouse, MetricBaselineHourly);
    await createTable(client, clickhouse, MetricItemAggMV1m);

    original = {
      database: MetricBaselineService.database,
      databaseClient: MetricBaselineService.databaseClient,
      ingestDatabase: MetricBaselineService.ingestDatabase,
      ingestDatabaseClient: MetricBaselineService.ingestDatabaseClient,
    };

    MetricBaselineService.database = clickhouse;
    MetricBaselineService.databaseClient = client;
    MetricBaselineService.ingestDatabase = clickhouse;
    MetricBaselineService.ingestDatabaseClient = client;
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(MetricBaselineService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (zoned) {
      await zoned.disconnect();
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  /*
   * The view numbers the week from toDayOfWeek(time, 1), which makes Monday 0.
   * Nothing but a real server could show what that stores, and every check
   * used to read the next weekday's rows.
   */
  describe("the rollup's hours", () => {
    test("the view stores a Monday past the end of the week, and every other day a day behind", async () => {
      const project: ObjectID = newProject();
      const monday: number = weekTurn - WEEK;

      await write([
        { project, time: monday + 9 * HOUR, value: 1 },
        { project, time: monday + DAY, value: 1 },
        { project, time: monday + 6 * DAY + 23 * HOUR, value: 1 },
      ]);

      const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await client.query({
          query: `SELECT hourOfWeek FROM ${database}.${new MetricBaselineHourly().tableName} WHERE projectId = '${project.toString()}' ORDER BY day`,
          format: "JSON",
        })) as unknown as { json: () => Promise<{ data: Array<JSONObject> }> };

      expect(
        (await result.json()).data.map((row: JSONObject): number => {
          return Number(row["hourOfWeek"]);
        }),
      ).toEqual([241, 0, 143]);
    });

    test("every hour the code can name is the number the view stored it under", async () => {
      const project: ObjectID = newProject();
      const monday: number = weekTurn - WEEK;
      const samples: Array<Sample> = [];

      for (let hour: number = 0; hour < 168; hour++) {
        samples.push({ project, time: monday + hour * HOUR, value: 1 });
      }

      await write(samples);

      const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await client.query({
          query: `SELECT hourOfWeek FROM ${database}.${new MetricBaselineHourly().tableName} WHERE projectId = '${project.toString()}' GROUP BY hourOfWeek ORDER BY hourOfWeek`,
          format: "JSON",
        })) as unknown as { json: () => Promise<{ data: Array<JSONObject> }> };

      const stored: Array<number> = (await result.json()).data.map(
        (row: JSONObject): number => {
          return Number(row["hourOfWeek"]);
        },
      );

      expect(stored).toHaveLength(168);

      for (let hour: number = 0; hour < 168; hour++) {
        expect(stored).toContain(MetricHourBaseline.toStoredHour(hour));
      }
    });

    test.each([
      ["Monday", 0],
      ["Tuesday", 1],
      ["Wednesday", 2],
      ["Thursday", 3],
      ["Friday", 4],
      ["Saturday", 5],
      ["Sunday", 6],
    ])("a check on a %s reads that weekday", async (_: string, weekday: number) => {
      const project: ObjectID = newProject();
      const monday: number = weekTurn - 3 * WEEK;
      const samples: Array<Sample> = [];

      for (let week: number = 0; week < 2; week++) {
        for (let day: number = 0; day < 7; day++) {
          samples.push(
            ...hourOf({
              project,
              start: monday + week * WEEK + day * DAY + 9 * HOUR,
              mean: 100 + 100 * day,
              spread: 5,
            }),
          );
        }
      }

      await write(samples);

      const baseline: BaselineSummary = (await read(project, {
        at: new Date(monday + 2 * WEEK + weekday * DAY + 9 * HOUR + 40 * MINUTE),
      }))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.mean).toBeCloseTo(100 + 100 * weekday, 6);
      expect(baseline.isReliable).toBe(true);
    });

    test("a chart's band reads the same weekday as a check", async () => {
      const project: ObjectID = newProject();
      const monday: number = weekTurn - 3 * WEEK;
      const judged: number = monday + 2 * WEEK + 9 * HOUR;

      await write([
        ...hourOf({ project, start: monday + 9 * HOUR, mean: 100, spread: 5 }),
        ...hourOf({
          project,
          start: monday + DAY + 9 * HOUR,
          mean: 900,
          spread: 5,
        }),
        ...hourOf({
          project,
          start: monday + WEEK + 9 * HOUR,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({
          project,
          start: monday + WEEK + DAY + 9 * HOUR,
          mean: 900,
          spread: 5,
        }),
      ]);

      const points: Array<BandPoint> = await MetricBaselineService.getBandSeries(
        {
          projectId: project,
          metricName: METRIC,
          startTime: new Date(judged),
          endTime: new Date(judged),
          intervalMinutes: 5,
          sigmaCount: 3,
        },
      );

      expect(points[0]!.mean).toBeCloseTo(100, 6);
    });
  });

  describe("what is judged is not what it is judged against", () => {
    test("the hour judged is not in its own baseline, however far it has moved", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 100, spread: 5 }),
        ...hourOf({
          project,
          start: hourStart,
          mean: 1000000,
          spread: 5,
          minutes: 40,
        }),
      ]);

      const baseline: BaselineSummary = (await read(project))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.mean).toBeCloseTo(100, 6);
      expect(baseline.stddev).toBeCloseTo(5, 6);
      expect(baseline.minObserved).toBe(95);
      expect(baseline.maxObserved).toBe(105);
      expect(baseline.isReliable).toBe(true);
    });

    test("nor is any later hour, when an older moment is judged", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({
          project,
          start: hourStart - 3 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 700, spread: 5 }),
        ...hourOf({ project, start: hourStart, mean: 900, spread: 5 }),
      ]);

      const baseline: BaselineSummary = (await read(project, {
        at: new Date(judgedAt.getTime() - WEEK),
      }))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.mean).toBeCloseTo(100, 6);
    });

    test("an hour that ended at midnight is held to the days before its own", async () => {
      const project: ObjectID = newProject();
      const lastHour: number = dayStart + 23 * HOUR;

      await write([
        ...hourOf({
          project,
          start: lastHour - 2 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({ project, start: lastHour - WEEK, mean: 100, spread: 5 }),
        ...hourOf({ project, start: lastHour, mean: 1000000, spread: 5 }),
      ]);

      const baseline: BaselineSummary = (await read(project, {
        at: new Date(lastHour + 58 * MINUTE),
      }))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.mean).toBeCloseTo(100, 6);
    });

    test("it reaches back as far as the window, and no further", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({
          project,
          start: hourStart - 3 * WEEK,
          mean: 900,
          spread: 5,
        }),
        ...hourOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 100, spread: 5 }),
      ]);

      expect((await read(project))!.sampleCount).toBe(120);
      expect((await read(project, { windowDays: 28 }))!.sampleCount).toBe(180);
    });
  });

  describe("the rows of the other days", () => {
    /*
     * What the rows are worth is that the merged cell and the rows agree: a
     * level the weeks agree on, on days that move, reads as the days say.
     */
    test("the hour on each day is the same hour of the day", async () => {
      const project: ObjectID = newProject();
      const samples: Array<Sample> = [];
      const moves: Array<number> = [
        8, -6, 3, 9, -7, 4, -2, -9, 5, 7, -3, 2, -5, 8,
      ];

      moves.forEach((move: number, index: number): void => {
        samples.push(
          ...hourOf({
            project,
            start: hourStart - (14 - index) * DAY,
            mean: 100 + (index % 7 === 0 ? 0 : move),
            spread: 1,
          }),
        );
      });

      await write(samples);

      const baseline: BaselineSummary = (await read(project))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.mean).toBeCloseTo(100, 6);
      // The two weeks agree, so they measure 1: the days add the rest.
      expect(baseline.stddev).toBeGreaterThan(2);
    });

    test("a read across the end of the week finds Sunday's and Monday's hours", async () => {
      const project: ObjectID = newProject();
      const firstHour: number = weekTurn;
      const samples: Array<Sample> = [];

      for (let day: number = 1; day <= 14; day++) {
        samples.push(
          ...hourOf({
            project,
            start: firstHour - day * DAY,
            mean: 100 + (day === 7 || day === 14 ? 0 : day % 2 === 0 ? 8 : -8),
            spread: 1,
          }),
        );
      }

      await write(samples);

      const baseline: BaselineSummary = (await read(project, {
        at: new Date(firstHour + 20 * MINUTE),
      }))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.isReliable).toBe(true);
      expect(baseline.stddev).toBeGreaterThan(2);
    });
  });

  describe("a baseline is held to what asks for it", () => {
    test("another metric of the project, and another project, are not in it", async () => {
      const project: ObjectID = newProject();
      const other: ObjectID = newProject();

      await write([
        ...hourOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 100, spread: 5 }),
        ...hourOf({
          project,
          start: hourStart - WEEK,
          mean: 9000,
          metric: "something.else",
        }),
        ...hourOf({ project: other, start: hourStart - WEEK, mean: 9000 }),
      ]);

      expect((await read(project))!.mean).toBeCloseTo(100, 6);
    });

    test("a service named is the only one read, in the rows as in the cell", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 100, spread: 5 }),
        ...hourOf({
          project,
          start: hourStart - WEEK,
          mean: 9000,
          serviceId: otherServiceId,
        }),
      ]);

      const baseline: BaselineSummary = (await read(project, {
        primaryEntityId: checkoutId,
      }))!;

      expect(baseline.mean).toBeCloseTo(100, 6);
      expect(baseline.stddev).toBeCloseTo(5, 6);
    });
  });

  describe("a monitor's services", () => {
    test("the ones it names are read, and only those", async () => {
      const project: ObjectID = newProject();
      const thirdId: ObjectID = new ObjectID("7b00000000000000000000b3");

      for (const [serviceId, mean] of [
        [checkoutId, 100],
        [otherServiceId, 200],
        [thirdId, 9000],
      ] as Array<[ObjectID, number]>) {
        await write([
          ...hourOf({
            project,
            start: hourStart - 2 * WEEK,
            mean,
            spread: 5,
            serviceId,
          }),
          ...hourOf({
            project,
            start: hourStart - WEEK,
            mean,
            spread: 5,
            serviceId,
          }),
        ]);
      }

      const baseline: BaselineSummary = (await read(project, {
        primaryEntityId: [checkoutId, otherServiceId],
      }))!;

      expect(baseline.sampleCount).toBe(240);
      expect(baseline.mean).toBeCloseTo(150, 6);
      expect(baseline.maxObserved).toBe(205);
      expect(baseline.isReliable).toBe(true);
    });
  });

  /*
   * What a query's data points are on the days before it, read the way the
   * query reads them. Three series, two samples a minute each, at 100.
   */
  describe("a query's own data points", () => {
    function fleetOf(data: {
      project: ObjectID;
      start: number;
      minutes?: number;
      mean: number;
      seriesCount?: number;
      samplesPerMinute?: number;
      count?: number;
    }): Array<Sample> {
      const samples: Array<Sample> = [];

      for (let minute: number = 0; minute < (data.minutes ?? 60); minute++) {
        for (let series: number = 0; series < (data.seriesCount ?? 3); series++) {
          for (
            let sample: number = 0;
            sample < (data.samplesPerMinute ?? 2);
            sample++
          ) {
            samples.push({
              project: data.project,
              time: data.start + minute * MINUTE + sample * 1000,
              value: data.mean + (minute % 2 === 0 ? 5 : -5),
              ...(data.count !== undefined ? { count: data.count } : {}),
            });
          }
        }
      }

      return samples;
    }

    const earlierWeeks: (project: ObjectID, mean: number) => Array<Sample> = (
      project: ObjectID,
      mean: number,
    ): Array<Sample> => {
      return [
        ...fleetOf({ project, start: hourStart - 2 * WEEK, mean }),
        ...fleetOf({ project, start: hourStart - WEEK, mean }),
      ];
    };

    test("a Sum is read at the Sum's scale, not its samples'", async () => {
      const project: ObjectID = newProject();

      await write([
        ...earlierWeeks(project, 100),
        ...fleetOf({ project, start: hourStart, mean: 500, minutes: 40 }),
      ]);

      expect(
        (await read(project))?.mean,
      ).toBeCloseTo(100, 6);

      const baseline: BaselineSummary = (await read(project, {
        query: { aggregationType: AggregationType.Sum },
      }))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.mean).toBeCloseTo(600, 6);
      // A minute's six samples all sit 5 from their mean, the same way.
      expect(baseline.stddev).toBeCloseTo(30, 6);
      expect(baseline.isReliable).toBe(true);
    });

    test("a Count is how many samples a minute holds", async () => {
      const project: ObjectID = newProject();

      await write([
        ...earlierWeeks(project, 100),
        ...fleetOf({ project, start: hourStart, mean: 100, minutes: 40 }),
      ]);

      const baseline: BaselineSummary = (await read(project, {
        query: { aggregationType: AggregationType.Count },
      }))!;

      expect(baseline.mean).toBe(6);
      expect(baseline.stddev).toBe(0);
      expect(baseline.minObserved).toBe(6);
      expect(baseline.maxObserved).toBe(6);
    });

    test("a longer data point is read at its own length", async () => {
      const project: ObjectID = newProject();

      await write(earlierWeeks(project, 100));

      const baseline: BaselineSummary = (await read(project, {
        query: {
          aggregationType: AggregationType.Sum,
          interval: AggregationInterval.FiveMinutes,
        },
      }))!;

      expect(baseline.sampleCount).toBe(24);
      expect(baseline.mean).toBeCloseTo(3000, 6);
    });

    test("the services named are the only ones read", async () => {
      const project: ObjectID = newProject();

      await write([
        ...earlierWeeks(project, 100),
        ...fleetOf({
          project,
          start: hourStart - WEEK,
          mean: 100,
          seriesCount: 1,
        }).map((sample: Sample): Sample => {
          return { ...sample, serviceId: otherServiceId };
        }),
      ]);

      const baseline: BaselineSummary = (await read(project, {
        primaryEntityId: [otherServiceId],
        query: { aggregationType: AggregationType.Count },
      }))!;

      expect(baseline.sampleCount).toBe(60);
      expect(baseline.mean).toBe(2);
    });

    test("an average of a histogram is of its observations, not its datapoints' sums", async () => {
      const project: ObjectID = newProject();

      await write([
        ...fleetOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 75,
          count: 300,
        }),
        ...fleetOf({ project, start: hourStart - WEEK, mean: 75, count: 300 }),
        ...fleetOf({ project, start: hourStart, mean: 75, minutes: 40, count: 300 }),
      ]);

      // What every histogram used to be judged against.
      expect((await read(project))?.mean).toBeCloseTo(75, 6);

      const baseline: BaselineSummary = (await read(project, { query: {} }))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.mean).toBeCloseTo(0.25, 6);
      expect(baseline.isReliable).toBe(true);
    });

    test("a Count of a histogram is how many observations a minute holds", async () => {
      const project: ObjectID = newProject();

      await write([
        ...fleetOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 75,
          count: 300,
        }),
        ...fleetOf({ project, start: hourStart - WEEK, mean: 75, count: 300 }),
        ...fleetOf({ project, start: hourStart, mean: 75, minutes: 40, count: 300 }),
      ]);

      const baseline: BaselineSummary = (await read(project, {
        query: { aggregationType: AggregationType.Count },
      }))!;

      expect(baseline.mean).toBe(1800);
    });

    test.each([
      ["a percentile of a histogram", { aggregationType: AggregationType.P95 }],
      ["a histogram narrowed by an attribute", { isNarrowedByAttributes: true }],
    ])("%s has none", async (_: string, query: Partial<MetricBaselineQuery>) => {
      const project: ObjectID = newProject();

      await write([
        ...fleetOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 75,
          count: 300,
        }),
        ...fleetOf({ project, start: hourStart - WEEK, mean: 75, count: 300 }),
        ...fleetOf({ project, start: hourStart, mean: 75, minutes: 40, count: 300 }),
      ]);

      expect(await read(project, { query })).toBeNull();
    });

    test("a Sum narrowed by an attribute has none", async () => {
      const project: ObjectID = newProject();

      await write(earlierWeeks(project, 100));

      expect(
        await read(project, {
          query: {
            aggregationType: AggregationType.Sum,
            isNarrowedByAttributes: true,
          },
        }),
      ).toBeNull();
    });

    test("an hour on one day is not another hour's, across the end of the week", async () => {
      const project: ObjectID = newProject();
      const sundayNight: number = weekTurn - DAY + 23 * HOUR;

      await write([
        ...fleetOf({ project, start: sundayNight - 2 * WEEK, mean: 100 }),
        ...fleetOf({ project, start: sundayNight - WEEK, mean: 100 }),
        ...fleetOf({ project, start: sundayNight - WEEK + HOUR, mean: 900 }),
      ]);

      const baseline: BaselineSummary = (await read(project, {
        at: new Date(sundayNight + 10 * MINUTE),
        query: { aggregationType: AggregationType.Sum },
      }))!;

      expect(baseline.hourOfWeek).toBe(167);
      expect(baseline.mean).toBeCloseTo(600, 6);
      expect(baseline.isReliable).toBe(true);
    });
  });

  describe("how long a metric learns", () => {
    test("one earlier week is still learning", async () => {
      const project: ObjectID = newProject();

      await write(
        hourOf({ project, start: hourStart - WEEK, mean: 100, spread: 5 }),
      );

      expect((await read(project))!.isReliable).toBe(false);
    });

    test("a metric with only its own samples has no baseline", async () => {
      const project: ObjectID = newProject();

      await write(hourOf({ project, start: hourStart, mean: 100, spread: 5 }));

      expect(await read(project)).toBeNull();
    });

    test("the hour's own samples count towards the ones it needs", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 100,
          spread: 5,
          minutes: 2,
        }),
        ...hourOf({
          project,
          start: hourStart - WEEK,
          mean: 100,
          spread: 5,
          minutes: 2,
        }),
      ]);

      expect((await read(project))!.isReliable).toBe(false);

      await write(hourOf({ project, start: hourStart, mean: 100, minutes: 1 }));

      expect(await read(project)).toMatchObject({
        sampleCount: 4,
        isReliable: true,
      });
    });
  });

  describe("a metric that held one value", () => {
    test("has no spread, and has not moved while it stays there", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({ project, start: hourStart - 2 * WEEK, mean: 0.1 }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 0.1 }),
        ...hourOf({ project, start: hourStart, mean: 0.1, minutes: 40 }),
      ]);

      const baseline: BaselineSummary = (await read(project))!;

      expect(baseline.stddev).toBe(0);
      expect(baseline.leftFlatHistory).toBeUndefined();
      expect(
        MetricBaselineServiceClass.getBand({ baseline, sigmaCount: 3 }),
      ).toBeNull();
    });

    test("says so once one of its samples has left it", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({ project, start: hourStart - 2 * WEEK, mean: 0 }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 0 }),
        ...hourOf({ project, start: hourStart, mean: 0, minutes: 39 }),
        { project, time: hourStart + 39 * MINUTE, value: 5 },
      ]);

      const baseline: BaselineSummary = (await read(project))!;

      expect(baseline.stddev).toBe(0);
      expect(baseline.leftFlatHistory).toBe(true);

      const band: BaselineBand = MetricBaselineServiceClass.getBand({
        baseline,
        sigmaCount: 3,
      })!;

      expect(5).toBeGreaterThan(band.expectedHigh);
      expect(0).toBeLessThanOrEqual(band.expectedHigh);
    });
  });

  test("a chart's band is the band a monitor judges by", async () => {
    const project: ObjectID = newProject();

    await write([
      ...hourOf({ project, start: hourStart - 2 * WEEK, mean: 90, spread: 5 }),
      ...hourOf({ project, start: hourStart - WEEK, mean: 110, spread: 5 }),
      ...hourOf({
        project,
        start: hourStart,
        mean: 500,
        spread: 5,
        minutes: 40,
      }),
    ]);

    const baseline: BaselineSummary = (await read(project))!;
    const points: Array<BandPoint> = await MetricBaselineService.getBandSeries({
      projectId: project,
      metricName: METRIC,
      startTime: judgedAt,
      endTime: judgedAt,
      intervalMinutes: 15,
      sigmaCount: 3,
    });

    expect(points).toHaveLength(1);
    expect(points[0]!.mean).toBeCloseTo(baseline.mean, 6);
    expect(points[0]!.expectedHigh).toBeCloseTo(
      baseline.mean + 3 * baseline.stddev,
      6,
    );
    expect(points[0]!.expectedLow).toBeCloseTo(
      baseline.mean - 3 * baseline.stddev,
      6,
    );
  });

  /*
   * Written by the plain session: session_timezone moves how an insert's text
   * is read, and not the view behind it, so a session cannot write as a server
   * in another zone does. This whole suite also passes on one: start the
   * server with -e TZ=Asia/Tokyo.
   */
  test("in a server of another zone the days and hours are the same", async () => {
    const project: ObjectID = newProject();

    await write([
      ...hourOf({
        project,
        start: hourStart - 2 * WEEK,
        mean: 100,
        spread: 5,
      }),
      ...hourOf({ project, start: hourStart - WEEK, mean: 100, spread: 5 }),
      ...hourOf({
        project,
        start: hourStart,
        mean: 1000000,
        spread: 5,
        minutes: 40,
      }),
    ]);

    MetricBaselineService.databaseClient = zonedClient;

    try {
      const baseline: BaselineSummary = (await read(project))!;

      expect(baseline.sampleCount).toBe(120);
      expect(baseline.mean).toBeCloseTo(100, 6);
    } finally {
      MetricBaselineService.databaseClient = client;
    }
  });

  describe("a Metrics monitor's criteria, end to end", () => {
    const metricViewConfig: MetricsViewConfig = {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "a",
            title: METRIC,
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: { metricName: METRIC },
          } as unknown as MetricQueryData,
        } as MetricQueryConfigData,
      ],
      formulaConfigs: [],
    };

    function judge(project: ObjectID, value: number): Promise<string | null> {
      const monitorStep: MonitorStep = new MonitorStep();

      monitorStep.data = {
        id: ObjectID.generate().toString(),
        monitorCriteria: { data: undefined } as never,
      } as unknown as MonitorStep["data"];
      monitorStep.data!.metricMonitor = {
        metricViewConfig,
        rollingTime: RollingTime.Past5Minutes,
      };

      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
        metricMonitorOptions: { metricAlias: "a" },
      } as CriteriaFilter;

      const response: MetricMonitorResponse = {
        projectId: project,
        metricResult: [{ data: [{ timestamp: judgedAt, value }] }],
        metricViewConfig,
        monitorId: ObjectID.generate(),
      } as unknown as MetricMonitorResponse;

      return MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response,
        criteriaFilter,
        monitorStep,
      });
    }

    /*
     * The finding, on the real rollup. 40 minutes into a doubling, on two
     * earlier weeks at 100, the hour's own samples used to be a quarter of
     * the cell, which cannot read past 1.7 standard deviations.
     */
    test("a doubling 40 minutes in fires, its own samples in the rollup and all", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 100, spread: 5 }),
        ...hourOf({
          project,
          start: hourStart,
          mean: 200,
          spread: 5,
          minutes: 40,
        }),
      ]);

      expect(await judge(project, 200)).toContain(
        "above the same-hour baseline",
      );
    });

    test("a value in the range it has held does not", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({
          project,
          start: hourStart - 2 * WEEK,
          mean: 100,
          spread: 5,
        }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 100, spread: 5 }),
        ...hourOf({
          project,
          start: hourStart,
          mean: 100,
          spread: 5,
          minutes: 40,
        }),
      ]);

      expect(await judge(project, 104)).toBeNull();
    });

    test("a gauge that held 0 and rose fires", async () => {
      const project: ObjectID = newProject();

      await write([
        ...hourOf({ project, start: hourStart - 2 * WEEK, mean: 0 }),
        ...hourOf({ project, start: hourStart - WEEK, mean: 0 }),
        ...hourOf({ project, start: hourStart, mean: 5, minutes: 40 }),
      ]);

      expect(await judge(project, 5)).toContain(
        "which held at 0 for all 120 samples",
      );
    });

    function judgeTotal(project: ObjectID, value: number): Promise<string | null> {
      const totals: MetricsViewConfig = {
        queryConfigs: [
          {
            ...metricViewConfig.queryConfigs[0]!,
            metricQueryData: {
              filterData: {
                metricName: METRIC,
                aggegationType: AggregationType.Sum,
              },
            } as unknown as MetricQueryData,
          },
        ],
        formulaConfigs: [],
      };
      const monitorStep: MonitorStep = new MonitorStep();

      monitorStep.data = {
        id: ObjectID.generate().toString(),
        monitorCriteria: { data: undefined } as never,
      } as unknown as MonitorStep["data"];
      monitorStep.data!.metricMonitor = {
        metricViewConfig: totals,
        rollingTime: RollingTime.Past5Minutes,
      };

      return MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: {
          projectId: project,
          metricResult: [{ data: [{ timestamp: judgedAt, value }] }],
          metricViewConfig: totals,
          monitorId: ObjectID.generate(),
        } as unknown as MetricMonitorResponse,
        criteriaFilter: {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.Anomalous,
          value: undefined,
          metricMonitorOptions: { metricAlias: "a" },
        } as CriteriaFilter,
        monitorStep,
      });
    }

    test("a Sum of its usual size does not fire, where it used to on every check", async () => {
      const project: ObjectID = newProject();
      const samples: Array<Sample> = [];

      for (const start of [hourStart - 2 * WEEK, hourStart - WEEK, hourStart]) {
        for (const serviceId of [checkoutId, otherServiceId]) {
          samples.push(
            ...hourOf({ project, start, mean: 100, spread: 5, serviceId }),
          );
        }
      }

      await write(samples);

      expect(await judgeTotal(project, 200)).toBeNull();
      expect(await judgeTotal(project, 500)).toContain(
        "above the same-hour baseline",
      );
    });
  });
});

describe("Metric baseline ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
