import fs from "fs";
import path from "path";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { JSONObject } from "Common/Types/JSON";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * THE ROWS CLICKHOUSE STORES, THROUGH THE NEW INSERT BODY (#6086).
 *
 * insertJsonRows now writes its JSONEachRow body in pieces and sends it
 * through exec(), where client.insert() joined every row into one string.
 * Here the rows ingest builds for every OTLP shape - logs, spans, metric
 * points and exceptions, the expected rows of IngestRowsByteForByte - go
 * into ClickHouse both ways, into twin tables, and what ClickHouse then
 * holds is read back as JSONEachRow and compared byte for byte.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/InsertBodyClickhouse.test.ts
 *
 * The App Test workflow provides the server.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `insert_body_test_${process.pid}_${Date.now()}`;

const GOLDEN_DIR: string = path.join(
  __dirname,
  "Fixtures",
  "IngestRowsByteForByte",
);

// The rows of every table in the golden files, by table name.
function goldenRows(): Map<string, Array<JSONObject>> {
  const byTable: Map<string, Array<JSONObject>> = new Map();

  for (const file of fs.readdirSync(GOLDEN_DIR)) {
    let table: string | null = null;

    for (const line of fs
      .readFileSync(path.join(GOLDEN_DIR, file), "utf-8")
      .split("\n")) {
      const header: RegExpMatchArray | null = line.match(/^# (\S+) \(/);

      if (header) {
        table = header[1]!;
        continue;
      }

      if (line && table) {
        const rows: Array<JSONObject> = byTable.get(table) || [];
        rows.push(JSON.parse(line) as JSONObject);
        byTable.set(table, rows);
      }
    }
  }

  return byTable;
}

interface WiredService {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

const SERVICES: Array<{
  table: string;
  modelType: { new (): AnalyticsBaseModel };
  service: AnalyticsDatabaseService<AnalyticsBaseModel>;
}> = [
  {
    table: "LogItemV3",
    modelType: Log,
    service:
      LogService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
  },
  {
    table: "SpanItemV3",
    modelType: Span,
    service:
      SpanService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
  },
  {
    table: "MetricItemV3",
    modelType: Metric,
    service:
      MetricService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
  },
  {
    table: "ExceptionItemV3",
    modelType: ExceptionInstance,
    service:
      ExceptionInstanceService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
  },
];

integration(
  "insertJsonRows stores the rows client.insert() stored, byte for byte",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    const saved: Map<WiredService, WiredService> = new Map();

    async function createTable(
      modelType: { new (): AnalyticsBaseModel },
      tableName: string,
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
        query: `CREATE TABLE ${database}.${tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
        query_params: columns.query_params,
      });
    }

    // What a table holds, as ClickHouse writes it out: JSONEachRow by _id.
    async function stored(tableName: string): Promise<string> {
      const result: { text: () => Promise<string> } = (await client.query({
        query: `SELECT * FROM ${database}.${tableName} ORDER BY _id`,
        format: "JSONEachRow",
      })) as unknown as { text: () => Promise<string> };

      return await result.text();
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
        // As the App's pools send them.
        compression: { request: true, response: true },
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      for (const entry of SERVICES) {
        await createTable(entry.modelType, entry.table);
        await createTable(entry.modelType, `${entry.table}_byClient`);

        const service: WiredService = entry.service as unknown as WiredService;
        saved.set(service, {
          database: service.database,
          databaseClient: service.databaseClient,
          ingestDatabase: service.ingestDatabase,
          ingestDatabaseClient: service.ingestDatabaseClient,
        });
        service.database = clickhouse;
        service.databaseClient = client;
        service.ingestDatabase = clickhouse;
        service.ingestDatabaseClient = client;
      }
    });

    afterAll(async (): Promise<void> => {
      for (const [service, original] of saved) {
        Object.assign(service, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test.each(
      SERVICES.map((entry: (typeof SERVICES)[number]) => {
        return [entry.table, entry] as [string, (typeof SERVICES)[number]];
      }),
    )(
      "%s",
      async (
        _table: string,
        entry: (typeof SERVICES)[number],
      ): Promise<void> => {
        const rows: Array<JSONObject> | undefined = goldenRows().get(
          entry.table,
        );

        expect(rows?.length || 0).toBeGreaterThan(0);

        // The ingest path, waiting for the flush so a refused row fails here.
        await entry.service.insertJsonRows(rows!, {
          clickhouseSettings: { wait_for_async_insert: 1 },
        });

        // What client.insert() did with the same rows and settings.
        await client.insert({
          table: `${entry.table}_byClient`,
          values: rows!,
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
        });

        const byService: string = await stored(entry.table);
        const byClient: string = await stored(`${entry.table}_byClient`);

        expect(byService.split("\n").filter(Boolean)).toHaveLength(
          rows!.length,
        );
        expect(byService).toBe(byClient);
      },
    );
  },
);

describe("InsertBodyClickhouse needs its server in CI", () => {
  test("TEST_CLICKHOUSE_URL is set wherever CI runs this suite", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
