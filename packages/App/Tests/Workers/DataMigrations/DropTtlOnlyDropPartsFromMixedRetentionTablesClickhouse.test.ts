import ObjectID from "Common/Types/ObjectID";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import Span from "Common/Models/AnalyticsModels/Span";
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
 * DropTtlOnlyDropPartsFromMixedRetentionTables against a real ClickHouse.
 *
 * The unit suite pins the statements. This one shows what they do to the
 * data. It builds the three tables the way an install created before the fix
 * has them - the models' own columns, keys and TTL, with ttl_only_drop_parts
 * = 1 - plus SpanItemV3, which the migration leaves alone, and the minute
 * rollup's real materialized view. Each table gets two partitions:
 *
 *   - a day where most rows are 15-day telemetry that expired five days ago
 *     and a few are 30-day rows (monitor metrics, Fatal logs, error spans)
 *     that live ten more days - one part, as a day's rows are once merged;
 *   - an older day where every row has expired.
 *
 * Before the migration ClickHouse drops the second partition outright and
 * keeps every row of the first, while a copy of the metric table without the
 * setting, given the same rows, has already lost the expired ones: that is
 * the bug, a few long-lived rows holding a whole day of expired data on disk.
 * After it, TTL removes the expired rows and keeps the live ones, on the
 * three tables and not on the one it leaves alone.
 *
 * TTL merges are paced by merge_with_ttl_timeout (4 hours by default); the
 * tables here set it to 1 second so the suite waits seconds, not hours. The
 * CI server is a single node without a cluster, so ON CLUSTER is left out of
 * the statements and the tables are plain MergeTree rather than Replicated -
 * the local table names and the setting are the migration's own.
 *
 * The App Test workflow provides the ClickHouse server; the guard at the
 * bottom fails the run there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/DropTtlOnlyDropPartsFromMixedRetentionTablesClickhouse.test.ts
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

