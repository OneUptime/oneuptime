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
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  CloudAccountCostSummary,
  getCloudAccountCostSummaryInBasis,
} from "../../../../Types/Cloud/CloudCost";
import {
  CloudCostBasis,
  getCloudCostBasisColumn,
} from "../../../../Types/Cloud/CloudCostBasis";
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
 * Each cost on three bases (#11007) against a real ClickHouse server: a
 * table made before the bases, its rows read billed on every basis once
 * the two columns are added (their DEFAULT); the writer's differences on
 * each basis, read after read - ten of them, a day corrected on one basis
 * and not the others, a read that brought amortized and net alone, a row
 * that landed twice - and the Costs page's reads summing the column of the
 * basis it shows, by day, by service and by a tag's value.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -p 127.0.0.1:8193:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 * then TEST_CLICKHOUSE_URL=http://localhost:8193 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `cloud_cost_bases_${process.pid}_${Date.now()}`;
let client: ClickHouseClient;

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const CONNECTION: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000c1",
);
const ACCOUNT_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b1",
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
  accountRows: new Map([["123456789012", ACCOUNT_ROW]]),
};

const BASIS_KEYS: Array<string> = ["amortizedCost", "netCost"];

// What the stand-in database tells the generators: this suite's own.
const testDatabase: ClickhouseDatabase = {
  getDatasourceOptions: (): { database: string } => {
    return { database };
  },
} as unknown as ClickhouseDatabase;

function generator(): StatementGenerator<CloudCost> {
  return new StatementGenerator<CloudCost>({
    modelType: CloudCost,
    database: testDatabase,
  });
}

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

function round(value: unknown): number {
  return Math.round(Number(value) * 10000) / 10000;
}

