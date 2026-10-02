import ObjectID from "Common/Types/ObjectID";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
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
 * RoundTtlToDayOnMixedRetentionTables against a real ClickHouse.
 *
 * The unit suite pins the statements. This one shows what they do. It
 * builds the three tables the way an existing install has them - the
 * models' own columns and keys, with the TTL they had before,
 * `retentionDate DELETE` - writes days of rows into them, runs the
 * migration, and follows what ClickHouse does with the parts:
 *
 *   - the migration rewrites nothing: no mutation, the same parts with the
 *     same TTL bounds, and the TTL now the one a fresh install creates;
 *   - a part written before it keeps its old bounds until its next TTL
 *     merge, which applies the rounded TTL: rows that expired earlier today
 *     stay until midnight, rows that expired yesterday go;
 *   - a part written after it expires a day's rows of one retention at
 *     once: a day of yesterday's rows is dropped without a rewrite, a day
 *     that also holds longer-lived rows is merged once, writing only those,
 *     and a day whose rows expired today, or holds rows stamped ahead of
 *     the clock that ingested them, is not touched before midnight;
 *   - none of what the rounded TTL keeps is visible to the read filter.
 *
 * TTL merges are paced by merge_with_ttl_timeout (4 hours by default); the
 * tables here set it to 1 second. The CI server is a single node without a
 * cluster, so ON CLUSTER is left out of the statements and the tables are
 * plain MergeTree - the local table names and the TTL are the migration's
 * own. (That materialize_ttl_after_modify = 0 rides along with the ON
 * CLUSTER task was checked on the repo's cluster of one,
 * Clickhouse/config.d/cluster.xml: no mutation is queued.)
 *
 * The rounded TTL turns on midnight, so the suite does not start in the
 * last minutes of a day: it waits for the next one to begin instead.
 *
 * The App Test workflow provides the ClickHouse server; the guard at the
 * bottom fails the run there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/RoundTtlToDayOnMixedRetentionTablesClickhouse.test.ts
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
import RoundTtlToDayOnMixedRetentionTables from "../../../FeatureSet/Workers/DataMigrations/RoundTtlToDayOnMixedRetentionTables";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `round_ttl_to_day_test_${process.pid}_${Date.now()}`;

const METRIC_TABLE: string = getStorageTableName(new Metric().tableName);
const ROLLUP_TABLE: string = getStorageTableName(
  new MetricItemAggMV1m().tableName,
);
const LOG_TABLE: string = getStorageTableName(new Log().tableName);
const RAW_TABLES: Array<string> = [METRIC_TABLE, LOG_TABLE];
const ALL_TABLES: Array<string> = [METRIC_TABLE, ROLLUP_TABLE, LOG_TABLE];

// The TTL every one of them had before the migration...
const OLD_TTL: string = "retentionDate DELETE";
// ...as ClickHouse shows it (DELETE is the default action).
const OLD_TTL_AS_SHOWN: string = "retentionDate";

// What a fresh install creates: the same tables from the models as they are.
const FRESH_SUFFIX: string = "AsCreatedFresh";

const TODAY: string = "toStartOfDay(now())";
const TOMORROW: string = `(${TODAY} + INTERVAL 1 DAY)`;
const SECONDS_INTO_TODAY: string = `dateDiff('second', ${TODAY}, now())`;

/*
 * The suite needs its rows to keep the same "today" from start to end, so
 * it does not start in a day's first two minutes (a minute of rows that
 * expired today has to be over already) or its last five.
 */
const SECONDS_AFTER_MIDNIGHT: number = 120;
const SUITE_BUDGET_SECONDS: number = 300;

const ROWS: number = 200;
const LONG_LIVED_EVERY: number = 10;
const LONG_LIVED_ROWS: number = ROWS / LONG_LIVED_EVERY;

const POLL_INTERVAL_MS: number = 500;
const WAIT_LIMIT_MS: number = 120000;

// Long enough for merge_with_ttl_timeout = 1 to have come round several times.
const SETTLE_MS: number = 5000;

