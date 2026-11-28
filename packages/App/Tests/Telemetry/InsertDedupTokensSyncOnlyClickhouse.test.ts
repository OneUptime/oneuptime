import fs from "fs";
import path from "path";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import MetricService from "Common/Server/Services/MetricService";
import { runWithInsertDedup } from "Common/Server/Utils/AnalyticsDatabase/InsertDedupContext";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  FanInInsertTarget,
  FanInSubmitResult,
  TelemetryFanInWriter,
  readAsyncInsertBufferSettingsFromEnv,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
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
 * ONEUPTIME'S INSERTS KEEP EVERY JOB'S ROWS (#11536).
 *
 * Through a Distributed table - how OneUptime stores every telemetry
 * table - ClickHouse dedups an ASYNC flush under its first entry's token
 * alone, so a retry under a token that led an earlier flush dropped a
 * later flush it led whole, the other jobs' rows with it
 * (InsertDedupTokensAsyncClickhouse holds what ClickHouse does). OneUptime
 * no longer sends a token with an async insert:
 *
 *   - an explicit token (the change recorders') makes the insert
 *     synchronous, so its retry is dropped alone, whatever else is being
 *     inserted at the same moment;
 *   - the fan-in writer's inserts are async and carry no token: a job's
 *     retry, in its own scope or out of one, may land twice, and every
 *     other job's rows are stored;
 *   - a telemetry job's direct insert stays async and untokened, so its
 *     retry takes no other job's rows either.
 *
 * Through the real MetricService.insertJsonRows and TelemetryFanInWriter,
 * into a Distributed MetricItemV3 over a MergeTree with its dedup window
 * on the server's default cluster - and, with TEST_CLICKHOUSE_KEEPER=true
 * on a server started as Compose runs it (Clickhouse/config.d/cluster.xml),
 * over a ReplicatedMergeTree on the "oneuptime" cluster. Opt in locally:
 *
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18126 \
 *   TEST_CLICKHOUSE_KEEPER=true \
 *     npx jest Tests/Telemetry/InsertDedupTokensSyncOnlyClickhouse.test.ts
 *
 * The App Test workflow provides the server (without a Keeper).
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
const hasKeeper: boolean = process.env["TEST_CLICKHOUSE_KEEPER"] === "true";

jest.setTimeout(600000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const RUN: string = `${process.pid}_${Date.now()}`;

// One flush window, fixed, so what is sent together is flushed together.
const WINDOW_MS: number = 2000;
const STAGGER_MS: number = 150;

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

/*
 * The writer's buffer settings, with one fixed window, and the ingest's
 * default ack: an insert returns once its rows are in the buffer, so the
 * writer's inserts, one after another in its slot, share one flush - as
 * they do in production, where a retry leading a flush took the rest.
 */
const BUFFER_SETTINGS: Record<string, unknown> = {
  ...readAsyncInsertBufferSettingsFromEnv(),
  async_insert_busy_timeout_ms: WINDOW_MS,
  async_insert_use_adaptive_busy_timeout: 0,
  wait_for_async_insert: 0,
};

interface WiredService {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

interface Layout {
  label: string;
  cluster: string;
  replicated: boolean;
}

const LAYOUTS: Array<Layout> = [
  {
    label: "a Distributed table over a MergeTree with its dedup window",
    cluster: "default",
    replicated: false,
  },
  ...(hasKeeper
    ? [
        {
          label:
            "a Distributed table over a ReplicatedMergeTree, as a OneUptime cluster stores it",
          cluster: "oneuptime",
          replicated: true,
        },
      ]
    : []),
];

integration("OneUptime's inserts keep every job's rows", () => {
  describe.each(LAYOUTS)("into $label", (layout: Layout) => {
    const database: string = `dedup_sync_${layout.cluster}_${RUN}`;
    const service: WiredService = MetricService as unknown as WiredService;

    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let saved: WiredService;
    let testNumber: number = 0;

    const token: (name: string) => string = (name: string): string => {
      return `${RUN}:${testNumber}:${name}:MetricItemV3:0`;
    };

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

    // Once the window is out and its flush stored.
    const flushed: () => Promise<void> = async (): Promise<void> => {
      await wait(WINDOW_MS + 1500);
      await client.command({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
    };

    const storedRowsOf: (job: number) => Promise<number> = (
      job: number,
    ): Promise<number> => {
      return scalar(
        `SELECT count() AS value FROM ${database}.MetricItemV3Local WHERE _id IN (${jobRows(
          job,
        )
          .map((row: JSONObject): string => {
            return `'${String(row["_id"])}'`;
          })
          .join(", ")})`,
      );
    };

    // A writer as the worker runs one, its buffer in one fixed window.
    const newWriter: () => TelemetryFanInWriter = (): TelemetryFanInWriter => {
      return new TelemetryFanInWriter({
        maxBatchRows: 1_000_000,
        maxWaitMs: 20,
        maxConcurrentInserts: 1,
        maxPendingRows: 1_000_000,
        retryMaxAttempts: 1,
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 1,
        insertClickhouseSettings: BUFFER_SETTINGS as never,
      });
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
        ? `ReplicatedMergeTree('/clickhouse/tables/${database}/MetricItemV3Local', 'r1') PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS replicated_deduplication_window = 10000`
        : `MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS non_replicated_deduplication_window = 10000`;

      await client.command({
        query: `CREATE TABLE ${database}.MetricItemV3Local (${columns.query}) ENGINE = ${engine}`,
        query_params: columns.query_params,
      });
      await client.command({
        query: `CREATE TABLE ${database}.MetricItemV3 AS ${database}.MetricItemV3Local ENGINE = Distributed('${layout.cluster}', '${database}', 'MetricItemV3Local', cityHash64(projectId))`,
      });

      saved = {
        database: service.database,
        databaseClient: service.databaseClient,
        ingestDatabase: service.ingestDatabase,
        ingestDatabaseClient: service.ingestDatabaseClient,
      };
      service.database = clickhouse;
      service.databaseClient = client;
      service.ingestDatabase = clickhouse;
      service.ingestDatabaseClient = client;
    });

    beforeEach(async (): Promise<void> => {
      testNumber++;
      await client.command({
        query: `TRUNCATE TABLE ${database}.MetricItemV3Local SYNC`,
      });
    });

    afterAll(async (): Promise<void> => {
      if (saved) {
        Object.assign(service, saved);
      }

      if (client) {
        await client.command({
          query: `DROP DATABASE IF EXISTS ${database} SYNC`,
        });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test("an explicit token's insert is synchronous: its retry is dropped alone, whatever is inserted beside it", async () => {
      await MetricService.insertJsonRows(jobRows(1), {
        dedupToken: token("change-1"),
      });

      // The retry, first, then three async inserts, all inside one window.
      const sends: Array<Promise<void>> = [
        MetricService.insertJsonRows(jobRows(1), {
          dedupToken: token("change-1"),
        }),
      ];

      for (const job of [5, 6, 7]) {
        await wait(STAGGER_MS);
        sends.push(
          MetricService.insertJsonRows(jobRows(job), {
            clickhouseSettings: BUFFER_SETTINGS as never,
          }),
        );
      }

      await Promise.all(sends);
      await flushed();

      expect(await storedRowsOf(1)).toBe(5);

      for (const job of [5, 6, 7]) {
        expect(await storedRowsOf(job)).toBe(5);
      }
    });

    test("a job retried in its dedup scope, leading a flush of other jobs, takes none of their rows with it", async () => {
      const writer: TelemetryFanInWriter = newWriter();
      const target: FanInInsertTarget =
        MetricService as unknown as FanInInsertTarget;
      const submitInScope: (job: number) => Promise<void> = async (
        job: number,
      ): Promise<void> => {
        await runWithInsertDedup(
          `${RUN}:${testNumber}:job-${job}`,
          async (): Promise<void> => {
            const submitted: FanInSubmitResult = await writer.submit(
              target,
              jobRows(job),
            );
            await submitted.flushed;
          },
        );
      };

      await submitInScope(1);
      await flushed();

      // Job 1's retry first, then three other jobs, in one ClickHouse flush.
      const sends: Array<Promise<void>> = [submitInScope(1)];

      for (const job of [5, 6, 7]) {
        await wait(STAGGER_MS);
        sends.push(submitInScope(job));
      }

      await Promise.all(sends);
      await flushed();

      for (const job of [5, 6, 7]) {
        expect(await storedRowsOf(job)).toBe(5);
      }

      // The retry landed again: the trade, never another job's rows.
      expect(await storedRowsOf(1)).toBe(10);
    });

    test("a batch retried with the writer tier's token, leading a flush, takes none of the others' rows with it", async () => {
      const writer: TelemetryFanInWriter = newWriter();
      const target: FanInInsertTarget =
        MetricService as unknown as FanInInsertTarget;
      const submitGroup: (
        job: number,
        groupToken: string,
      ) => Promise<void> = async (
        job: number,
        groupToken: string,
      ): Promise<void> => {
        const submitted: FanInSubmitResult = await writer.submit(
          target,
          jobRows(job),
          { dedupToken: groupToken, due: true },
        );
        await submitted.flushed;
      };

      await submitGroup(1, token("worker-group-1"));
      await flushed();

      const sends: Array<Promise<void>> = [
        submitGroup(1, token("worker-group-1")),
      ];

      for (const job of [5, 6, 7]) {
        await wait(STAGGER_MS);
        sends.push(submitGroup(job, token(`worker-group-${job}`)));
      }

      await Promise.all(sends);
      await flushed();

      for (const job of [5, 6, 7]) {
        expect(await storedRowsOf(job)).toBe(5);
      }
    });

    test("a job's direct inserts in its dedup scope carry no token: its retry, leading a flush, takes no other job's rows", async () => {
      const insertInScope: (job: number) => Promise<void> = (
        job: number,
      ): Promise<void> => {
        return runWithInsertDedup(
          `${RUN}:${testNumber}:job-${job}`,
          async (): Promise<void> => {
            await MetricService.insertJsonRows(jobRows(job), {
              clickhouseSettings: BUFFER_SETTINGS as never,
            });
          },
        );
      };

      await insertInScope(2);
      await flushed();

      // Job 2's retry first, then two other jobs' inserts, in one flush.
      const sends: Array<Promise<void>> = [insertInScope(2)];

      for (const job of [8, 9]) {
        await wait(STAGGER_MS);
        sends.push(insertInScope(job));
      }

      await Promise.all(sends);
      await flushed();

      for (const job of [8, 9]) {
        expect(await storedRowsOf(job)).toBe(5);
      }
    });
  });
});

describe("InsertDedupTokensSyncOnlyClickhouse needs its server in CI", () => {
  test("TEST_CLICKHOUSE_URL is set wherever CI runs this suite", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