import MetricService from "Common/Server/Services/MetricService";
import {
  applyClusterToMaterializedViewQuery,
  getStorageTableName,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import DropTtlOnlyDropPartsFromMixedRetentionTables from "../../../FeatureSet/Workers/DataMigrations/DropTtlOnlyDropPartsFromMixedRetentionTables";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `ttl_only_drop_parts_test_${process.pid}_${Date.now()}`;

const METRIC_TABLE: string = getStorageTableName(new Metric().tableName);
const ROLLUP_TABLE: string = getStorageTableName(
  new MetricItemAggMV1m().tableName,
);
const LOG_TABLE: string = getStorageTableName(new Log().tableName);
const SPAN_TABLE: string = getStorageTableName(new Span().tableName);

/*
 * The control: the metric table again, as the model declares it now (no
 * ttl_only_drop_parts), holding the same rows. It shows how long TTL takes
 * to evict them once nothing stops it.
 */
const CONTROL_TABLE: string = `${METRIC_TABLE}WithoutTheSetting`;

/*
 * The day most rows are on: twenty days ago, at noon. Its 15-day rows
 * expired five days ago; its 30-day rows have ten days left.
 */
const MIXED_DAY: string =
  "toStartOfDay(now() - INTERVAL 20 DAY) + INTERVAL 12 HOUR";

/*
 * The last day of the month before it, so this day is in a partition of its
 * own in the monthly rollup too: one part per partition everywhere, and no
 * merge of two parts that would apply the TTL on its own account.
 */
const EXPIRED_DAY: string = `toStartOfMonth(${MIXED_DAY}) - INTERVAL 1 DAY + INTERVAL 12 HOUR`;

const SHORT_RETENTION_DAYS: number = 15;
const LONG_RETENTION_DAYS: number = 30;

const TELEMETRY_ROWS: number = 1000;
const MONITOR_ROWS: number = 10;
// The monitor's points carry the values 0 to 9.
const MONITOR_VALUE_TOTAL: number = (MONITOR_ROWS * (MONITOR_ROWS - 1)) / 2;
const FATAL_ROWS: number = 5;
const ERROR_SPANS: number = 5;
const SPANS: number = 100;
const EXPIRED_DAY_ROWS: number = 500;

const POLL_INTERVAL_MS: number = 500;
const WAIT_LIMIT_MS: number = 120000;

const projectId: string = ObjectID.generate().toString();
const serviceId: string = ObjectID.generate().toString();
const monitorId: string = ObjectID.generate().toString();

type ModelType = { new (): AnalyticsBaseModel };

/*
 * A local table built from the model's own columns, keys and TTL, with the
 * settings given.
 */
async function createLocalTable(data: {
  client: ClickhouseClient;
  clickhouse: ClickhouseDatabase;
  modelType: ModelType;
  settings: string;
  tableName?: string | undefined;
}): Promise<void> {
  const model: AnalyticsBaseModel = new data.modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: data.modelType,
      database: data.clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await data.client.command({
    query: `CREATE TABLE ${database}.${data.tableName || getStorageTableName(model.tableName)} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) TTL ${model.ttlExpression} SETTINGS ${data.settings}, merge_with_ttl_timeout = 1`,
    query_params: columns.query_params,
  });
}

integration(
  "DropTtlOnlyDropPartsFromMixedRetentionTables against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original:
      | Pick<
          typeof MetricService,
          | "database"
          | "databaseClient"
          | "migrationDatabase"
          | "migrationDatabaseClient"
        >
      | undefined;

    async function rows<T>(query: string): Promise<Array<T>> {
      const result: Awaited<ReturnType<ClickhouseClient["query"]>> =
        await client.query({
          query: query,
          format: "JSONEachRow",
          query_params: { projectId, serviceId, monitorId },
        });

      return (await result.json()) as Array<T>;
    }

    async function count(table: string, where: string = "1"): Promise<number> {
      const result: Array<{ c: string }> = await rows<{ c: string }>(
        `SELECT count() AS c FROM ${database}.${table} WHERE ${where}`,
      );

      return Number(result[0]?.c);
    }

    /*
     * The partitions of a table that still hold rows, oldest first. A part
     * TTL drops is replaced by an empty one until the cleanup thread removes
     * it, half a minute later, so only parts with rows count.
     */
    async function partitions(table: string): Promise<Array<string>> {
      const result: Array<{ partition: string }> = await rows<{
        partition: string;
      }>(
        `SELECT DISTINCT partition FROM system.parts WHERE database = '${database}' AND table = '${table}' AND active AND rows > 0 ORDER BY partition`,
      );

      return result.map((row: { partition: string }): string => {
        return row.partition;
      });
    }

    async function settingsOf(table: string): Promise<string> {
      const result: Array<{ query: string }> = await rows<{ query: string }>(
        `SELECT create_table_query AS query FROM system.tables WHERE database = '${database}' AND name = '${table}'`,
      );

      return result[0]?.query.split(" SETTINGS ")[1] || "";
    }

    async function waitFor(
      description: string,
      condition: () => Promise<boolean>,
    ): Promise<void> {
      const deadline: number = Date.now() + WAIT_LIMIT_MS;

      while (!(await condition())) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for ${description}`);
        }

        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, POLL_INTERVAL_MS);
        });
      }
    }

    async function allTablesHaveOnePartitionLeft(): Promise<boolean> {
      for (const table of [METRIC_TABLE, ROLLUP_TABLE, LOG_TABLE, SPAN_TABLE]) {
        if ((await partitions(table)).length !== 1) {
          return false;
        }
      }

      return true;
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

      // connect() creates the database it is pointed at.
      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      // As the models declared these three before the fix.
      for (const modelType of [Metric, MetricItemAggMV1m, Log]) {
        await createLocalTable({
          client,
          clickhouse,
          modelType,
          settings: `ttl_only_drop_parts = 1, ${new modelType().tableSettings}`,
        });
      }

      // The migration leaves this one alone: as its model declares it.
      await createLocalTable({
        client,
        clickhouse,
        modelType: Span,
        settings: new Span().tableSettings!,
      });

      // As the metric model declares it now.
      await createLocalTable({
        client,
        clickhouse,
        modelType: Metric,
        settings: new Metric().tableSettings!,
        tableName: CONTROL_TABLE,
      });

      // The rollup's own view, pointed at the local tables as on the cluster.
      for (const view of new MetricItemAggMV1m().materializedViews || []) {
        await client.command({
          query: applyClusterToMaterializedViewQuery(view.query).replace(
            / ON CLUSTER '[^']*'/,
            "",
          ),
        });
      }

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

      const params: Record<string, unknown> = {
        projectId,
        serviceId,
        monitorId,
        telemetryType: ServiceType.OpenTelemetry,
        monitorType: ServiceType.Monitor,
        fatal: LogSeverity.Fatal,
        information: LogSeverity.Information,
        shortRetention: SHORT_RETENTION_DAYS,
        longRetention: LONG_RETENTION_DAYS,
      };

      /*
       * One INSERT per table and day, so each day is one part holding all of
       * that day's rows, as it is once the day's parts have been merged.
       * Telemetry from a service and the monitor's own metrics.
       */
      for (const table of [METRIC_TABLE, CONTROL_TABLE]) {
        await client.command({
          query: `INSERT INTO ${table} (projectId, name, primaryEntityId, primaryEntityType, time, value, retentionDate)
          SELECT {projectId:String}, if(number < ${MONITOR_ROWS}, 'oneuptime.monitor.response.time', 'http.server.request.duration'),
            if(number < ${MONITOR_ROWS}, {monitorId:String}, {serviceId:String}),
            if(number < ${MONITOR_ROWS}, {monitorType:String}, {telemetryType:String}),
            toDateTime64(${MIXED_DAY}, 9) + toIntervalSecond(number) AS t, toFloat64(number),
            t + toIntervalDay(if(number < ${MONITOR_ROWS}, {longRetention:UInt32}, {shortRetention:UInt32}))
          FROM numbers(${MONITOR_ROWS + TELEMETRY_ROWS})`,
          query_params: params,
        });
      }
      await client.command({
        query: `INSERT INTO ${METRIC_TABLE} (projectId, name, primaryEntityId, primaryEntityType, time, value, retentionDate)
        SELECT {projectId:String}, 'http.server.request.duration', {serviceId:String}, {telemetryType:String},
          toDateTime64(${EXPIRED_DAY}, 9) + toIntervalSecond(number) AS t, toFloat64(number),
          t + toIntervalDay({shortRetention:UInt32})
        FROM numbers(${EXPIRED_DAY_ROWS})`,
        query_params: params,
      });

      // A project that keeps Fatal logs twice as long as the rest.
      await client.command({
        query: `INSERT INTO ${LOG_TABLE} (projectId, primaryEntityId, primaryEntityType, time, severityText, body, retentionDate)
        SELECT {projectId:String}, {serviceId:String}, {telemetryType:String},
          toDateTime64(${MIXED_DAY}, 9) + toIntervalSecond(number) AS t,
          if(number < ${FATAL_ROWS}, {fatal:String}, {information:String}), concat('line ', toString(number)),
          t + toIntervalDay(if(number < ${FATAL_ROWS}, {longRetention:UInt32}, {shortRetention:UInt32}))
        FROM numbers(${FATAL_ROWS + TELEMETRY_ROWS})`,
        query_params: params,
      });
      await client.command({
        query: `INSERT INTO ${LOG_TABLE} (projectId, primaryEntityId, primaryEntityType, time, severityText, body, retentionDate)
        SELECT {projectId:String}, {serviceId:String}, {telemetryType:String},
          toDateTime64(${EXPIRED_DAY}, 9) + toIntervalSecond(number) AS t, {information:String},
          concat('line ', toString(number)), t + toIntervalDay({shortRetention:UInt32})
        FROM numbers(${EXPIRED_DAY_ROWS})`,
        query_params: params,
      });

      // The same shape on the spans: error spans kept longer than the rest.
      await client.command({
        query: `INSERT INTO ${SPAN_TABLE} (projectId, primaryEntityId, primaryEntityType, startTime, traceId, spanId, name, retentionDate)
        SELECT {projectId:String}, {serviceId:String}, {telemetryType:String},
          toDateTime64(${MIXED_DAY}, 9) + toIntervalSecond(number) AS t,
          concat('trace-', toString(number)), concat('span-', toString(number)), 'GET /',
          t + toIntervalDay(if(number < ${ERROR_SPANS}, {longRetention:UInt32}, {shortRetention:UInt32}))
        FROM numbers(${SPANS})`,
        query_params: params,
      });
      await client.command({
        query: `INSERT INTO ${SPAN_TABLE} (projectId, primaryEntityId, primaryEntityType, startTime, traceId, spanId, name, retentionDate)
        SELECT {projectId:String}, {serviceId:String}, {telemetryType:String},
          toDateTime64(${EXPIRED_DAY}, 9) + toIntervalSecond(number) AS t,
          concat('trace-', toString(number)), concat('span-', toString(number)), 'GET /',
          t + toIntervalDay({shortRetention:UInt32})
        FROM numbers(${EXPIRED_DAY_ROWS})`,
        query_params: params,
      });
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

    test("before it: a day where every row expired is dropped, a day where a few rows live on keeps all of its rows", async () => {
      /*
       * TTL is running on every table - the fully expired day goes - and it
       * has had the time to evict the expired rows of the mixed day: the
       * control, which does not have the setting, already lost them.
       */
      await waitFor(
        "the fully expired day to be dropped from every table, and the control to evict its expired rows",
        async (): Promise<boolean> => {
          return (
            (await allTablesHaveOnePartitionLeft()) &&
            (await count(CONTROL_TABLE)) === MONITOR_ROWS
          );
        },
      );

      // ...while the day with a few long-lived rows keeps every row it had.
      expect(await count(METRIC_TABLE)).toBe(MONITOR_ROWS + TELEMETRY_ROWS);
      expect(await count(LOG_TABLE)).toBe(FATAL_ROWS + TELEMETRY_ROWS);
      expect(await count(SPAN_TABLE)).toBe(SPANS);
      expect(
        await count(ROLLUP_TABLE, "primaryEntityId = {serviceId:String}"),
      ).toBeGreaterThan(0);

      // Expired five days ago, still on disk.
      expect(await count(METRIC_TABLE, "retentionDate < now()")).toBe(
        TELEMETRY_ROWS,
      );
      expect(await count(LOG_TABLE, "retentionDate < now()")).toBe(
        TELEMETRY_ROWS,
      );
    });

    test("the app's read-side retention filter already hides those rows", async () => {
      // The predicate AnalyticsDatabaseService.getRetentionReadFilter appends.
      expect(await count(METRIC_TABLE, "retentionDate >= now()")).toBe(
        MONITOR_ROWS,
      );
      expect(await count(LOG_TABLE, "retentionDate >= now()")).toBe(FATAL_ROWS);
    });

    test("it sets ttl_only_drop_parts to 0 on the three tables and leaves the rest of their settings alone", async () => {
      for (const table of [METRIC_TABLE, ROLLUP_TABLE, LOG_TABLE]) {
        expect(await settingsOf(table)).toContain("ttl_only_drop_parts = 1");
      }

      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      for (const table of [METRIC_TABLE, ROLLUP_TABLE, LOG_TABLE]) {
        const settings: string = await settingsOf(table);

        expect(settings).toContain("ttl_only_drop_parts = 0");
        expect(settings).not.toContain("ttl_only_drop_parts = 1");
        expect(settings).toContain(
          "non_replicated_deduplication_window = 10000",
        );
        expect(settings).toContain("merge_with_ttl_timeout = 1");
      }
    });

    test("after it, the expired rows go and the live ones stay", async () => {
      await waitFor("the expired rows to be removed", async () => {
        return (
          (await count(METRIC_TABLE)) === MONITOR_ROWS &&
          (await count(LOG_TABLE)) === FATAL_ROWS &&
          (await count(
            ROLLUP_TABLE,
            "primaryEntityId = {serviceId:String}",
          )) === 0
        );
      });

      /*
       * The counts are cast to UInt32, which every client serialises as a JSON
       * number (a 64-bit count may come back as a string).
       */

      // The monitor's own series, every point of it.
      const metrics: Array<{
        primaryEntityType: string;
        points: number;
        total: number;
      }> = await rows(
        `SELECT primaryEntityType, toUInt32(count()) AS points, sum(value) AS total FROM ${database}.${METRIC_TABLE} GROUP BY primaryEntityType`,
      );

      expect(metrics).toEqual([
        {
          primaryEntityType: ServiceType.Monitor,
          points: MONITOR_ROWS,
          total: MONITOR_VALUE_TOTAL,
        },
      ]);

      // Its rollup still adds up to the same series.
      const rollup: Array<{ points: number; total: number }> = await rows(
        `SELECT toUInt32(countMerge(valueCountState)) AS points, sumMerge(valueSumState) AS total FROM ${database}.${ROLLUP_TABLE} WHERE primaryEntityId = {monitorId:String}`,
      );

      expect(rollup).toEqual([
        { points: MONITOR_ROWS, total: MONITOR_VALUE_TOTAL },
      ]);

      // The Fatal logs, every one of them.
      const logs: Array<{ severityText: string; lines: number }> = await rows(
        `SELECT severityText, toUInt32(count()) AS lines FROM ${database}.${LOG_TABLE} GROUP BY severityText`,
      );

      expect(logs).toEqual([
        { severityText: LogSeverity.Fatal, lines: FATAL_ROWS },
      ]);

      // Nothing left on disk that a read would not see.
      expect(await count(METRIC_TABLE, "retentionDate < now()")).toBe(0);
      expect(await count(LOG_TABLE, "retentionDate < now()")).toBe(0);
    });

    test("a table it leaves alone keeps the setting, and every row of its mixed day", async () => {
      expect(await settingsOf(SPAN_TABLE)).toContain("ttl_only_drop_parts = 1");
      expect(await count(SPAN_TABLE)).toBe(SPANS);
    });

    test("running it again changes nothing", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      for (const table of [METRIC_TABLE, ROLLUP_TABLE, LOG_TABLE]) {
        expect(await settingsOf(table)).toContain("ttl_only_drop_parts = 0");
      }

      expect(await count(METRIC_TABLE)).toBe(MONITOR_ROWS);
      expect(await count(LOG_TABLE)).toBe(FATAL_ROWS);
    });

    test("a table that does not exist is skipped, not a failure", async () => {
      await client.command({ query: `DROP TABLE ${database}.${LOG_TABLE}` });

      await expect(
        new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate(),
      ).resolves.toBeUndefined();

      expect(await settingsOf(METRIC_TABLE)).toContain(
        "ttl_only_drop_parts = 0",
      );
    });
  },
);

describe("ttl_only_drop_parts ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