const projectId: string = ObjectID.generate().toString();

/*
 * A day of rows each, in a partition of its own: `time` is on the day
 * `daysAgo` days before today, `createdAt` is when it was ingested, and
 * `retentionDate` is the ingest time plus the row's retention - which is
 * how ingest stamps them. Each day is written by a single INSERT, so it is
 * one part, as a day's rows are once merged. In SQL, `number` counts the
 * day's rows and `day` is the start of its partition's day.
 */
interface Day {
  name: string;
  daysAgo: number;
  time: string;
  createdAt: string;
  retentionDate: string;
  entityId: string;
}

function day(data: Omit<Day, "entityId">): Day {
  return { ...data, entityId: ObjectID.generate().toString() };
}

// Spread over the whole day.
const ACROSS_THE_DAY: string = `day + toIntervalSecond(intDiv(number * 86399, ${ROWS}))`;

// Written before the migration, under the old TTL.

// Every row's retentionDate was yesterday noon: it all goes either way.
const EXPIRED_YESTERDAY: Day = day({
  name: "expired yesterday",
  daysAgo: 26,
  time: "day + INTERVAL 12 HOUR + toIntervalSecond(number)",
  createdAt: "time",
  retentionDate: "createdAt + INTERVAL 25 DAY",
});

/*
 * retentionDate from midnight to an hour from now: under the old TTL the
 * rows expired so far would be deleted at the next TTL merge; under the
 * rounded one none of them goes before midnight.
 */
const EXPIRING_TODAY: Day = day({
  name: "expiring today",
  daysAgo: 25,
  time: `day + toIntervalSecond(intDiv(number * least(${SECONDS_INTO_TODAY} + 3600, 86399), ${ROWS}))`,
  createdAt: "time",
  retentionDate: "createdAt + INTERVAL 25 DAY",
});

// retentionDate tomorrow noon: no TTL merge is due on it at all.
const EXPIRING_TOMORROW: Day = day({
  name: "expiring tomorrow",
  daysAgo: 24,
  time: "day + INTERVAL 12 HOUR + toIntervalSecond(number)",
  createdAt: "time",
  retentionDate: "createdAt + INTERVAL 25 DAY",
});

const BEFORE_THE_MIGRATION: Array<Day> = [
  EXPIRED_YESTERDAY,
  EXPIRING_TODAY,
  EXPIRING_TOMORROW,
];

// Written after the migration, under the rounded TTL.

// One retention, all of it expired yesterday: a part drop, no rewrite.
const ONE_RETENTION_EXPIRED: Day = day({
  name: "one retention, expired",
  daysAgo: 23,
  time: ACROSS_THE_DAY,
  createdAt: "time",
  retentionDate: "createdAt + INTERVAL 22 DAY",
});

/*
 * Two retentions: most rows expired yesterday, every tenth (a monitor
 * metric, a severity kept longer) lives eleven more days. One merge, which
 * writes only those.
 */
const TWO_RETENTIONS: Day = day({
  name: "two retentions",
  daysAgo: 22,
  time: ACROSS_THE_DAY,
  createdAt: "time",
  retentionDate: `createdAt + toIntervalDay(if(number % ${LONG_LIVED_EVERY} = 0, 32, 21))`,
});

// Every row expired earlier today: on disk until midnight, untouched.
const EXPIRED_EARLIER_TODAY: Day = day({
  name: "expired earlier today",
  daysAgo: 21,
  time: `day + toIntervalSecond(intDiv(number * (${SECONDS_INTO_TODAY} - 1), ${ROWS}))`,
  createdAt: "time",
  retentionDate: "createdAt + INTERVAL 21 DAY",
});

/*
 * Rows ingested at noon that expire at noon today, and every tenth stamped
 * 30 seconds into the day by a clock 40 seconds ahead of the one that
 * ingested it the evening before - its retentionDate was 23:59:50 last
 * night. Rounded on retentionDate alone those few would expire at midnight
 * last night and cost a rewrite of the day; lined up with their partition's
 * day, the day expires as one.
 */
