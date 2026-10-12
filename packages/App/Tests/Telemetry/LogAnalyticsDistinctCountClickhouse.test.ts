import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ------------------------------------------------------------------
 * The log explorer's distinct count against a real ClickHouse server.
 *
 * The log analytics (time series, top list, table) count rows, or the
 * distinct values of one field. For an attribute the key is now bound as a
 * query parameter - uniqExact(attributes[{p1:String}]) - where it used to
 * be quoted into the SQL by hand. The unit suite
 * (Common/Tests/Server/Services/LogAnalyticsDistinctCount) pins the
 * statements; this one shows what ClickHouse makes of them: each chart
 * counts the distinct values of an attribute - its key holding the dots,
 * colons, slashes and dashes keys hold - per group, of one project only,
 * the same as it counts a column's, and a key the service refuses never
 * reaches the server.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/LogAnalyticsDistinctCountClickhouse.test.ts
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

import LogService from "Common/Server/Services/LogService";
import LogAggregationService, {
  AnalyticsRequest,
  AnalyticsTableRow,
  AnalyticsTimeseriesRow,
  AnalyticsTopItem,
} from "Common/Server/Services/LogAggregationService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `log_distinct_count_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const WINDOW_START: Date = new Date(
  Math.floor(Date.now() / MINUTE) * MINUTE - 30 * MINUTE,
);
const WINDOW_END: Date = new Date(WINDOW_START.getTime() + 20 * MINUTE);

const projectId: ObjectID = new ObjectID(
  "99000000-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "99000000-0000-4000-8000-00000000000b",
);
const serviceId: ObjectID = new ObjectID(
  "99000000-0000-4000-8000-00000000000c",
);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

// A key with every kind of punctuation the facet key pattern lets through.
const PUNCTUATED_KEY: string = "k8s.pod:name/zone-a_b";

interface LogFixture {
  minutesIn: number;
  route: string;
  user: string;
  traceId: string;
  pod: string;
  project?: ObjectID;
}

const LOGS: Array<LogFixture> = [
  // /checkout: three logs, two users, two traces, two pods.
  { minutesIn: 1, route: "/checkout", user: "u1", traceId: "t1", pod: "p1" },
  { minutesIn: 2, route: "/checkout", user: "u2", traceId: "t1", pod: "p1" },
  { minutesIn: 3, route: "/checkout", user: "u2", traceId: "t2", pod: "p2" },
  // /cart: two logs, one user, two traces, one pod.
  { minutesIn: 4, route: "/cart", user: "u3", traceId: "t3", pod: "p3" },
  { minutesIn: 5, route: "/cart", user: "u3", traceId: "t4", pod: "p3" },
  // Another project's logs: never counted.
  {
    minutesIn: 6,
    route: "/checkout",
    user: "u9",
    traceId: "t9",
    pod: "p9",
    project: otherProjectId,
  },
  // Outside the window: never counted.
  { minutesIn: -10, route: "/checkout", user: "u8", traceId: "t8", pod: "p8" },
];

function logRow(fixture: LogFixture, index: number): JSONObject {
  const time: Date = new Date(
    WINDOW_START.getTime() + fixture.minutesIn * MINUTE,
  );
  const attributes: Record<string, string> = {
    "http.route": fixture.route,
    "user.id": fixture.user,
    [PUNCTUATED_KEY]: fixture.pod,
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.project || projectId).toString(),
    primaryEntityId: serviceId.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + index),
    severityText: LogSeverity.Information,
    severityNumber: 9,
    attributes: attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    traceId: fixture.traceId,
    spanId: "",
    body: `${fixture.route} served`,
    retentionDate: retentionDate,
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
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

function analytics(overrides: Partial<AnalyticsRequest>): AnalyticsRequest {
  return {
    projectId: projectId,
    startTime: WINDOW_START,
    endTime: WINDOW_END,
    bucketSizeInMinutes: 60,
    chartType: "timeseries",
    aggregation: "unique",
    ...overrides,
  };
}

// Table rows as [the group's route, its count], in a fixed order.
function byRoute(rows: Array<AnalyticsTableRow>): Array<[string, number]> {
  return rows
    .map((row: AnalyticsTableRow): [string, number] => {
      return [row.groupValues["http.route"] || "", row.count];
    })
    .sort((a: [string, number], b: [string, number]): number => {
      return a[0].localeCompare(b[0]);
    });
}

integration("Log analytics distinct counts against ClickHouse", () => {
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

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse, Log);

    original = {
      database: LogService.database,
      databaseClient: LogService.databaseClient,
      ingestDatabase: LogService.ingestDatabase,
      ingestDatabaseClient: LogService.ingestDatabaseClient,
    };

    LogService.database = clickhouse;
    LogService.databaseClient = client;
    LogService.ingestDatabase = clickhouse;
    LogService.ingestDatabaseClient = client;

    await LogService.insertJsonRows(LOGS.map(logRow), {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(LogService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the top list counts each route's distinct users", async () => {
    const items: Array<AnalyticsTopItem> =
      await LogAggregationService.getAnalyticsTopList(
        analytics({
          chartType: "toplist",
          groupBy: ["http.route"],
          aggregationField: "user.id",
        }),
      );

    expect(items).toEqual([
      { value: "/checkout", count: 2 },
      { value: "/cart", count: 1 },
    ]);
  });

  test("the table counts each route's distinct users, as it counts its distinct traces", async () => {
    expect(
      byRoute(
        await LogAggregationService.getAnalyticsTable(
          analytics({
            chartType: "table",
            groupBy: ["http.route"],
            aggregationField: "user.id",
          }),
        ),
      ),
    ).toEqual([
      ["/cart", 1],
      ["/checkout", 2],
    ]);

    expect(
      byRoute(
        await LogAggregationService.getAnalyticsTable(
          analytics({
            chartType: "table",
            groupBy: ["http.route"],
            aggregationField: "traceId",
          }),
        ),
      ),
    ).toEqual([
      ["/cart", 2],
      ["/checkout", 2],
    ]);
  });

  test("the time series counts the window's distinct values of a punctuated key", async () => {
    const rows: Array<AnalyticsTimeseriesRow> =
      await LogAggregationService.getAnalyticsTimeseries(
        analytics({ aggregationField: PUNCTUATED_KEY }),
      );

    expect(
      rows.reduce((total: number, row: AnalyticsTimeseriesRow): number => {
        return total + row.count;
      }, 0),
    ).toBe(3);
  });

  test("counting rows still counts every log of the project in the window", async () => {
    const items: Array<AnalyticsTopItem> =
      await LogAggregationService.getAnalyticsTopList(
        analytics({
          chartType: "toplist",
          aggregation: "count",
          groupBy: ["http.route"],
        }),
      );

    expect(items).toEqual([
      { value: "/checkout", count: 3 },
      { value: "/cart", count: 2 },
    ]);
  });

  test("a key the service refuses never reaches the server", async () => {
    const executeQuery: SpyInstance<typeof LogService.executeQuery> =
      jest.spyOn(LogService, "executeQuery");

    try {
      await expect(
        LogAggregationService.getAnalyticsTopList(
          analytics({
            chartType: "toplist",
            groupBy: ["http.route"],
            aggregationField: "user'])) AS cnt FROM system.one --",
          }),
        ),
      ).rejects.toThrow(BadDataException);

      expect(executeQuery).not.toHaveBeenCalled();
    } finally {
      executeQuery.mockRestore();
    }
  });
});

describe("Log analytics distinct count ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
