import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
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
 * KeepProductAnalyticsForTheLongestRetention against a real ClickHouse
 * (#6626).
 *
 * The unit suite pins the statements. This one shows why there are two of
 * them. It builds the events table the way an existing install has it - the
 * model's own columns and keys, with the 13-month TTL and settings it had -
 * and writes a month of events 14 months old, while TTL merges are held, so
 * the part stays with the expiry it was written with: already past. Then:
 *
 *   - the migration raises the TTL to 25 months and recalculates the part's
 *     expiry in place: when TTL merges resume, the part stays, its expiry
 *     25 months after its month. A TTL raised without the recalculation
 *     would still drop it by the expiry it was written with (shown on a
 *     second table, altered by MODIFY TTL alone);
 *   - nothing is rewritten: the recalculation reads the one column the TTL
 *     names, and the rows read back as they were;
 *   - a month older than 25 months still goes;
 *   - running it again changes nothing.
 *
 * TTL merges are paced by merge_with_ttl_timeout (4 hours by default); the
 * tables here set it to 1 second. The CI server is a single node without a
 * cluster, so ON CLUSTER is left out of the statements and the table is a
 * plain MergeTree under the local table's name - the statements are
 * otherwise the migration's own.
 *
 * The App Test workflow provides the ClickHouse server; the guard at the
 * bottom fails the run there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/KeepProductAnalyticsForTheLongestRetentionClickhouse.test.ts
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

jest.mock("Common/Server/Utils/AnalyticsDatabase/ClusterConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/AnalyticsDatabase/ClusterConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    onClusterClause: (): string => {
      return "";
    },
  };
});

/*
 * Only the events table is built: the other two take the same statements,
 * and the migration leaves a table that does not exist alone.
 */
import MetricService from "Common/Server/Services/MetricService";
import KeepProductAnalyticsForTheLongestRetention, {
  PRODUCT_ANALYTICS_RETENTION_MODELS,
} from "../../../FeatureSet/Workers/DataMigrations/KeepProductAnalyticsForTheLongestRetention";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `pa_retention_ttl_test_${process.pid}_${Date.now()}`;

const TABLE: string = "RumProductAnalyticsEventV1Local";
/* The same table altered by MODIFY TTL alone, as a TTL change without the recalculation. */
const WITHOUT_RECALCULATION: string =
  "RumProductAnalyticsEventV1NoRecalculation";

const OLD_TTL: string = "toStartOfMonth(time) + INTERVAL 13 MONTH DELETE";
const OLD_SETTINGS: string = "ttl_only_drop_parts = 1";

const projectId: ObjectID = new ObjectID("6600000000000000000000c1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000c2");

/* A month the old TTL is past and the new one keeps, and one both are past. */
function monthsAgo(months: number): Date {
  const now: Date = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 10, 12),
  );
}

const keptMonth: Date = monthsAgo(14);
const goneMonth: Date = monthsAgo(27);