// Each day-series' stored sums, as "day|service" -> [billed, amortized, net].
async function storedSums(): Promise<Map<string, [number, number, number]>> {
  const rows: Array<JSONObject> = await run(
    CloudCostWriter.buildStoredSumsStatement({
      projectId: PROJECT,
      cloudAccountIds: [ACCOUNT_ROW.toString()],
      window: { start: new Date("2026-09-01T00:00:00.000Z"), end: WINDOW.end },
    }),
  );
  const sums: Map<string, [number, number, number]> = new Map();

  for (const row of rows) {
    const key: string = `${row["dayText"]}|${row["serviceName"]}`;
    const before: [number, number, number] = sums.get(key) || [0, 0, 0];

    sums.set(key, [
      round(before[0] + Number(row["total"])),
      round(before[1] + Number(row["amortizedTotal"])),
      round(before[2] + Number(row["netTotal"])),
    ]);
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
  bases?: Array<CloudCostBasis>,
): Promise<CloudCostWriteResult> {
  return CloudCostWriter.write({
    target: TARGET,
    window: WINDOW,
    records,
    accountsRead: new Set(["123456789012"]),
    ...(bases ? { bases } : {}),
    now: NOW,
  });
}

integration("each cost on every basis, against ClickHouse", () => {
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
     * The table as it was before the bases: the model's columns without
     * the two, one plain MergeTree under the name the app reads and writes
     * through.
     */
    const model: CloudCost = new CloudCost();
    const before: Array<AnalyticsTableColumn> = model.tableColumns.filter(
      (column: AnalyticsTableColumn): boolean => {
        return !BASIS_KEYS.includes(column.key);
      },
    );
    const columns: Statement = generator().toColumnsCreateStatement(before);
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

  test("rows written before the bases: stored, then read billed on every basis once the columns are added", async () => {
    // Two days written by a release before the bases: billed only.
    const rows: Array<JSONObject> = CloudCostWriter.buildRows({
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
        {
          cloudAccountId: ACCOUNT_ROW.toString(),
          accountId: "123456789012",
          day: "2026-11-19",
          service: "Amazon EC2",
          region: "us-east-1",
          resourceId: "",
          currency: "USD",
          tags: {},
          amount: 120,
        },
      ],
      now: NOW,
    }).map((row: JSONObject): JSONObject => {
      const old: JSONObject = { ...row };

      for (const key of BASIS_KEYS) {
        delete old[key];
      }

      return old;
    });

    await client.insert({
      table: "CloudCostV1",
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });

    // The two columns, added as boot schema-sync adds them: the model's own definitions.
    for (const key of BASIS_KEYS) {
      const column: AnalyticsTableColumn = new CloudCost().tableColumns.find(
        (item: AnalyticsTableColumn): boolean => {
          return item.key === key;
        },
      )!;
      const definition: Statement = generator().toColumnsCreateStatement([
        column,
      ]);

      expect(definition.query).toContain("DEFAULT cost");
      await client.command({
        query: `ALTER TABLE ${database}.CloudCostV1 ADD COLUMN IF NOT EXISTS ${definition.query}`,
        query_params: definition.query_params,
      });
    }

    // Read billed on every basis, nothing rewritten.
    expect(await storedSums()).toEqual(
      new Map([
        ["2026-11-18|Amazon EC2", [100, 100, 100]],
        ["2026-11-19|Amazon EC2", [120, 120, 120]],
      ]),
    );
  });

  test("their days read again on every basis: only the amortized and net differences are written", async () => {
    const before: number = await rowCount();
    const result: CloudCostWriteResult = await write([
      // A Savings Plan's fee spread: amortized under billed; a credit: net under amortized.
      record({
        day: "2026-11-18",
        amount: 100,
        amortizedAmount: 70,
        netAmount: 65,
      }),
      record({
        day: "2026-11-19",
        amount: 120,
        amortizedAmount: 84,
        netAmount: 80,
      }),
    ]);

    expect(result.rowsWritten).toBe(2);
    expect(await rowCount()).toBe(before + 2);
    expect(await storedSums()).toEqual(
      new Map([
        ["2026-11-18|Amazon EC2", [100, 70, 65]],
        ["2026-11-19|Amazon EC2", [120, 84, 80]],
      ]),
    );

    // The rows written: nothing billed, the differences on the other two.
    const written: Array<JSONObject> = (
      (await (
        await client.query({
          query: `SELECT toString(toDate(day)) AS d, toFloat64(cost) AS c, toFloat64(amortizedCost) AS a, toFloat64(netCost) AS n FROM ${database}.CloudCostV1 WHERE toFloat64(cost) = 0 ORDER BY d`,
          format: "JSON",
        })
      ).json()) as { data: Array<JSONObject> }
    ).data;

    expect(
      written.map((row: JSONObject) => {
        return [row["d"], round(row["c"]), round(row["a"]), round(row["n"])];
      }),
    ).toEqual([
      ["2026-11-18", 0, -30, -35],
      ["2026-11-19", 0, -36, -40],
    ]);
  });

  test("ten reads of a day that keeps changing: every basis is the latest figure, and an unchanged read writes nothing", async () => {
    let latest: [number, number, number] = [0, 0, 0];

    for (let read: number = 1; read <= 10; read++) {
      /*
       * Today grows each read; its amortized and net figures move with it,
       * and on the fifth read the cloud corrects net alone, down.
       */
      const billed: number = 10 * read + 0.25;
      const amortized: number = 8 * read + 0.5;
      const net: number = read === 5 ? 1 : 7 * read;

      await write([
        record({
          day: "2026-11-18",
          amount: 100,
          amortizedAmount: 70,
          netAmount: 65,
        }),
        record({
          day: "2026-11-19",
          amount: 120,
          amortizedAmount: 84,
          netAmount: 80,
        }),
        record({
          day: "2026-11-20",
          amount: billed,
          amortizedAmount: amortized,
          netAmount: net,
        }),
      ]);

      latest = [round(billed), round(amortized), round(net)];
      expect((await storedSums()).get("2026-11-20|Amazon EC2")).toEqual(latest);
    }

    // The same figures again: nothing written.
    const before: number = await rowCount();
    const again: CloudCostWriteResult = await write([
      record({
        day: "2026-11-18",
        amount: 100,
        amortizedAmount: 70,
        netAmount: 65,
      }),
      record({
        day: "2026-11-19",
        amount: 120,
        amortizedAmount: 84,
        netAmount: 80,
      }),
      record({
        day: "2026-11-20",
        amount: latest[0],
        amortizedAmount: latest[1],
        netAmount: latest[2],
      }),
    ]);

    expect(again.rowsWritten).toBe(0);
    expect(await rowCount()).toBe(before);
  });

  test("a read that brought amortized and net alone leaves the billed figures as they are", async () => {
    // An Azure subscription between its daily reads of actual cost.
    const result: CloudCostWriteResult = await write(
      [
        record({
          day: "2026-11-18",
          amount: 0,
          amortizedAmount: 71,
          netAmount: 71,
        }),
        record({
          day: "2026-11-19",
          amount: 0,
          amortizedAmount: 84,
          netAmount: 84,
        }),
        record({
          day: "2026-11-20",
          amount: 0,
          amortizedAmount: 80.5,
          netAmount: 70,
        }),
      ],
      [CloudCostBasis.Amortized, CloudCostBasis.Net],
    );

    expect(result.rowsWritten).toBeGreaterThan(0);

    const sums: Map<string, [number, number, number]> = await storedSums();

    // Billed untouched; amortized and net the read's.
    expect(sums.get("2026-11-18|Amazon EC2")).toEqual([100, 71, 71]);
    expect(sums.get("2026-11-19|Amazon EC2")).toEqual([120, 84, 84]);
    expect(sums.get("2026-11-20|Amazon EC2")).toEqual([100.25, 80.5, 70]);
  });

  test("a series the cloud no longer reports is cancelled on every basis", async () => {
    await write([
      record({
        day: "2026-11-19",
        service: "Amazon S3",
        amount: 4.25,
        amortizedAmount: 4.25,
        netAmount: 3,
      }),
      record({
        day: "2026-11-18",
        amount: 100,
        amortizedAmount: 70,
        netAmount: 65,
      }),
      record({
        day: "2026-11-19",
        amount: 120,
        amortizedAmount: 84,
        netAmount: 80,
      }),
      record({
        day: "2026-11-20",
        amount: 100.25,
        amortizedAmount: 80.5,
        netAmount: 70,
      }),
    ]);
    expect((await storedSums()).get("2026-11-19|Amazon S3")).toEqual([
      4.25, 4.25, 3,
    ]);

    await write([
      record({
        day: "2026-11-18",
        amount: 100,
        amortizedAmount: 70,
        netAmount: 65,
      }),
      record({
        day: "2026-11-19",
        amount: 120,
        amortizedAmount: 84,
        netAmount: 80,
      }),
      record({
        day: "2026-11-20",
        amount: 100.25,
        amortizedAmount: 80.5,
        netAmount: 70,
      }),
    ]);

    expect((await storedSums()).get("2026-11-19|Amazon S3")).toEqual([0, 0, 0]);
  });

  test("an account's summary on each basis, from what is stored", async () => {
    const summary: CloudAccountCostSummary = (
      await CloudCostWriter.summarize({
        projectId: PROJECT,
        cloudAccountIds: [ACCOUNT_ROW.toString()],
        now: NOW,
      })
    ).get(ACCOUNT_ROW.toString())!;

    // The 18th, 19th and 20th: billed, amortized and net.
    expect(summary.monthToDate).toBe(320.25);
    expect(summary.bases?.amortized?.monthToDate).toBe(234.5);
    expect(summary.bases?.net?.monthToDate).toBe(215);
    expect(
      getCloudAccountCostSummaryInBasis(summary, CloudCostBasis.Net)
        .topServices[0],
    ).toEqual({ service: "Amazon EC2", amount: 215 });
    expect(
      getCloudAccountCostSummaryInBasis(summary, CloudCostBasis.Amortized)
        .monthToDate,
    ).toBe(234.5);
  });

  test("the Costs page sums the column of the basis it shows: each day, each service, each tag's value", async () => {
    // A tagged resource's day, on every basis.
    await write([
      record({
        day: "2026-11-18",
        amount: 100,
        amortizedAmount: 70,
        netAmount: 65,
      }),
      record({
        day: "2026-11-19",
        amount: 120,
        amortizedAmount: 84,
        netAmount: 80,
      }),
      record({
        day: "2026-11-20",
        amount: 100.25,
        amortizedAmount: 80.5,
        netAmount: 70,
      }),
      record({
        day: "2026-11-19",
        service: "AWS Lambda",
        resourceId: "arn:aws:lambda:us-east-1:123456789012:function:web",
        amount: 6,
        amortizedAmount: 6,
        netAmount: 0,
        tags: { team: "web" },
      }),
    ]);

    const service: CloudCostServiceClass = new CloudCostServiceClass();
    service.database = testDatabase;

    const sumsOf: (
      basis: CloudCostBasis,
      extra: Partial<AggregateBy<CloudCost>>,
    ) => Promise<Array<JSONObject>> = async (
      basis: CloudCostBasis,
      extra: Partial<AggregateBy<CloudCost>>,
    ): Promise<Array<JSONObject>> => {
      const column: string = getCloudCostBasisColumn(basis);

      return (
        await run(
          service.toAggregateStatement({
            query: {
              projectId: PROJECT,
              currency: "USD",
              day: new InBetween<Date>(WINDOW.start, NOW),
            } as AggregateBy<CloudCost>["query"],
            aggregationType: AggregationType.Sum,
            aggregateColumnName: column,
            aggregationTimestampColumnName: "day",
            aggregationInterval: AggregationInterval.Day,
            startTimestamp: WINDOW.start,
            endTimestamp: NOW,
            limit: 1000,
            skip: 0,
            sort: { day: SortOrder.Ascending },
            props: { isRoot: true },
            ...extra,
          } as AggregateBy<CloudCost>).statement,
        )
      ).map((row: JSONObject): JSONObject => {
        return { ...row, value: round(row[column]) };
      });
    };

    const daily: Record<string, Record<string, number>> = {};

    for (const basis of [
      CloudCostBasis.Billed,
      CloudCostBasis.Amortized,
      CloudCostBasis.Net,
    ]) {
      for (const row of await sumsOf(basis, {})) {
        daily[basis] = daily[basis] || {};
        daily[basis]![String(row["day"]).slice(0, 10)] = Number(row["value"]);
      }
    }

    expect(daily).toEqual({
      billed: { "2026-11-18": 100, "2026-11-19": 126, "2026-11-20": 100.25 },
      amortized: { "2026-11-18": 70, "2026-11-19": 90, "2026-11-20": 80.5 },
      net: { "2026-11-18": 65, "2026-11-19": 80, "2026-11-20": 70 },
    });

    // By service, amortized: the window's spend of each.
    const byService: Array<JSONObject> = await sumsOf(
      CloudCostBasis.Amortized,
      {
        aggregationInterval: AggregationInterval.Total,
        groupBy: { service: true },
      },
    );

    expect(
      byService
        .map((row: JSONObject) => {
          return [row["service"], row["value"]];
        })
        .sort(),
    ).toEqual(
      [
        ["AWS Lambda", 6],
        ["Amazon EC2", 234.5],
        ["Amazon S3", 0],
      ].sort(),
    );

    // By a tag's value, net: the credit took the tagged function to nothing.
    const byTeam: Record<string, number> = {};

    for (const row of await sumsOf(CloudCostBasis.Net, {
      aggregationInterval: AggregationInterval.Total,
      groupByAttributeKeys: ["team"],
    })) {
      const value: string = String(
        (row["attributes"] as JSONObject)["team"] ?? "",
      );
      byTeam[value] = round((byTeam[value] || 0) + Number(row["value"]));
    }

    expect(byTeam).toEqual({ web: 0, "": 215 });
  });
});
