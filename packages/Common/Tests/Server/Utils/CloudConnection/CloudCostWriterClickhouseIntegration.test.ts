import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import CloudCost from "../../../../Models/AnalyticsModels/CloudCost";
import ClickhouseDatabase from "../../../../Server/Infrastructure/ClickhouseDatabase";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../../Server/EnvironmentConfig";
import CloudCostService, {
  CloudCostService as CloudCostServiceClass,
} from "../../../../Server/Services/CloudCostService";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import CloudCostWriter, {
  CloudCostWriteResult,
  CloudCostWriteTarget,
} from "../../../../Server/Utils/CloudConnection/CloudCostWriter";
import { CloudCostRecord } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import AggregateBy from "../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { CloudAccountCostSummary } from "../../../../Types/Cloud/CloudCost";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The cost writer and the Dashboard's cost reads against a real ClickHouse
 * server: the table the model creates, the writer's stored-sums query and
 * its inserts, read after read - a day that grows, a day the cloud
 * corrects, a series it stops reporting, a row that landed twice - and the
 * /aggregate statements the Costs page reads each day's spend and the
 * services that cost the most with.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -p 127.0.0.1:8193:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 * then TEST_CLICKHOUSE_URL=http://localhost:8193 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `cloud_cost_writer_${process.pid}_${Date.now()}`;
let client: ClickHouseClient;

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const CONNECTION: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000c1",
);
const ACCOUNT_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b1",
);
const OTHER_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b2",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-11-13T00:00:00.000Z"),
  end: new Date("2026-11-21T00:00:00.000Z"),
};

const TARGET: CloudCostWriteTarget = {
  projectId: PROJECT,
  connectionId: CONNECTION,
  provider: "aws",
  accountRows: new Map([
    ["123456789012", ACCOUNT_ROW],
    ["210987654321", OTHER_ROW],
  ]),
};

// What the stand-in database tells the generators: this suite's own.
const testDatabase: ClickhouseDatabase = {
  getDatasourceOptions: (): { database: string } => {
    return { database };
  },
} as unknown as ClickhouseDatabase;

function record(overrides: Partial<CloudCostRecord>): CloudCostRecord {
  return {
    accountId: "123456789012",
    day: "2026-11-19",
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "",
    amount: 10,
    currency: "USD",
    ...overrides,
  };
}

async function run(statement: Statement): Promise<Array<JSONObject>> {
  const result: { data?: Array<JSONObject> } = (await (
    await client.query({
      query: statement.query,
      query_params: statement.query_params,
      format: "JSON",
    })
  ).json()) as { data?: Array<JSONObject> };

  return result.data || [];
}

// Each day-series' stored sum, as "day|service|region" -> amount.
async function storedSums(
  cloudAccountId: ObjectID,
): Promise<Map<string, number>> {
  const rows: Array<JSONObject> = await run(
    CloudCostWriter.buildStoredSumsStatement({
      projectId: PROJECT,
      cloudAccountIds: [cloudAccountId.toString()],
      window: { start: new Date("2026-09-01T00:00:00.000Z"), end: WINDOW.end },
    }),
  );
  const sums: Map<string, number> = new Map();

  for (const row of rows) {
    sums.set(
      `${row["dayText"]}|${row["serviceName"]}|${row["regionName"]}`,
      Math.round(Number(row["total"]) * 10000) / 10000,
    );
  }

  return sums;
}

async function rowCount(): Promise<number> {
  const rows: Array<JSONObject> = (
    (await (
      await client.query({
        query: `SELECT count() AS rows FROM ${database}.CloudCostV1`,
        format: "JSON",
      })
    ).json()) as { data: Array<JSONObject> }
  ).data;

  return Number(rows[0]!["rows"]);
}

async function write(
  records: Array<CloudCostRecord>,
  accountsRead: Array<string> = ["123456789012"],
): Promise<CloudCostWriteResult> {
  return CloudCostWriter.write({
    target: TARGET,
    window: WINDOW,
    records,
    accountsRead: new Set(accountsRead),
    now: NOW,
  });
}