integration(
  "KeepProductAnalyticsForTheLongestRetention against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: Record<string, unknown> | undefined;

    async function rows<T>(query: string): Promise<Array<T>> {
      const result: { json: () => Promise<unknown> } = await client.query({
        query: query,
        format: "JSONEachRow",
      });

      return (await result.json()) as Array<T>;
    }

    async function count(table: string): Promise<number> {
      const found: Array<{ c: string }> = await rows<{ c: string }>(
        `SELECT toString(count()) AS c FROM ${database}.${table}`,
      );

      return Number(found[0]?.c || 0);
    }

    async function expiry(table: string): Promise<Array<string>> {
      const found: Array<{ e: string }> = await rows<{ e: string }>(
        `SELECT toString(delete_ttl_info_max) AS e FROM system.parts WHERE database = '${database}' AND table = '${table}' AND active ORDER BY e`,
      );

      return found.map((row: { e: string }): string => {
        return row.e;
      });
    }

    async function waitFor(
      condition: () => Promise<boolean>,
      what: string,
    ): Promise<void> {
      const deadline: number = Date.now() + 60000;

      while (Date.now() < deadline) {
        if (await condition()) {
          return;
        }

        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 500);
        });
      }

      throw new Error(`Timed out waiting for ${what}`);
    }

    async function createTable(name: string): Promise<void> {
      const model: AnalyticsBaseModel = new RumProductAnalyticsEvent();
      const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
        modelType: RumProductAnalyticsEvent as unknown as {
          new (): AnalyticsBaseModel;
        },
        database: clickhouse,
      }).toColumnsCreateStatement(model.tableColumns);

      await client.command({
        query: `CREATE TABLE ${database}.${name} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")}) TTL ${OLD_TTL} SETTINGS ${OLD_SETTINGS}, merge_with_ttl_timeout = 1`,
        query_params: columns.query_params,
      });

      await client.command({
        query: `SYSTEM STOP TTL MERGES ${database}.${name}`,
      });
    }

    async function insertEvents(table: string, at: Date): Promise<void> {
      await client.insert({
        table: `${database}.${table}`,
        values: [0, 1, 2].map((index: number) => {
          return {
            projectId: projectId.toString(),
            rumApplicationId: applicationId.toString(),
            kind: "page",
            name: "/pricing",
            time: OneUptimeDate.toClickhouseDateTime64(
              new Date(at.getTime() + index * 60000),
            ),
            sessionId: "ab".repeat(16),
            visitorId: "cd".repeat(16),
          };
        }),
        format: "JSONEachRow",
      });
    }

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

      original = {
        database: MetricService.database,
        databaseClient: MetricService.databaseClient,
        migrationDatabase: MetricService.migrationDatabase,
        migrationDatabaseClient: MetricService.migrationDatabaseClient,
      };

      MetricService.database = clickhouse;
      MetricService.databaseClient = client;
      MetricService.migrationDatabase = clickhouse;
      MetricService.migrationDatabaseClient = client;

      for (const table of [TABLE, WITHOUT_RECALCULATION]) {
        await createTable(table);
        await insertEvents(table, keptMonth);
        await insertEvents(table, goneMonth);
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

    test("before it runs, both months' parts are already past the 13-month expiry they were written with", async () => {
      expect(PRODUCT_ANALYTICS_RETENTION_MODELS).toHaveLength(3);

      const now: string = OneUptimeDate.toClickhouseDateTime(new Date());

      for (const part of await expiry(TABLE)) {
        expect(part < now).toBe(true);
      }

      expect(await count(TABLE)).toBe(6);
    });

    test("it raises the TTL and recalculates each part's expiry: the month the new TTL keeps stays", async () => {
      await new KeepProductAnalyticsForTheLongestRetention().migrate();

      /* The same TTL change, without the recalculation. */
      await client.command({
        query: `ALTER TABLE ${database}.${WITHOUT_RECALCULATION} MODIFY TTL ${new RumProductAnalyticsEvent().ttlExpression} SETTINGS materialize_ttl_after_modify = 0`,
      });

      const created: Array<{ q: string }> = await rows<{ q: string }>(
        `SELECT create_table_query AS q FROM system.tables WHERE database = '${database}' AND name = '${TABLE}'`,
      );

      // ClickHouse writes the interval back as toIntervalMonth().
      expect(created[0]!.q).toContain("toIntervalMonth(25)");
      expect(created[0]!.q).toContain("materialize_ttl_recalculate_only = 1");

      await waitFor(async (): Promise<boolean> => {
        const pending: Array<{ c: string }> = await rows<{ c: string }>(
          `SELECT toString(count()) AS c FROM system.mutations WHERE database = '${database}' AND table = '${TABLE}' AND NOT is_done`,
        );

        return Number(pending[0]?.c || 0) === 0;
      }, "the recalculation to finish");

      const kept: string = OneUptimeDate.toClickhouseDateTime(
        new Date(
          Date.UTC(keptMonth.getUTCFullYear(), keptMonth.getUTCMonth() + 25, 1),
        ),
      );

      expect(await expiry(TABLE)).toContain(kept);

      for (const table of [TABLE, WITHOUT_RECALCULATION]) {
        await client.command({
          query: `SYSTEM START TTL MERGES ${database}.${table}`,
        });
      }

      /* The part 27 months old goes from both; the 14-month one only from the second. */
      await waitFor(async (): Promise<boolean> => {
        return (await count(TABLE)) === 3;
      }, "the month past 25 months to go");

      await waitFor(async (): Promise<boolean> => {
        return (await count(WITHOUT_RECALCULATION)) === 0;
      }, "a TTL raised without the recalculation to drop by the old expiry");

      const left: Array<{ t: string }> = await rows<{ t: string }>(
        `SELECT toString(toStartOfMonth(time)) AS t FROM ${database}.${TABLE} GROUP BY t`,
      );

      expect(left).toEqual([
        {
          t: OneUptimeDate.toClickhouseDateTime(
            new Date(
              Date.UTC(keptMonth.getUTCFullYear(), keptMonth.getUTCMonth(), 1),
            ),
          ).substring(0, 10),
        },
      ]);
    });

    test("running it again changes nothing", async () => {
      const before: number = await count(TABLE);

      await new KeepProductAnalyticsForTheLongestRetention().migrate();

      await waitFor(async (): Promise<boolean> => {
        const pending: Array<{ c: string }> = await rows<{ c: string }>(
          `SELECT toString(count()) AS c FROM system.mutations WHERE database = '${database}' AND table = '${TABLE}' AND NOT is_done`,
        );

        return Number(pending[0]?.c || 0) === 0;
      }, "the second recalculation to finish");

      expect(await count(TABLE)).toBe(before);
    });
  },
);

describe("KeepProductAnalyticsForTheLongestRetention ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
