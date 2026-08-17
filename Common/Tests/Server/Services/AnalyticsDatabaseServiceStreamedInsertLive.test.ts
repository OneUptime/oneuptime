import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import "../TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../Types/API/Route";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

/*
 * GUARDED LIVE INTEGRATION TEST for the streamed ClickHouse insert path
 * (CLICKHOUSE_STREAMED_INSERTS, see AnalyticsDatabaseService.insertJsonRows).
 *
 * It probes a small set of plausible dev endpoints (explicit
 * CLICKHOUSE_TEST_URL override, the config.env host/port as exported by
 * `npm test`, and the docker-compose.dev.yml host port mappings) with an
 * authenticated SELECT 1. When none is reachable the test logs a warning
 * and passes vacuously — it must never flake a machine without the dev
 * stack. When one IS reachable it exercises the REAL production code path:
 * insertJsonRows with a fresh object-mode Readable body (chunked HTTP
 * upload through gzip) into a temp table, then reads the rows back and
 * compares. wait_for_async_insert is forced to 1 via the caller-settings
 * merge so the read-back is deterministic (and the merge path itself gets
 * live coverage).
 */

const LIVE_TABLE_NAME: string = `StreamInsertLiveTest_${Date.now()}_${Math.floor(
  Math.random() * 100000,
)}`;

type LiveCandidate = {
  url: string;
  username: string;
  password: string;
  database: string;
};

/*
 * Best-effort read of repo-root config.env (four directories above this
 * test file) for local runs launched without `npm test`'s env export.
 * Returns an empty map when the file is absent (e.g. CI).
 */
function readConfigEnv(): Record<string, string> {
  const configEnvPath: string = path.join(
    __dirname,
    "../../../../config.env",
  );
  const result: Record<string, string> = {};
  try {
    if (!fs.existsSync(configEnvPath)) {
      return result;
    }
    const content: string = fs.readFileSync(configEnvPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed: string = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq: number = trimmed.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      result[trimmed.substring(0, eq)] = trimmed.substring(eq + 1);
    }
  } catch {
    // Unreadable config.env is the same as no config.env.
  }
  return result;
}

function buildCandidates(): Array<LiveCandidate> {
  const configEnv: Record<string, string> = readConfigEnv();
  const username: string =
    process.env["CLICKHOUSE_USER"] || configEnv["CLICKHOUSE_USER"] || "default";
  const password: string =
    process.env["CLICKHOUSE_PASSWORD"] || configEnv["CLICKHOUSE_PASSWORD"] || "";
  const database: string =
    process.env["CLICKHOUSE_DATABASE"] ||
    configEnv["CLICKHOUSE_DATABASE"] ||
    "default";

  const candidates: Array<LiveCandidate> = [];

  // Explicit override wins (used e.g. against a throwaway container).
  if (process.env["CLICKHOUSE_TEST_URL"]) {
    candidates.push({
      url: process.env["CLICKHOUSE_TEST_URL"] as string,
      username: process.env["CLICKHOUSE_TEST_USER"] || "default",
      password: process.env["CLICKHOUSE_TEST_PASSWORD"] || "",
      database: process.env["CLICKHOUSE_TEST_DATABASE"] || "default",
    });
  }

  // config.env host/port — resolves when running inside the compose network.
  const host: string | undefined =
    process.env["CLICKHOUSE_HOST"] || configEnv["CLICKHOUSE_HOST"];
  const port: string =
    process.env["CLICKHOUSE_PORT"] || configEnv["CLICKHOUSE_PORT"] || "8123";
  if (host) {
    candidates.push({
      url: `http://${host}:${port}`,
      username,
      password,
      database,
    });
  }

  // docker-compose.dev.yml maps clickhouse 8123 -> host 8189.
  candidates.push({
    url: "http://localhost:8189",
    username,
    password,
    database,
  });
  candidates.push({
    url: "http://localhost:8123",
    username,
    password,
    database,
  });

  return candidates;
}

/*
 * Returns a connected client for the first candidate that answers an
 * authenticated SELECT 1, or null when none does. The probe uses a short
 * request_timeout so an unreachable stack fails fast instead of hanging
 * the suite.
 */
