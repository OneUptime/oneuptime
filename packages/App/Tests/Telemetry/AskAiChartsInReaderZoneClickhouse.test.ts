import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import Timezone from "Common/Types/Timezone";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import MetricService from "Common/Server/Services/MetricService";
import { QueryMetricsTool } from "Common/Server/Utils/AI/Toolbox/MetricTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "Common/Server/Utils/AI/Toolbox/ToolTypes";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  AIChatWidgetPoint,
  AIChatWidgetSeries,
} from "Common/Types/AI/AIChatTypes";
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
 * Ask AI's charts over more than a week, against a real ClickHouse server
 * (issue #7922).
 *
 * A chart Ask AI draws over more than a week is read on the server, through
 * query_metrics, and the chat draws it on the asker's calendar. The tool now
 * asks for its day buckets in the asker's zone (ToolContext.readerTimezone),
 * as the dashboard asks for every chart's since issue #7277. What only a
 * server can show is that the widget's daily points then start at the
 * asker's midnight - 25 hours apart over New York's 1 November - and hold
 * that day's samples; and that a run with no reader (Slack, Microsoft
 * Teams, an autonomous investigation) gets UTC's days, as before.
 *
 * The day each sample belongs to is worked out here on the platform's own
 * clock (Intl), not by the code under test.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/AskAiChartsInReaderZoneClickhouse.test.ts
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

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `ask_ai_reader_zone_test_${process.pid}_${Date.now()}`;

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

const PROJECT: ObjectID = new ObjectID("7922000000000000000000a1");
const SERVICE_ID: ObjectID = new ObjectID("7922000000000000000000b1");
const METRIC: string = "checkout.orders";
const CONTAINER_ATTRIBUTE: string = "resource.container.name";

// 10:00 on 15 November in New York: the month before holds its 1 November.
const NOW: Date = new Date("2026-11-15T15:00:00.000Z");
const WINDOW_START: Date = new Date(NOW.getTime() - 30 * DAY);

const retention: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

// The date an instant falls on in `timezone`, as the platform's clock has it.
function platformDay(ms: number, timezone: string): string {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).formatToParts(new Date(ms));
  const part: (type: string) => string = (type: string): string => {
    return parts.find((item: Intl.DateTimeFormatPart): boolean => {
      return item.type === type;
    })!.value;
  };

  return `${part("year")}-${part("month")}-${part("day")}`;
}

interface Sample {
  time: number;
  value: number;
}

/*
 * A sample every hour of the five weeks before NOW, each worth its hour of
 * the epoch modulo 7, plus one: a day's sum is that day's own, and a bucket
 * holding parts of two days sums to neither's.
 */
const SAMPLES: Array<Sample> = [];

for (
  let time: number = NOW.getTime() - 35 * DAY;
  time <= NOW.getTime();
  time += HOUR
) {
  SAMPLES.push({ time, value: (Math.floor(time / HOUR) % 7) + 1 });
}

// Each of the reader's days' sum over the window, as the platform has it.
function expectedDailySums(timezone: string): Map<string, number> {
  const sums: Map<string, number> = new Map();

  for (const sample of SAMPLES) {
    if (sample.time >= WINDOW_START.getTime() && sample.time <= NOW.getTime()) {
      const day: string = platformDay(sample.time, timezone);
      sums.set(day, (sums.get(day) || 0) + sample.value);
    }
  }

  return sums;
}

function metricRowOf(sample: Sample): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    primaryEntityType: "Service",
    name: METRIC,
    aggregationTemporality: "Delta",
    metricPointType: "Gauge",
    time: OneUptimeDate.toClickhouseDateTime64(new Date(sample.time)),
    timeUnixNano: String(sample.time * 1000000),
    attributes: { [CONTAINER_ATTRIBUTE]: "api" },
    attributeKeys: [CONTAINER_ATTRIBUTE],
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

  // A rollup's own view, read from the table it is written for.
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

function connectionOf(service: ServiceConnection): ServiceConnection {
  return {
    database: service.database,
    databaseClient: service.databaseClient,
    ingestDatabase: service.ingestDatabase,
    ingestDatabaseClient: service.ingestDatabaseClient,
  };
}

function contextOf(timezone?: Timezone | undefined): ToolContext {
  return {
    projectId: PROJECT,
    props: { isRoot: true, tenantId: PROJECT },
    ...(timezone ? { readerTimezone: timezone } : {}),
  };
}

async function askForTheMonth(data: {
  timezone?: Timezone | undefined;
  groupBy?: Array<string> | undefined;
}): Promise<Array<AIChatWidgetPoint>> {
  const result: ToolExecutionResult = await QueryMetricsTool.execute(
    {
      metricName: METRIC,
      aggregationType: "Sum",
      startTime: WINDOW_START.toISOString(),
      endTime: NOW.toISOString(),
      ...(data.groupBy ? { groupBy: data.groupBy } : {}),
    },
    contextOf(data.timezone),
  );
  const series: Array<AIChatWidgetSeries> = (result.widget?.data["series"] ||
    []) as Array<AIChatWidgetSeries>;

  expect(series).toHaveLength(1);
  return series[0]!.points;
}

