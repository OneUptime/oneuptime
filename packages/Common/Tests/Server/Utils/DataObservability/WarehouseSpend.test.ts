import { describe, expect, test } from "@jest/globals";
import {
  buildBigQuerySpendQuery,
  buildSnowflakeSpendQuery,
  readSnowflakeObjectName,
  readSpendRow,
  SNOWFLAKE_WRITTEN_TABLES_QUERY,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { planWarehouseSpend } from "../../../../Server/Utils/DataObservability/DataWarehouseSpendIngest";
import { summarizeWarehouseSpend } from "../../../../Server/Utils/DataObservability/DataWarehouseSpendSummary";
import {
  CollectedJobSpend,
  nameJob,
  readCollectedJobSpend,
  readTeamOfTag,
} from "../../../../Types/DataObservability/DataWarehouseSpend";
import { getDataTableKey } from "../../../../Types/DataObservability/DataObservabilityMetric";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Warehouse spend: what each job spent over the last day - Snowflake's
 * credits, BigQuery's bytes billed - named by its tag or the table it
 * writes and never by its query, tied to the tables it writes, and summed
 * by team, by table and where nobody reads what it writes.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

function job(overrides: Partial<CollectedJobSpend> = {}): CollectedJobSpend {
  return {
    jobKey: "k1",
    name: "INSERT analytics.orders_daily",
    user: "etl",
    warehouse: "TRANSFORM_WH",
    team: "finance",
    runs: 24,
    failedRuns: 0,
    credits: 12.5,
    bytesBilled: null,
    writtenTables: [{ schema: "analytics", table: "orders_daily" }],
    secondsSinceLastRun: 600,
    ...overrides,
  };
}

describe("Snowflake's spend", () => {
  test("credits from attribution, read back long enough to fill in, for the store's database", () => {
    const sql: string = buildSnowflakeSpendQuery(true);

    expect(sql).toContain("SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY");
    expect(sql).toContain("SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY");
    expect(sql).toContain("UPPER(database_name) = UPPER(?)");
    expect(sql).toContain(
      "COUNT_IF(q.execution_status = 'FAIL') AS failed_runs",
    );
    expect(sql).not.toContain("query_text");
    expect(buildSnowflakeSpendQuery(false)).not.toContain(
      "QUERY_ATTRIBUTION_HISTORY",
    );
    expect(SNOWFLAKE_WRITTEN_TABLES_QUERY).toContain("objects_modified");
  });

  test("a written object is a table of the store's database", () => {
    expect(
      readSnowflakeObjectName("ANALYTICS.PUBLIC.ORDERS", "analytics"),
    ).toEqual({
      schema: "PUBLIC",
      table: "ORDERS",
    });
    expect(readSnowflakeObjectName("OTHER.PUBLIC.ORDERS", "ANALYTICS")).toBe(
      null,
    );
  });

  test("a job is named by its plain tag, its team read from a JSON tag", () => {
    expect(
      readSpendRow(
        {
          job_key: "abc",
          query_tag: '{"team": "finance", "dbt_model": "orders_daily"}',
          query_type: "INSERT",
          user_name: "DBT",
          warehouse_name: "TRANSFORM_WH",
          runs: "24",
          failed_runs: "1",
          credits: "3.75",
          seconds_since_last_run: "120",
        },
        [{ schema: "ANALYTICS", table: "ORDERS_DAILY" }],
      ),
    ).toEqual({
      jobKey: "abc",
      name: "INSERT ANALYTICS.ORDERS_DAILY",
      user: "DBT",
      warehouse: "TRANSFORM_WH",
      team: "finance",
      runs: 24,
      failedRuns: 1,
      credits: 3.75,
      bytesBilled: null,
      writtenTables: [{ schema: "ANALYTICS", table: "ORDERS_DAILY" }],
      secondsSinceLastRun: 120,
    });
  });
});

describe("BigQuery's spend", () => {
  test("bytes billed from the jobs view of the dataset's project and location, bound by value", () => {
    const query: { statement: string; params: Array<string> } | null =
      buildBigQuerySpendQuery({
        projectId: "my-project",
        dataset: "analytics",
        location: "EU",
      });

    expect(query!.statement).toContain(
      "`my-project`.`region-eu`.INFORMATION_SCHEMA.JOBS",
    );
    expect(query!.statement).toContain(
      "SUM(j.total_bytes_billed) AS bytes_billed",
    );
    expect(query!.statement).not.toContain("j.query AS");
    expect(query!.params).toEqual([
      "analytics",
      "analytics",
      "my-project",
      "analytics",
    ]);
    expect(
      buildBigQuerySpendQuery({
        projectId: "p",
        dataset: "d",
        location: "us; DROP",
      }),
    ).toBe(null);
  });

  test("a job without a written table of the dataset is named by what it does and who runs it", () => {
    expect(
      readSpendRow(
        {
          job_key: "h1",
          team: "growth",
          query_type: "SELECT",
          user_name: "looker@acme.iam.gserviceaccount.com",
          runs: 300,
          failed_runs: 0,
          bytes_billed: "5000000000000",
        },
        [],
      ),
    ).toMatchObject({
      name: "SELECT by looker@acme.iam.gserviceaccount.com",
      team: "growth",
      bytesBilled: 5_000_000_000_000,
      credits: null,
    });
  });
});

describe("naming and validation", () => {
  test("a team from a JSON tag or team:x, a name never from a query", () => {
    expect(readTeamOfTag('{"team":"data-eng"}')).toBe("data-eng");
    expect(readTeamOfTag("nightly team=finance")).toBe("finance");
    expect(readTeamOfTag("nightly")).toBe(null);
    expect(
      nameJob({
        tag: "nightly-revenue",
        queryType: "MERGE",
        writtenTable: "a.b",
        user: "u",
      }),
    ).toBe("nightly-revenue");
    expect(
      nameJob({
        tag: '{"team":"x"}',
        queryType: "merge",
        writtenTable: "a.b",
        user: "u",
      }),
    ).toBe("MERGE a.b");
  });

  test("a probe's job is bounded and checked, or dropped", () => {
    expect(readCollectedJobSpend({ jobKey: "", name: "x" })).toBe(null);
    expect(
      readCollectedJobSpend({
        jobKey: "k",
        name: "n",
        runs: -5,
        credits: "2.5",
        bytesBilled: 10.7,
        writtenTables: [{ schema: "s", table: "t" }, { table: "" }, "junk"],
      }),
    ).toEqual({
      jobKey: "k",
      name: "n",
      user: null,
      warehouse: null,
      team: null,
      runs: 0,
      failedRuns: 0,
      credits: 2.5,
      bytesBilled: 10,
      writtenTables: [{ schema: "s", table: "t" }],
      secondsSinceLastRun: null,
    });
  });
});

describe("keeping spend", () => {
  test("a job's spend is shared among the tables it writes; one writing only unused tables is marked", () => {
    const daily: ObjectID = ObjectID.generate();
    const archive: ObjectID = ObjectID.generate();
    const plan: ReturnType<typeof planWarehouseSpend> = planWarehouseSpend({
      spend: [
        job({
          credits: 10,
          writtenTables: [
            { schema: "analytics", table: "orders_daily" },
            { schema: "analytics", table: "orders_archive" },
          ],
        }),
        job({
          jobKey: "k2",
          credits: 4,
          writtenTables: [{ schema: "analytics", table: "orders_archive" }],
        }),
        job({ jobKey: "k1", credits: 999 }),
      ],
      assetIdByKey: new Map([
        [getDataTableKey("analytics", "orders_daily"), daily],
        [getDataTableKey("analytics", "orders_archive"), archive],
      ]),
      unusedAssetIds: new Set([archive.toString()]),
      collectedAt: NOW,
    });

    expect(plan.jobs).toHaveLength(2);
    expect(plan.jobs[0]!.writesOnlyUnusedTables).toBe(false);
    expect(plan.jobs[1]!.writesOnlyUnusedTables).toBe(true);
    expect(plan.jobs[0]!.lastRunAt).toEqual(
      new Date("2026-11-04T11:50:00.000Z"),
    );
    expect(plan.tableSpend.get(daily.toString())).toEqual({
      credits: 5,
      bytesBilled: 0,
    });
    expect(plan.tableSpend.get(archive.toString())).toEqual({
      credits: 9,
      bytesBilled: 0,
    });
  });

  test("the summary sums by team, flags failures and unused spend, and ranks tables", () => {
    const summary: ReturnType<typeof summarizeWarehouseSpend> =
      summarizeWarehouseSpend({
        jobs: [
          {
            team: "finance",
            userName: "etl",
            credits: 10,
            failedRunCount: 2,
            writesOnlyUnusedTables: false,
          },
          {
            userName: "looker",
            bytesBilled: 2_000_000_000_000,
            failedRunCount: 0,
            writesOnlyUnusedTables: true,
          },
          {
            team: "finance",
            userName: "dbt",
            credits: 5,
            failedRunCount: 0,
            writesOnlyUnusedTables: false,
          },
        ],
        tables: [
          {
            _id: "a1",
            assetKey: "analytics.orders_daily",
            dataStoreName: "Snowflake",
            writeCredits: 8,
          },
          {
            _id: "a2",
            assetKey: "analytics.old",
            dataStoreName: "BigQuery",
            writeBytesBilled: 1_000,
            unreadSince: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        now: NOW,
      });

    expect(summary.credits).toBe(15);
    expect(summary.bytesBilled).toBe(2_000_000_000_000);
    expect(summary.failingJobCount).toBe(1);
    expect(summary.unusedJobCount).toBe(1);
    expect(summary.unusedBytesBilled).toBe(2_000_000_000_000);
    expect(summary.byTeam).toEqual([
      { team: "finance", credits: 15, bytesBilled: 0, jobCount: 2 },
      {
        team: "looker",
        credits: 0,
        bytesBilled: 2_000_000_000_000,
        jobCount: 1,
      },
    ]);
    expect(
      summary.topTables.map((table: { table: string; isUnused: boolean }) => {
        return `${table.table}:${table.isUnused}`;
      }),
    ).toEqual(["analytics.orders_daily:false", "analytics.old:true"]);
  });
});