const STAMPED_AHEAD: Day = day({
  name: "stamped ahead of the ingest clock",
  daysAgo: 20,
  time: `if(number % ${LONG_LIVED_EVERY} = 0, day + INTERVAL 30 SECOND, day + INTERVAL 12 HOUR + toIntervalSecond(number))`,
  createdAt: `if(number % ${LONG_LIVED_EVERY} = 0, day - INTERVAL 10 SECOND, time + INTERVAL 2 SECOND)`,
  retentionDate: "createdAt + INTERVAL 20 DAY",
});

const AFTER_THE_MIGRATION: Array<Day> = [
  ONE_RETENTION_EXPIRED,
  TWO_RETENTIONS,
  EXPIRED_EARLIER_TODAY,
  STAMPED_AHEAD,
];

type ModelType = { new (): AnalyticsBaseModel };

// A local table built from the model's own columns and keys, with the TTL given.
async function createLocalTable(data: {
  client: ClickhouseClient;
  clickhouse: ClickhouseDatabase;
  modelType: ModelType;
  ttl: string;
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
    query: `CREATE TABLE ${database}.${data.tableName || getStorageTableName(model.tableName)} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) TTL ${data.ttl} SETTINGS ${model.tableSettings}, merge_with_ttl_timeout = 1`,
    query_params: columns.query_params,
  });
}

interface Part {
  name: string;
  rows: number;
  ttlMin: string;
  ttlMax: string;
}

interface TtlMerges {
  deletes: number;
  drops: number;
  // Rows written by the TTL delete merges.
  written: number;
}