// The points as { reader's day: the sum the chart draws there }.
function dailySumsOf(
  points: Array<AIChatWidgetPoint>,
  timezone: string,
): Map<string, number> {
  const sums: Map<string, number> = new Map();

  for (const point of points) {
    sums.set(platformDay(Date.parse(point.x), timezone), Number(point.y));
  }

  return sums;
}

integration(
  "Ask AI's day charts in the asker's zone, against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let originalMetric: ServiceConnection | undefined;

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

      await createTable(client, clickhouse, Metric);
      await createTable(client, clickhouse, MetricItemAggMV1m);

      originalMetric = connectionOf(MetricService);
      Object.assign(MetricService, {
        database: clickhouse,
        databaseClient: client,
        ingestDatabase: clickhouse,
        ingestDatabaseClient: client,
      });

      await client.insert({
        table: `${database}.${new Metric().tableName}`,
        format: "JSONEachRow",
        values: SAMPLES.map(metricRowOf),
      });
    });

    afterAll(async (): Promise<void> => {
      if (originalMetric) {
        Object.assign(MetricService, originalMetric);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test.each([
      Timezone.AmericaNew_York,
      Timezone.EuropeLondon,
      Timezone.AsiaKolkata,
      Timezone.AsiaKathmandu,
      Timezone.AsiaTokyo,
    ])(
      "asked in %s, each daily point starts at the asker's midnight and holds that day",
      async (timezone: Timezone) => {
        const points: Array<AIChatWidgetPoint> = await askForTheMonth({
          timezone,
        });

        for (const point of points) {
          const startMs: number = Date.parse(point.x);

          // A midnight there: a millisecond before is the day before.
          expect(platformDay(startMs - 1, timezone)).not.toBe(
            platformDay(startMs, timezone),
          );
        }

        expect(Object.fromEntries(dailySumsOf(points, timezone))).toEqual(
          Object.fromEntries(expectedDailySums(timezone)),
        );
      },
    );

    test("New York's 1 November is one point of 25 hours: its next point starts 25 hours on", async () => {
      const points: Array<AIChatWidgetPoint> = await askForTheMonth({
        timezone: Timezone.AmericaNew_York,
      });
      // In time order: the read hands them newest first, the chart by time.
      const starts: Array<string> = points
        .map((point: AIChatWidgetPoint): string => {
          return new Date(point.x).toISOString();
        })
        .sort();
      const firstOfNovember: number = starts.indexOf(
        "2026-11-01T04:00:00.000Z",
      );

      expect(firstOfNovember).toBeGreaterThan(0);
      expect(starts[firstOfNovember + 1]).toBe("2026-11-02T05:00:00.000Z");
      expect(starts[firstOfNovember - 1]).toBe("2026-10-31T04:00:00.000Z");
    });

    test("read one series per attribute value, the points are New York's days too", async () => {
      const points: Array<AIChatWidgetPoint> = await askForTheMonth({
        timezone: Timezone.AmericaNew_York,
        groupBy: [CONTAINER_ATTRIBUTE],
      });

      expect(
        Object.fromEntries(dailySumsOf(points, Timezone.AmericaNew_York)),
      ).toEqual(
        Object.fromEntries(expectedDailySums(Timezone.AmericaNew_York)),
      );
    });

    test("with no reader - a Slack run - the points are UTC's days, as before", async () => {
      const points: Array<AIChatWidgetPoint> = await askForTheMonth({});

      for (const point of points) {
        expect(new Date(point.x).toISOString()).toMatch(/T00:00:00\.000Z$/);
      }

      expect(Object.fromEntries(dailySumsOf(points, Timezone.UTC))).toEqual(
        Object.fromEntries(expectedDailySums(Timezone.UTC)),
      );
    });

    test("UTC's days read in New York put each total under the wrong day", async () => {
      // What the chat drew before the asker's zone was carried to the tools.
      const points: Array<AIChatWidgetPoint> = await askForTheMonth({});
      const drawn: Map<string, number> = dailySumsOf(
        points,
        Timezone.AmericaNew_York,
      );
      const expected: Map<string, number> = expectedDailySums(
        Timezone.AmericaNew_York,
      );
      let wrong: number = 0;

      for (const [day, total] of drawn) {
        if (expected.get(day) !== total) {
          wrong++;
        }
      }

      expect(wrong).toBeGreaterThanOrEqual(29);
    });
  },
);

describe("The Ask AI reader's-zone ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
