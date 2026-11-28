import fs from "fs";
import path from "path";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { readAsyncInsertBufferSettingsFromEnv } from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "Common/Types/JSON";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * WHAT CLICKHOUSE DOES WITH INSERT DEDUP TOKENS ON AN ASYNC INSERT (#11441).
 *
 * Two comments said insert_deduplication_token is not honoured for async
 * inserts (ClickHouse #52018), and gave that as why traces, logs and
 * metrics are inserted without a per-job token. On the ClickHouse
 * OneUptime ships (26.7), with the settings the ingest path's insert sent
 * with a token (async_insert=1, async_insert_deduplicate=1) and the fan-in
 * writer's buffer settings, into MetricItemV3 - sent as a client sends
 * them, so this holds ClickHouse to what it does, whatever OneUptime sends:
 *
 *   - as OneUptime stores it, a Distributed table over a local table - a
 *     MergeTree with its dedup window on the server's own default cluster,
 *     and, where the server has a Keeper and the "oneuptime" cluster
 *     (Clickhouse/config.d/cluster.xml), a ReplicatedMergeTree;
 *   - and straight into the table, which is not how OneUptime inserts.
 *
 * What it does:
 *
 *   - a job retried alone under its own token is dropped, and jobs under
 *     tokens of their own sent together share one part: the token is not
 *     in the key async inserts are buffered by;
 *   - straight into the table, each entry of a flush keeps its own token;
 *   - through the Distributed table, a flush is deduplicated under its FIRST
 *     entry's token alone: another job of it retried lands again, and a
 *     flush led by a retry of a stored token is dropped whole, the other
 *     jobs' rows with it (#11536);
 *   - with no token nothing is lost: a retry lands again;
 *   - a job re-processed into a differently composed batch lands twice: the
 *     trade the high-volume signals accept (ProcessTelemetry's
 *     INSERT_DEDUP_TYPES).
 *
 * Jobs meant for one flush are sent STAGGER_MS apart inside a fixed window
 * of WINDOW_MS, so each flush holds them in the order sent.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server;
 * TEST_CLICKHOUSE_KEEPER=true adds the ReplicatedMergeTree cases, for a
 * server started as Docker Compose runs it (its cluster.xml):
 *
 *   docker run -d --rm -p 18126:8123 -e CLICKHOUSE_PASSWORD=test \
 *     -v $PWD/Clickhouse/config.d/cluster.xml:/etc/clickhouse-server/config.d/cluster.xml \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18126 \
 *   TEST_CLICKHOUSE_KEEPER=true \
 *     npx jest Tests/Telemetry/InsertDedupTokensAsyncClickhouse.test.ts
 *
 * The App Test workflow provides the server (without a Keeper).
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
const hasKeeper: boolean = process.env["TEST_CLICKHOUSE_KEEPER"] === "true";

jest.setTimeout(600000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const RUN: string = `${process.pid}_${Date.now()}`;

// One flush window, fixed (no adaptive timeout), and the gap between sends in it.
const WINDOW_MS: number = 2000;
const STAGGER_MS: number = 150;

// A metric point as ingest writes it (IngestRowsByteForByte), to copy.
const TEMPLATE: JSONObject = ((): JSONObject => {
  const lines: Array<string> = fs
    .readFileSync(
      path.join(
        __dirname,
        "Fixtures",
        "IngestRowsByteForByte",
        "metrics.jsonl",
      ),
      "utf-8",
    )
    .split("\n");
  const header: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("# MetricItemV3 (");
  });

  return JSON.parse(lines[header + 1]!) as JSONObject;
})();

// `count` points of job `job`, each with an _id of its own.
function jobRows(job: number, count: number = 5): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    rows.push({
      ...TEMPLATE,
      _id: `019a1f2e-1b40-7000-8000-${String(job * 1000 + index).padStart(12, "0")}`,
    });
  }

  return rows;
}

function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

interface Layout {
  label: string;
  // The cluster the Distributed table spans, or null to insert straight into the table.
  cluster: string | null;
  replicated: boolean;
}

const DISTRIBUTED_OVER_MERGE_TREE: Layout = {
  label: "through a Distributed table over a MergeTree with its dedup window",
  cluster: "default",
  replicated: false,
};
const DISTRIBUTED_OVER_REPLICATED: Layout = {
  label:
    "through a Distributed table over a ReplicatedMergeTree, as a OneUptime cluster stores it",
  cluster: "oneuptime",
  replicated: true,
};
const STRAIGHT_INTO_THE_TABLE: Layout = {
  label: "straight into a MergeTree with its dedup window",
  cluster: null,
  replicated: false,
};

interface LaidOutTable {
  insert: (data: {
    rows: Array<JSONObject>;
    token?: string | undefined;
    waitsForFlush?: boolean;
  }) => Promise<void>;
  storedRows: () => Promise<number>;
  storedRowsOf: (job: number) => Promise<number>;
  activeParts: () => Promise<number>;
  token: (name: string) => string;
}