integration("RoundTtlToDayOnMixedRetentionTables against ClickHouse", () => {
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

  // Parts per table and partition, as the migration found them.
  let partsBefore: Map<string, Array<Part>>;

  async function rows<T>(query: string): Promise<Array<T>> {
    const result: Awaited<ReturnType<ClickhouseClient["query"]>> =
      await client.query({ query: query, format: "JSONEachRow" });

    return (await result.json()) as Array<T>;
  }

  async function value(query: string): Promise<number> {
    const result: Array<{ v: string | number }> = await rows<{
      v: string | number;
    }>(`SELECT toUInt32(${query}) AS v`);

    return Number(result[0]?.v);
  }

  async function count(table: string, where: string = "1"): Promise<number> {
    return value(`(SELECT count() FROM ${database}.${table} WHERE ${where})`);
  }

  // The partition of a raw table that holds a day's rows.
  async function partitionOf(d: Day): Promise<string> {
    const result: Array<{ partition: string }> = await rows<{
      partition: string;
    }>(
      `SELECT toString(toYYYYMMDD(${TODAY} - toIntervalDay(${d.daysAgo}))) AS partition`,
    );

    return result[0]!.partition;
  }

  async function partsOf(table: string, d: Day): Promise<Array<Part>> {
    return rows<Part>(
      `SELECT name, toUInt32(rows) AS rows, toString(delete_ttl_info_min) AS ttlMin, toString(delete_ttl_info_max) AS ttlMax
      FROM system.parts
      WHERE database = '${database}' AND table = '${table}' AND active AND partition_id = '${await partitionOf(d)}'
      ORDER BY name`,
    );
  }

  async function ttlMergesOf(table: string, d: Day): Promise<TtlMerges> {
    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const result: Array<TtlMerges> = await rows<TtlMerges>(
      `SELECT toUInt32(countIf(merge_reason = 'TTLDeleteMerge')) AS deletes,
        toUInt32(countIf(merge_reason = 'TTLDropMerge')) AS drops,
        toUInt32(sumIf(rows, merge_reason = 'TTLDeleteMerge')) AS written
      FROM system.part_log
      WHERE database = '${database}' AND table = '${table}' AND event_type = 'MergeParts'
        AND partition_id = '${await partitionOf(d)}'`,
    );

    return result[0]!;
  }

  async function mutationCount(): Promise<number> {
    return value(
      `(SELECT count() FROM system.mutations WHERE database = '${database}')`,
    );
  }

  async function mutatedParts(): Promise<number> {
    await client.command({ query: "SYSTEM FLUSH LOGS" });

    return value(
      `(SELECT count() FROM system.part_log WHERE database = '${database}' AND event_type IN ('MutatePart', 'MutatePartStart'))`,
    );
  }

  // The TTL clause of a table, as ClickHouse formats it.
  async function ttlOf(table: string): Promise<string> {
    const result: Array<{ query: string }> = await rows<{ query: string }>(
      `SELECT create_table_query AS query FROM system.tables WHERE database = '${database}' AND name = '${table}'`,
    );

    return result[0]?.query.match(/ TTL (.*) SETTINGS /)?.[1] || "";
  }

  // Rows of a day, in a raw table.
  async function rowsOf(
    table: string,
    d: Day,
    where: string = "1",
  ): Promise<number> {
    return count(table, `primaryEntityId = '${d.entityId}' AND (${where})`);
  }

  // The minutes of a day the rollup holds.
  async function bucketsOf(d: Day, where: string = "1"): Promise<number> {
    return value(
      `(SELECT uniqExact(bucketTime) FROM ${database}.${ROLLUP_TABLE} WHERE primaryEntityId = '${d.entityId}' AND (${where}))`,
    );
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

      await sleep(POLL_INTERVAL_MS);
    }
  }

  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  }

  async function write(days: Array<Day>): Promise<void> {
    for (const d of days) {
      const dayStart: string = `(${TODAY} - toIntervalDay(${d.daysAgo}))`;

      // The minute rollup is fed from these by its materialized view.
      await client.command({
        query: `INSERT INTO ${METRIC_TABLE} (projectId, name, primaryEntityId, primaryEntityType, time, createdAt, value, retentionDate)
        SELECT '${projectId}', 'http.server.request.duration', '${d.entityId}', '${ServiceType.OpenTelemetry}',
          toDateTime64(${d.time}, 9) AS time, toDateTime(${d.createdAt}) AS createdAt, toFloat64(number),
          toDateTime(${d.retentionDate})
        FROM (SELECT number, ${dayStart} AS day FROM numbers(${ROWS}))`,
      });

      await client.command({
        query: `INSERT INTO ${LOG_TABLE} (projectId, primaryEntityId, primaryEntityType, time, createdAt, severityText, body, retentionDate)
        SELECT '${projectId}', '${d.entityId}', '${ServiceType.OpenTelemetry}',
          toDateTime64(${d.time}, 9) AS time, toDateTime(${d.createdAt}) AS createdAt,
          '${LogSeverity.Information}', concat('line ', toString(number)), toDateTime(${d.retentionDate})
        FROM (SELECT number, ${dayStart} AS day FROM numbers(${ROWS}))`,
      });
    }
  }

  beforeAll(
    async (): Promise<void> => {
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

      // Do not straddle midnight: wait for the next day to begin if it is near.
      const secondsIntoToday: number = await value(SECONDS_INTO_TODAY);

      if (secondsIntoToday < SECONDS_AFTER_MIDNIGHT) {
        await sleep((SECONDS_AFTER_MIDNIGHT - secondsIntoToday) * 1000);
      } else if (secondsIntoToday > 86400 - SUITE_BUDGET_SECONDS) {
        await sleep((86400 - secondsIntoToday + SECONDS_AFTER_MIDNIGHT) * 1000);
      }

      // As an install created before the migration has them.
      for (const modelType of [Metric, MetricItemAggMV1m, Log]) {
        await createLocalTable({ client, clickhouse, modelType, ttl: OLD_TTL });

        // As a fresh install creates them now.
        await createLocalTable({
          client,
          clickhouse,
          modelType,
          ttl: new modelType().ttlExpression,
          tableName: `${getStorageTableName(new modelType().tableName)}${FRESH_SUFFIX}`,
        });
      }

      // The rollup's own view, pointed at the local tables as on the cluster.
      for (const view of new MetricItemAggMV1m().materializedViews || []) {
        await client.command({
          query: applyClusterToMaterializedViewQuery(view.query).replace(
            / ON CLUSTER '[^']*'/,
            "",
          ),
        });
      }

      /*
       * Hold TTL merges until the migration has run, so the parts it finds
       * are the ones written under the old TTL, bounds and all.
       */
      for (const table of ALL_TABLES) {
        await client.command({
          query: `SYSTEM STOP TTL MERGES ${database}.${table}`,
        });
      }

      await write(BEFORE_THE_MIGRATION);

      partsBefore = new Map<string, Array<Part>>();
      for (const table of RAW_TABLES) {
        for (const d of BEFORE_THE_MIGRATION) {
          partsBefore.set(`${table} ${d.name}`, await partsOf(table, d));
        }
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
    },
    240000 + (SUITE_BUDGET_SECONDS + SECONDS_AFTER_MIDNIGHT) * 1000,
  );

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

  test("before it, the tables expire each row at its retentionDate, and each day written is one part", async () => {
    for (const table of ALL_TABLES) {
      expect(await ttlOf(table)).toBe(OLD_TTL_AS_SHOWN);
    }

    for (const table of RAW_TABLES) {
      for (const d of BEFORE_THE_MIGRATION) {
        const parts: Array<Part> = partsBefore.get(`${table} ${d.name}`)!;

        expect(parts).toHaveLength(1);
        expect(parts[0]!.rows).toBe(ROWS);
      }
    }
  });

  test("it gives every table the TTL a fresh install creates, and rewrites nothing doing it", async () => {
    await new RoundTtlToDayOnMixedRetentionTables().migrate();

    for (const table of ALL_TABLES) {
      const ttl: string = await ttlOf(table);

      expect(ttl).not.toBe(OLD_TTL_AS_SHOWN);
      expect(ttl).toBe(await ttlOf(`${table}${FRESH_SUFFIX}`));
    }

    // The raw tables line rows up with their partition's day; the rollup cannot.
    expect(await ttlOf(METRIC_TABLE)).toContain("createdAt");
    expect(await ttlOf(LOG_TABLE)).toContain("createdAt");
    expect(await ttlOf(ROLLUP_TABLE)).toMatch(/^toStartOfDay\(retentionDate\)/);

    // No MATERIALIZE TTL was queued, and no part was rewritten...
    expect(await mutationCount()).toBe(0);
    expect(await mutatedParts()).toBe(0);

    // ...so every part is the one it found, with the TTL bounds it had.
    for (const table of RAW_TABLES) {
      for (const d of BEFORE_THE_MIGRATION) {
        expect(await partsOf(table, d)).toEqual(
          partsBefore.get(`${table} ${d.name}`),
        );
      }
    }
  });

  test("a part written before it is rewritten once, at its next TTL merge, under the rounded TTL", async () => {
    for (const table of ALL_TABLES) {
      await client.command({
        query: `SYSTEM START TTL MERGES ${database}.${table}`,
      });
    }

    await waitFor(
      "the TTL merges of the days written before the migration",
      async (): Promise<boolean> => {
        for (const table of RAW_TABLES) {
          const expiring: Array<Part> = await partsOf(table, EXPIRING_TODAY);

          if (
            (await rowsOf(table, EXPIRED_YESTERDAY)) !== 0 ||
            expiring.length !== 1 ||
            expiring[0]!.name ===
              partsBefore.get(`${table} ${EXPIRING_TODAY.name}`)![0]!.name
          ) {
            return false;
          }
        }

        return (await bucketsOf(EXPIRED_YESTERDAY)) === 0;
      },
    );
    await sleep(SETTLE_MS);

    for (const table of RAW_TABLES) {
      // Expired since yesterday: gone, as a whole part.
      expect(await rowsOf(table, EXPIRED_YESTERDAY)).toBe(0);
      expect(await ttlMergesOf(table, EXPIRED_YESTERDAY)).toEqual({
        deletes: 0,
        drops: 1,
        written: 0,
      });

      /*
       * Its first TTL merge was due when its first row expired, under the
       * old bounds. It applied the rounded TTL: every row is still there,
       * including the ones the old TTL would have deleted by now.
       */
      expect(await rowsOf(table, EXPIRING_TODAY)).toBe(ROWS);
      expect(
        await rowsOf(table, EXPIRING_TODAY, "retentionDate < now()"),
      ).toBeGreaterThan(0);
      expect(await ttlMergesOf(table, EXPIRING_TODAY)).toEqual({
        deletes: 1,
        drops: 0,
        written: ROWS,
      });

      // And it stored the rounded bounds: nothing more is due before midnight.
      const [expiring] = await partsOf(table, EXPIRING_TODAY);
      expect(
        await value(
          `toDateTime('${expiring!.ttlMin}') = ${TOMORROW} AND toDateTime('${expiring!.ttlMax}') >= ${TOMORROW}`,
        ),
      ).toBe(1);

      // Not due yet: still the part it was, with its old bounds.
      expect(await partsOf(table, EXPIRING_TOMORROW)).toEqual(
        partsBefore.get(`${table} ${EXPIRING_TOMORROW.name}`),
      );
      expect(await ttlMergesOf(table, EXPIRING_TOMORROW)).toEqual({
        deletes: 0,
        drops: 0,
        written: 0,
      });
    }

    /*
     * The rollup's merges dropped yesterday's minutes and kept every one of
     * today's, those that expired already included.
     */
    expect(await bucketsOf(EXPIRING_TODAY)).toBe(
      await value(
        `(SELECT uniqExact(toStartOfMinute(time)) FROM ${database}.${METRIC_TABLE} WHERE primaryEntityId = '${EXPIRING_TODAY.entityId}')`,
      ),
    );
    expect(
      await bucketsOf(EXPIRING_TODAY, "retentionDate < now()"),
    ).toBeGreaterThan(0);
    expect(await bucketsOf(EXPIRING_TOMORROW)).toBeGreaterThan(0);

    expect(await mutationCount()).toBe(0);
  });

  test("a part written after it expires a day's rows of one retention at once", async () => {
    await write(AFTER_THE_MIGRATION);

    await waitFor(
      "the TTL merges of the days written after the migration",
      async (): Promise<boolean> => {
        for (const table of RAW_TABLES) {
          if (
            (await rowsOf(table, ONE_RETENTION_EXPIRED)) !== 0 ||
            (await rowsOf(table, TWO_RETENTIONS)) !== LONG_LIVED_ROWS
          ) {
            return false;
          }
        }

        return (
          (await bucketsOf(ONE_RETENTION_EXPIRED)) === 0 &&
          (await bucketsOf(TWO_RETENTIONS)) === LONG_LIVED_ROWS
        );
      },
    );
    await sleep(SETTLE_MS);

    for (const table of RAW_TABLES) {
      // One retention, expired: the part is dropped, not rewritten.
      expect(await ttlMergesOf(table, ONE_RETENTION_EXPIRED)).toEqual({
        deletes: 0,
        drops: 1,
        written: 0,
      });

      // Two: one merge, which wrote only the rows that outlive the first.
      expect(await ttlMergesOf(table, TWO_RETENTIONS)).toEqual({
        deletes: 1,
        drops: 0,
        written: LONG_LIVED_ROWS,
      });
      expect(await rowsOf(table, TWO_RETENTIONS, "retentionDate > now()")).toBe(
        LONG_LIVED_ROWS,
      );
      const [survivors] = await partsOf(table, TWO_RETENTIONS);
      expect(
        await value(
          `toDateTime('${survivors!.ttlMin}') = ${TODAY} + INTERVAL 11 DAY`,
        ),
      ).toBe(1);

      // Expired earlier today: on disk until midnight, and never merged.
      expect(await rowsOf(table, EXPIRED_EARLIER_TODAY)).toBe(ROWS);
      expect(await ttlMergesOf(table, EXPIRED_EARLIER_TODAY)).toEqual({
        deletes: 0,
        drops: 0,
        written: 0,
      });

      /*
       * Stamped ahead of the ingest clock: those rows expired last night by
       * their retentionDate, yet the day is one part due at midnight tonight.
       */
      expect(await rowsOf(table, STAMPED_AHEAD)).toBe(ROWS);
      expect(
        await rowsOf(table, STAMPED_AHEAD, `retentionDate < ${TODAY}`),
      ).toBe(ROWS / LONG_LIVED_EVERY);
      expect(await ttlMergesOf(table, STAMPED_AHEAD)).toEqual({
        deletes: 0,
        drops: 0,
        written: 0,
      });

      for (const d of [EXPIRED_EARLIER_TODAY, STAMPED_AHEAD]) {
        const parts: Array<Part> = await partsOf(table, d);

        expect(parts).toHaveLength(1);
        expect(
          await value(
            `toDateTime('${parts[0]!.ttlMin}') = ${TOMORROW} AND toDateTime('${parts[0]!.ttlMax}') = ${TOMORROW}`,
          ),
        ).toBe(1);
      }
    }

    // The rollup's minutes of the day that expired earlier today wait too.
    expect(await bucketsOf(EXPIRED_EARLIER_TODAY)).toBeGreaterThan(0);
    expect(await mutationCount()).toBe(0);
  });

  test("what the rounded TTL keeps past retentionDate, the app's read filter does not return", async () => {
    // The predicate AnalyticsDatabaseService.getRetentionReadFilter appends.
    for (const table of RAW_TABLES) {
      expect(
        await rowsOf(table, EXPIRED_EARLIER_TODAY, "retentionDate >= now()"),
      ).toBe(0);
      expect(
        await rowsOf(
          table,
          STAMPED_AHEAD,
          `retentionDate >= now() AND retentionDate < ${TODAY}`,
        ),
      ).toBe(0);

      // Rows nobody can read, still on disk until midnight: the price.
      expect(await count(table, "retentionDate < now()")).toBeGreaterThan(0);

      // And nothing a read can still return was deleted.
      expect(
        await rowsOf(table, EXPIRING_TOMORROW, "retentionDate >= now()"),
      ).toBe(ROWS);
      expect(
        await rowsOf(table, TWO_RETENTIONS, "retentionDate >= now()"),
      ).toBe(LONG_LIVED_ROWS);
    }

    expect(
      await bucketsOf(EXPIRED_EARLIER_TODAY, "retentionDate >= now()"),
    ).toBe(0);
  });

  test("running it again changes nothing", async () => {
    const ttls: Array<string> = [];
    const parts: Array<Array<Part>> = [];

    for (const table of ALL_TABLES) {
      ttls.push(await ttlOf(table));
    }
    for (const table of RAW_TABLES) {
      for (const d of [...BEFORE_THE_MIGRATION, ...AFTER_THE_MIGRATION]) {
        parts.push(await partsOf(table, d));
      }
    }

    await new RoundTtlToDayOnMixedRetentionTables().migrate();

    const ttlsAfter: Array<string> = [];
    const partsAfter: Array<Array<Part>> = [];

    for (const table of ALL_TABLES) {
      ttlsAfter.push(await ttlOf(table));
    }
    for (const table of RAW_TABLES) {
      for (const d of [...BEFORE_THE_MIGRATION, ...AFTER_THE_MIGRATION]) {
        partsAfter.push(await partsOf(table, d));
      }
    }

    expect(ttlsAfter).toEqual(ttls);
    expect(partsAfter).toEqual(parts);
    expect(await mutationCount()).toBe(0);
    expect(await mutatedParts()).toBe(0);
  });

  test("a table that does not exist is skipped, not a failure", async () => {
    await client.command({ query: `DROP TABLE ${database}.${LOG_TABLE}` });

    await expect(
      new RoundTtlToDayOnMixedRetentionTables().migrate(),
    ).resolves.toBeUndefined();

    expect(await ttlOf(METRIC_TABLE)).toBe(
      await ttlOf(`${METRIC_TABLE}${FRESH_SUFFIX}`),
    );
  });
});

describe("rounded TTL ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