integration("the cost writer and the cost reads against ClickHouse", () => {
  beforeAll(async (): Promise<void> => {
    // The real ClickHouse HTTP client needs Node timers with unref().
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);

    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "This integration suite requires a local ClickHouse server.",
      );
    }

    const admin: ClickHouseClient = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      request_timeout: 120000,
    });
    await admin.command({ query: `CREATE DATABASE ${database}` });
    await admin.close();

    client = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      database,
      request_timeout: 120000,
    });

    /*
     * The table with the model's own columns, partition and sort keys, as
     * one plain MergeTree under the name the app reads and writes through
     * (a cluster puts a Distributed table of that name over Replicated
     * storage; one server needs neither).
     */
    const model: CloudCost = new CloudCost();
    const columns: Statement = new StatementGenerator<CloudCost>({
      modelType: CloudCost,
      database: testDatabase,
    }).toColumnsCreateStatement(model.tableColumns);
    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });

    // The writer's reads and inserts go to this suite's database.
    jest
      .spyOn(CloudCostService, "executeQuery")
      .mockImplementation(async (query: string | Statement): Promise<never> => {
        const statement: Statement = query as Statement;
        const data: Array<JSONObject> = await run(statement);
        return {
          json: async (): Promise<{ data: Array<JSONObject> }> => {
            return { data };
          },
        } as never;
      });
    jest
      .spyOn(CloudCostService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        await client.insert({
          table: "CloudCostV1",
          values: rows,
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 0 },
        });
      });
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      try {
        await client.command({
          query: `DROP DATABASE IF EXISTS ${database} SYNC`,
        });
      } finally {
        await client.close();
        jest.restoreAllMocks();
      }
    }
  });

  test("a first read stores every day-series as the cloud reports it", async () => {
    const result: CloudCostWriteResult = await write([
      record({ day: "2026-11-18", amount: 100 }),
      record({ day: "2026-11-19", amount: 120 }),
      record({ day: "2026-11-19", service: "Amazon S3", amount: 4.25 }),
      record({ day: "2026-11-20", amount: 30 }),
    ]);

    expect(result.rowsWritten).toBe(4);
    expect(await storedSums(ACCOUNT_ROW)).toEqual(
      new Map([
        ["2026-11-18|Amazon EC2|us-east-1", 100],
        ["2026-11-19|Amazon EC2|us-east-1", 120],
        ["2026-11-19|Amazon S3|us-east-1", 4.25],
        ["2026-11-20|Amazon EC2|us-east-1", 30],
      ]),
    );
  });

  test("the same figures again write nothing", async () => {
    const before: number = await rowCount();
    const result: CloudCostWriteResult = await write([
      record({ day: "2026-11-18", amount: 100 }),
      record({ day: "2026-11-19", amount: 120 }),
      record({ day: "2026-11-19", service: "Amazon S3", amount: 4.25 }),
      record({ day: "2026-11-20", amount: 30 }),
    ]);

    expect(result.rowsWritten).toBe(0);
    expect(await rowCount()).toBe(before);
  });

  test("today grows, yesterday is corrected down, and a series the cloud no longer reports is cancelled", async () => {
    const result: CloudCostWriteResult = await write([
      record({ day: "2026-11-18", amount: 100 }),
      record({ day: "2026-11-19", amount: 112.5 }),
      record({ day: "2026-11-20", amount: 75 }),
    ]);

    expect(result.rowsWritten).toBe(3);
    expect(await storedSums(ACCOUNT_ROW)).toEqual(
      new Map([
        ["2026-11-18|Amazon EC2|us-east-1", 100],
        ["2026-11-19|Amazon EC2|us-east-1", 112.5],
        ["2026-11-19|Amazon S3|us-east-1", 0],
        ["2026-11-20|Amazon EC2|us-east-1", 75],
      ]),
    );
  });

  test("a row that landed twice is taken back by the next read", async () => {
    // A retried insert that had worked: the 18th stored twice.
    await client.insert({
      table: "CloudCostV1",
      values: CloudCostWriter.buildRows({
        target: TARGET,
        deltas: [
          {
            cloudAccountId: ACCOUNT_ROW.toString(),
            accountId: "123456789012",
            day: "2026-11-18",
            service: "Amazon EC2",
            region: "us-east-1",
            resourceId: "",
            currency: "USD",
            tags: {},
            amount: 100,
          },
        ],
        now: NOW,
      }),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });
    expect(
      (await storedSums(ACCOUNT_ROW)).get("2026-11-18|Amazon EC2|us-east-1"),
    ).toBe(200);

    await write([
      record({ day: "2026-11-18", amount: 100 }),
      record({ day: "2026-11-19", amount: 112.5 }),
      record({ day: "2026-11-20", amount: 75 }),
    ]);

    expect(
      (await storedSums(ACCOUNT_ROW)).get("2026-11-18|Amazon EC2|us-east-1"),
    ).toBe(100);
  });

  test("an account that could not be read keeps what it has", async () => {
    await write(
      [record({ accountId: "210987654321", day: "2026-11-19", amount: 9 })],
      ["210987654321"],
    );
    expect(await storedSums(OTHER_ROW)).toEqual(
      new Map([["2026-11-19|Amazon EC2|us-east-1", 9]]),
    );

    // A read where that account failed: its figures stay as they were.
    await write(
      [
        record({ day: "2026-11-18", amount: 100 }),
        record({ day: "2026-11-19", amount: 112.5 }),
        record({ day: "2026-11-20", amount: 75 }),
        record({ accountId: "210987654321", day: "2026-11-19", amount: 500 }),
      ],
      ["123456789012"],
    );
    expect(await storedSums(OTHER_ROW)).toEqual(
      new Map([["2026-11-19|Amazon EC2|us-east-1", 9]]),
    );
  });

  test("an account's summary is read from what is stored", async () => {
    const summaries: Map<string, CloudAccountCostSummary> =
      await CloudCostWriter.summarize({
        projectId: PROJECT,
        cloudAccountIds: [ACCOUNT_ROW.toString()],
        now: NOW,
      });
    const summary: CloudAccountCostSummary = summaries.get(
      ACCOUNT_ROW.toString(),
    )!;

    expect(summary.currency).toBe("USD");
    // The 18th, 19th and 20th as last written.
    expect(summary.monthToDate).toBe(287.5);
    expect(summary.topServices[0]).toEqual({
      service: "Amazon EC2",
      amount: 287.5,
    });
    expect(summary.latestDay).toBe("2026-11-20");
  });

  test("the Costs page's reads: each day's spend, and the window's spend by service", async () => {
    const service: CloudCostServiceClass = new CloudCostServiceClass();
    service.database = testDatabase;

    const base: Omit<
      AggregateBy<CloudCost>,
      "aggregationInterval" | "groupBy"
    > = {
      query: {
        projectId: PROJECT,
        currency: "USD",
        day: new InBetween<Date>(WINDOW.start, NOW),
      } as AggregateBy<CloudCost>["query"],
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "cost",
      aggregationTimestampColumnName: "day",
      startTimestamp: WINDOW.start,
      endTimestamp: NOW,
      limit: 1000,
      skip: 0,
      sort: { day: SortOrder.Ascending },
      props: { isRoot: true },
    };

    const daily: Array<JSONObject> = await run(
      service.toAggregateStatement({
        ...base,
        aggregationInterval: AggregationInterval.Day,
      } as AggregateBy<CloudCost>).statement,
    );
    const byDay: Record<string, number> = {};
    for (const row of daily) {
      byDay[String(row["day"]).slice(0, 10)] =
        Math.round(Number(row["cost"]) * 100) / 100;
    }

    // Both accounts, every day the window holds: as the trend draws it.
    expect(byDay).toEqual({
      "2026-11-18": 100,
      "2026-11-19": 121.5,
      "2026-11-20": 75,
    });

    const services: Array<JSONObject> = await run(
      service.toAggregateStatement({
        ...base,
        aggregationInterval: AggregationInterval.Total,
        groupBy: { service: true },
      } as AggregateBy<CloudCost>).statement,
    );

    expect(
      services.map((row: JSONObject) => {
        return [row["service"], Math.round(Number(row["cost"]) * 100) / 100];
      }),
    ).toEqual(expect.arrayContaining([["Amazon EC2", 296.5]]));
  });

  /*
   * Each cost's tags, and AWS's costs per resource, against the real table:
   * a resource's day split into its resources and the rest, a later read of
   * that day as a whole-service figure that keeps the split, a resource
   * tagged anew, and the Costs page's breakdown by a tag's value.
   */
  const WEB_1: string = "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1";
  const WEB_2: string = "arn:aws:ec2:us-east-1:123456789012:instance/i-0web2";

  async function seriesOf(
    day: string,
  ): Promise<Array<[string, string, number]>> {
    const rows: Array<JSONObject> = await run(
      CloudCostWriter.buildStoredSumsStatement({
        projectId: PROJECT,
        cloudAccountIds: [ACCOUNT_ROW.toString()],
        window: WINDOW,
      }),
    );

    return rows
      .filter((row: JSONObject): boolean => {
        return row["dayText"] === day && row["serviceName"] === "AWS Lambda";
      })
      .map((row: JSONObject): [string, string, number] => {
        return [
          String(row["resourceKey"]),
          JSON.stringify(row["tagMap"]),
          Math.round(Number(row["total"]) * 10000) / 10000,
        ];
      })
      .sort((a: [string, string, number], b: [string, string, number]) => {
        return (a[0] + a[1]).localeCompare(b[0] + b[1]);
      });
  }

  test("a day split into its resources, with their tags, and the rest", async () => {
    await write([
      record({ day: "2026-11-18", amount: 100 }),
      record({ day: "2026-11-19", amount: 112.5 }),
      record({ day: "2026-11-20", amount: 75 }),
      record({
        day: "2026-11-19",
        service: "AWS Lambda",
        resourceId: WEB_1,
        amount: 60,
        tags: { team: "web", env: "prod" },
      }),
      record({
        day: "2026-11-19",
        service: "AWS Lambda",
        resourceId: WEB_2,
        amount: 30,
      }),
      record({ day: "2026-11-19", service: "AWS Lambda", amount: 10 }),
    ]);

    expect(await seriesOf("2026-11-19")).toEqual([
      ["", "{}", 10],
      [WEB_1, JSON.stringify({ env: "prod", team: "web" }), 60],
      [WEB_2, "{}", 30],
    ]);
  });

  test("the day read again as a whole-service figure keeps its resources: only the rest moves", async () => {
    await write([
      record({ day: "2026-11-18", amount: 100 }),
      record({ day: "2026-11-19", amount: 112.5 }),
      record({ day: "2026-11-20", amount: 75 }),
      record({
        day: "2026-11-19",
        service: "AWS Lambda",
        amount: 104,
        isServiceTotal: true,
      }),
    ]);

    expect(await seriesOf("2026-11-19")).toEqual([
      ["", "{}", 14],
      [WEB_1, JSON.stringify({ env: "prod", team: "web" }), 60],
      [WEB_2, "{}", 30],
    ]);
  });

  test("a resource tagged anew: its day moves to its new tags", async () => {
    await write([
      record({ day: "2026-11-18", amount: 100 }),
      record({ day: "2026-11-19", amount: 112.5 }),
      record({ day: "2026-11-20", amount: 75 }),
      record({
        day: "2026-11-19",
        service: "AWS Lambda",
        resourceId: WEB_1,
        amount: 60,
        tags: { team: "data", env: "prod" },
      }),
      record({
        day: "2026-11-19",
        service: "AWS Lambda",
        resourceId: WEB_2,
        amount: 30,
      }),
      record({ day: "2026-11-19", service: "AWS Lambda", amount: 14 }),
    ]);

    expect(await seriesOf("2026-11-19")).toEqual([
      ["", "{}", 14],
      [WEB_1, JSON.stringify({ env: "prod", team: "data" }), 60],
      [WEB_1, JSON.stringify({ env: "prod", team: "web" }), 0],
      [WEB_2, "{}", 30],
    ]);
  });

  test("the Costs page's breakdown by a tag's value: \"\" for the costs without it", async () => {
    const service: CloudCostServiceClass = new CloudCostServiceClass();
    service.database = testDatabase;

    const aggregateBy: AggregateBy<CloudCost> = {
      query: {
        projectId: PROJECT,
        currency: "USD",
        day: new InBetween<Date>(WINDOW.start, NOW),
      } as AggregateBy<CloudCost>["query"],
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "cost",
      aggregationTimestampColumnName: "day",
      aggregationInterval: AggregationInterval.Total,
      startTimestamp: WINDOW.start,
      endTimestamp: NOW,
      limit: 1000,
      skip: 0,
      sort: { day: SortOrder.Ascending },
      groupByAttributeKeys: ["team"],
      props: { isRoot: true },
    } as AggregateBy<CloudCost>;

    const byTeam: Record<string, number> = {};

    for (const row of await run(
      service.toAggregateStatement(aggregateBy).statement,
    )) {
      const value: string = String(
        (row["attributes"] as JSONObject)["team"] ?? "",
      );
      byTeam[value] =
        (byTeam[value] || 0) + Math.round(Number(row["cost"]) * 100) / 100;
    }

    /*
     * The one tagged Lambda, and everything else the window holds - and
     * its old tag, taken back to nothing, which a breakdown leaves out
     * (sortCloudCostShares).
     */
    expect(byTeam).toEqual({ data: 60, web: 0, "": 296.5 + 44 });

    // By account and Region too, as a breakdown by environment reads it.
    const byPlace: Array<JSONObject> = await run(
      service.toAggregateStatement({
        ...aggregateBy,
        groupBy: { accountId: true, region: true },
      } as AggregateBy<CloudCost>).statement,
    );

    expect(
      byPlace
        .filter((row: JSONObject): boolean => {
          return (row["attributes"] as JSONObject)["team"] === "data";
        })
        .map((row: JSONObject) => {
          return [row["accountId"], row["region"], Number(row["cost"])];
        }),
    ).toEqual([["123456789012", "us-east-1", 60]]);

    // The older analyzer reads the same.
    const legacy: Statement =
      service.toAggregateStatement(aggregateBy).statement;
    const legacyRows: Array<JSONObject> = (
      (await (
        await client.query({
          query: legacy.query,
          query_params: legacy.query_params,
          format: "JSON",
          clickhouse_settings: { enable_analyzer: 0 },
        })
      ).json()) as { data: Array<JSONObject> }
    ).data;

    expect(legacyRows).toHaveLength(3);
  });
});