const DISTRIBUTED_LAYOUTS: Array<Layout> = [
  DISTRIBUTED_OVER_MERGE_TREE,
  ...(hasKeeper ? [DISTRIBUTED_OVER_REPLICATED] : []),
];

integration(
  "insert dedup tokens on an async insert, on the ClickHouse OneUptime ships",
  () => {
    // A database of its own holding MetricItemV3 as `layout` lays it out.
    const useLayout: (layout: Layout) => LaidOutTable = (
      layout: Layout,
    ): LaidOutTable => {
      const database: string = `dedup_tokens_${layout.cluster || "table"}_${layout.replicated ? "replicated" : "plain"}_${RUN}`;
      // Where the rows are stored: the local table behind the Distributed one.
      const storage: string = layout.cluster
        ? "MetricItemV3Local"
        : "MetricItemV3";

      let clickhouse: ClickhouseDatabase;
      let client: ClickhouseClient;
      let testNumber: number = 0;

      const scalar: (query: string) => Promise<number> = async (
        query: string,
      ): Promise<number> => {
        const result: { json: () => Promise<Array<{ value: string }>> } =
          (await client.query({
            query: query,
            format: "JSONEachRow",
          })) as unknown as { json: () => Promise<Array<{ value: string }>> };

        return Number((await result.json())[0]!.value);
      };

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
          database: "default",
          request_timeout: 120000,
          compression: { request: true, response: true },
        };

        const setup: ClickhouseDatabase = new ClickhouseDatabase(options);
        const setupClient: ClickhouseClient = await setup.connect(options);

        await setupClient.command({
          query: `CREATE DATABASE IF NOT EXISTS ${database}`,
        });
        await setup.disconnect();

        clickhouse = new ClickhouseDatabase({ ...options, database: database });
        client = await clickhouse.connect({ ...options, database: database });

        const model: Metric = new Metric();
        const columns: Statement = new StatementGenerator<Metric>({
          modelType: Metric,
          database: clickhouse,
        }).toColumnsCreateStatement(model.tableColumns);
        const engine: string = layout.replicated
          ? `ReplicatedMergeTree('/clickhouse/tables/${database}/${storage}', 'r1') PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS replicated_deduplication_window = 10000`
          : `MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS non_replicated_deduplication_window = 10000`;

        await client.command({
          query: `CREATE TABLE ${database}.${storage} (${columns.query}) ENGINE = ${engine}`,
          query_params: columns.query_params,
        });

        if (layout.cluster) {
          // The app-facing table, as OneUptime writes to it.
          await client.command({
            query: `CREATE TABLE ${database}.MetricItemV3 AS ${database}.${storage} ENGINE = Distributed('${layout.cluster}', '${database}', '${storage}', cityHash64(projectId))`,
          });
        }
      });

      beforeEach(async (): Promise<void> => {
        testNumber++;
        await client.command({
          query: `TRUNCATE TABLE ${database}.${storage} SYNC`,
        });
      });

      afterAll(async (): Promise<void> => {
        if (client) {
          await client.command({
            query: `DROP DATABASE IF EXISTS ${database} SYNC`,
          });
        }

        if (clickhouse) {
          await clickhouse.disconnect();
        }
      });

      return {
        // An insert as the ingest path sent one with a token, into MetricItemV3.
        insert: async (data: {
          rows: Array<JSONObject>;
          token?: string | undefined;
          waitsForFlush?: boolean;
        }): Promise<void> => {
          await client.insert({
            table: "MetricItemV3",
            values: data.rows,
            format: "JSONEachRow",
            clickhouse_settings: {
              async_insert: 1,
              wait_for_async_insert: data.waitsForFlush === false ? 0 : 1,
              ...(data.token
                ? {
                    async_insert_deduplicate: 1,
                    insert_deduplication_token: data.token,
                  }
                : {}),
              ...readAsyncInsertBufferSettingsFromEnv(),
              // One fixed window, so what is sent together is flushed together.
              async_insert_busy_timeout_ms: WINDOW_MS,
              async_insert_use_adaptive_busy_timeout: 0,
            },
          });
        },
        storedRows: (): Promise<number> => {
          return scalar(`SELECT count() AS value FROM ${database}.${storage}`);
        },
        storedRowsOf: (job: number): Promise<number> => {
          return scalar(
            `SELECT count() AS value FROM ${database}.${storage} WHERE _id IN (${jobRows(
              job,
            )
              .map((row: JSONObject): string => {
                return `'${String(row["_id"])}'`;
              })
              .join(", ")})`,
          );
        },
        activeParts: (): Promise<number> => {
          return scalar(
            `SELECT count() AS value FROM system.parts WHERE database = '${database}' AND table = '${storage}' AND active`,
          );
        },
        // A token of this test's own: a Keeper remembers tokens past a TRUNCATE.
        token: (name: string): string => {
          return `${RUN}:${testNumber}:${name}:MetricItemV3:0`;
        },
      };
    };

    // Jobs sent into one flush, in this order.
    const oneFlush: (
      table: LaidOutTable,
      jobs: Array<{ job: number; token?: string | undefined }>,
    ) => Promise<void> = async (
      table: LaidOutTable,
      jobs: Array<{ job: number; token?: string | undefined }>,
    ): Promise<void> => {
      const sends: Array<Promise<void>> = [];

      for (const entry of jobs) {
        sends.push(
          table.insert({ rows: jobRows(entry.job), token: entry.token }),
        );
        await wait(STAGGER_MS);
      }

      await Promise.all(sends);
    };

    describe.each(DISTRIBUTED_LAYOUTS)("$label", (layout: Layout) => {
      const table: LaidOutTable = useLayout(layout);

      test("a job retried alone under its own token is dropped", async () => {
        await table.insert({ rows: jobRows(1), token: table.token("job-1") });
        await table.insert({ rows: jobRows(1), token: table.token("job-1") });

        expect(await table.storedRows()).toBe(5);
      });

      test("and when the insert does not wait for the flush, the ingest's default ack", async () => {
        await table.insert({
          rows: jobRows(2),
          token: table.token("job-2"),
          waitsForFlush: false,
        });
        await wait(WINDOW_MS + 500);
        await table.insert({
          rows: jobRows(2),
          token: table.token("job-2"),
          waitsForFlush: false,
        });
        await wait(WINDOW_MS + 500);

        expect(await table.storedRows()).toBe(5);
      });

      test("jobs under tokens of their own, sent together, share one part", async () => {
        await oneFlush(
          table,
          [11, 12, 13, 14, 15, 16, 17, 18].map((job: number) => {
            return { job, token: table.token(`job-${job}`) };
          }),
        );

        expect(await table.storedRows()).toBe(40);
        expect(await table.activeParts()).toBe(1);
      });

      test("but a flush is deduplicated under its first entry's token alone", async () => {
        await oneFlush(
          table,
          [1, 2, 3, 4].map((job: number) => {
            return { job, token: table.token(`job-${job}`) };
          }),
        );
        expect(await table.storedRows()).toBe(20);

        // Job 2's retry lands again: its token was not the flush's.
        await table.insert({ rows: jobRows(2), token: table.token("job-2") });
        expect(await table.storedRowsOf(2)).toBe(10);

        // Job 1's is dropped: the flush was stored under its token.
        await table.insert({ rows: jobRows(1), token: table.token("job-1") });
        expect(await table.storedRowsOf(1)).toBe(5);
      });

      test("and a flush led by a retry of a stored token is dropped whole, the other jobs' rows with it (#11536)", async () => {
        await table.insert({ rows: jobRows(1), token: table.token("job-1") });

        await oneFlush(table, [
          { job: 1, token: table.token("job-1") },
          { job: 5, token: table.token("job-5") },
          { job: 6, token: table.token("job-6") },
          { job: 7, token: table.token("job-7") },
        ]);

        // Jobs 5, 6 and 7 were never stored.
        expect(await table.storedRows()).toBe(5);
        expect(await table.storedRowsOf(5)).toBe(0);
      });

      test("with no token nothing is lost: a retry lands again", async () => {
        await table.insert({ rows: jobRows(1) });

        await oneFlush(table, [{ job: 1 }, { job: 5 }, { job: 6 }, { job: 7 }]);

        expect(await table.storedRows()).toBe(25);
        expect(await table.storedRowsOf(1)).toBe(10);
      });

      test("a job re-processed into a differently composed batch lands twice: the trade the high-volume signals accept", async () => {
        // Job 6's rows went in with job 7's, and job 6 failed after the ack.
        await table.insert({
          rows: [...jobRows(6), ...jobRows(7)],
          token: table.token("fanin-first"),
        });
        // Its retry is merged with job 8's, under the next batch's token.
        await table.insert({
          rows: [...jobRows(6), ...jobRows(8)],
          token: table.token("fanin-second"),
        });

        expect(await table.storedRows()).toBe(20);
        expect(await table.storedRowsOf(6)).toBe(10);
      });
    });

    describe(STRAIGHT_INTO_THE_TABLE.label, () => {
      const table: LaidOutTable = useLayout(STRAIGHT_INTO_THE_TABLE);

      test("each entry of a flush keeps its own token", async () => {
        await oneFlush(
          table,
          [1, 2, 3, 4].map((job: number) => {
            return { job, token: table.token(`job-${job}`) };
          }),
        );
        expect(await table.activeParts()).toBe(1);

        await table.insert({ rows: jobRows(2), token: table.token("job-2") });
        expect(await table.storedRows()).toBe(20);

        // A flush led by a retry loses nothing but the retry.
        await oneFlush(table, [
          { job: 1, token: table.token("job-1") },
          { job: 5, token: table.token("job-5") },
          { job: 6, token: table.token("job-6") },
        ]);
        expect(await table.storedRows()).toBe(30);
        expect(await table.storedRowsOf(1)).toBe(5);
      });
    });
  },
);

describe("InsertDedupTokensAsyncClickhouse needs its server in CI", () => {
  test("TEST_CLICKHOUSE_URL is set wherever CI runs this suite", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