async function findLiveClickhouse(): Promise<{
  client: ClickHouseClient;
  candidate: LiveCandidate;
} | null> {
  for (const candidate of buildCandidates()) {
    const client: ClickHouseClient = createClient({
      url: candidate.url,
      username: candidate.username,
      password: candidate.password,
      database: candidate.database,
      request_timeout: 3000,
      /*
       * The suite runs under the repo's jsdom-based test environment,
       * whose setTimeout returns a handle without .unref(). The client's
       * keep-alive idle-socket TTL is the one code path that calls
       * .unref(), so keep-alive stays off here (irrelevant for a
       * single-request test).
       */
      keep_alive: { enabled: false },
    });
    try {
      await client.query({ query: "SELECT 1", format: "JSON" });
      return { client, candidate };
    } catch {
      await client.close().catch(() => {
        // Probe cleanup only.
      });
    }
  }
  return null;
}

describe("AnalyticsDatabaseService streamed insert (live ClickHouse, guarded)", () => {
  class LiveStreamModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: LIVE_TABLE_NAME,
        singularName: "<singular-name>",
        pluralName: "<plural-name>",
        tableColumns: [
          new AnalyticsTableColumn({
            key: "a",
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.Text,
          }),
        ],
        crudApiPath: new Route("route"),
        primaryKeys: ["a"],
        sortKeys: ["a"],
        partitionKey: "a",
        tableEngine: AnalyticsTableEngine.MergeTree,
      });
    }
  }

  test(
    "streamed insertJsonRows lands rows in a temp table and reads them back",
    async () => {
      const live: {
        client: ClickHouseClient;
        candidate: LiveCandidate;
      } | null = await findLiveClickhouse();

      if (!live) {
        // eslint-disable-next-line no-console
        console.warn(
          "Skipping live streamed-insert test: no reachable ClickHouse " +
            "(set CLICKHOUSE_TEST_URL or start the dev compose stack).",
        );
        return;
      }

      const savedStreamFlag: string | undefined =
        process.env["CLICKHOUSE_STREAMED_INSERTS"];
      delete process.env["CLICKHOUSE_STREAMED_INSERTS"]; // default = streamed

      try {
        await live.client.command({
          query:
            `CREATE TABLE IF NOT EXISTS ${LIVE_TABLE_NAME} ` +
            `(a String, n Int64) ENGINE = MergeTree ORDER BY n`,
        });

        const service: AnalyticsDatabaseService<LiveStreamModel> =
          new AnalyticsDatabaseService({ modelType: LiveStreamModel });
        // Route the production insert path at the live client.
        (
          service as unknown as { ingestDatabaseClient: ClickHouseClient }
        ).ingestDatabaseClient = live.client;

        const rows: Array<JSONObject> = [
          { a: 'plain "quoted" text', n: 1 },
          { a: "unicode ♥ / newline\\n literal", n: 2 },
          { a: "third row", n: 3 },
        ];

        await service.insertJsonRows(rows, {
          dedupToken: `live-test:${LIVE_TABLE_NAME}:0`,
          /*
           * Force ack-after-flush so the SELECT below deterministically
           * sees the rows (default fire-and-forget acks on buffer accept).
           * Also live-covers the caller clickhouseSettings merge.
           */
          clickhouseSettings: { wait_for_async_insert: 1 },
        });

        const result: { json: () => Promise<unknown> } = await live.client.query(
          {
            query: `SELECT a, n FROM ${LIVE_TABLE_NAME} ORDER BY n`,
            format: "JSON",
          },
        );
        const payload: { data?: Array<{ a: string; n: number | string }> } =
          (await result.json()) as {
            data?: Array<{ a: string; n: number | string }>;
          };

        expect(payload.data).toBeDefined();
        expect(payload.data).toHaveLength(rows.length);
        for (let i: number = 0; i < rows.length; i++) {
          expect(payload.data![i]!.a).toBe(rows[i]!["a"]);
          // Int64 may arrive quoted or not depending on server settings.
          expect(String(payload.data![i]!.n)).toBe(String(rows[i]!["n"]));
        }
      } finally {
        if (savedStreamFlag === undefined) {
          delete process.env["CLICKHOUSE_STREAMED_INSERTS"];
        } else {
          process.env["CLICKHOUSE_STREAMED_INSERTS"] = savedStreamFlag;
        }
        await live.client
          .command({ query: `DROP TABLE IF EXISTS ${LIVE_TABLE_NAME}` })
          .catch(() => {
            // Best-effort cleanup.
          });
        await live.client.close().catch(() => {
          // Best-effort cleanup.
        });
      }
    },
    30000,
  );
});
