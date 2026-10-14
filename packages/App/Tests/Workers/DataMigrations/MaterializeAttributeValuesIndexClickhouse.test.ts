import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { appendAttributeFilters } from "Common/Server/Utils/AnalyticsDatabase/AttributeFilterStatement";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "Common/Types/ObjectID";
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
 * MaterializeAttributeValuesIndex against a real ClickHouse.
 *
 * The unit suite pins the statements. This one shows what they do to the
 * log and span tables an install already has - built from the models' own
 * columns, keys and skip indexes, minus idx_attribute_values, with three
 * days of rows written before the upgrade, each its own part:
 *
 *   - the index definition is added, exactly as a fresh table declares it;
 *   - its build is queued in the background and the migration returns;
 *   - once the build is done, a search for a rare value skips the granules
 *     of those old parts that do not hold it - which is what it is for;
 *   - every row is still there, unchanged;
 *   - running it again reads nothing: no part's attributes are read twice;
 *   - on tables created with the index (a fresh install) it reads nothing
 *     either, and a table that does not exist is skipped.
 *
 * "Reads nothing" is measured in bytes. A MATERIALIZE INDEX still touches
 * every part - system.part_log logs a MutatePart with the part's rows - but
 * for a part that already has the index ClickHouse 26.7 reads a few bytes a
 * row instead of the attributes (measured on 20 million log lines: 16.8 MiB
 * and 22 ms for a part whose first build read 8.45 GiB in 10 s).
 *
 * The CI server is a single node without a cluster, so ON CLUSTER is left
 * out of the statements and the tables are plain MergeTree - the local
 * table names, the definition and the MATERIALIZE INDEX are the
 * migration's own. The tables use 256-row granules so three small days span
 * thirty of them.
 *
 * The App Test workflow provides the ClickHouse server; the guard at the
 * bottom fails the run there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/MaterializeAttributeValuesIndexClickhouse.test.ts
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
import { getStorageTableName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import MaterializeAttributeValuesIndex from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndex";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `materialize_attribute_values_test_${process.pid}_${Date.now()}`;

const LOG_TABLE: string = getStorageTableName(new Log().tableName);
const SPAN_TABLE: string = getStorageTableName(new Span().tableName);

const GRANULE_ROWS: number = 256;
const GRANULES_A_DAY: number = 10;
const ROWS_A_DAY: number = GRANULE_ROWS * GRANULES_A_DAY;
const DAYS: Array<number> = [2, 1, 0];

const RARE: string = "/orders/export";
// One row a day carries the rare value.
const RARE_ROW: number = 7;

const POLL_INTERVAL_MS: number = 250;

// EXPLAIN's count of the granules an index left of those before it.
const GRANULES_LINE: RegExp = /Granules: (\d+)\/(\d+)/;
const WAIT_LIMIT_MS: number = 120000;

const projectId: string = ObjectID.generate().toString();

type ModelType = { new (): AnalyticsBaseModel };

interface Mutated {
  parts: number;
  rows: number;
  bytes: number;
}

/*
 * A build reads the attributes: more than this per row (the fixture's maps
 * are ~250 bytes). A part that already has the index costs a few bytes a
 * row, well under it.
 */
const BYTES_A_ROW_OF_A_BUILD: number = 100;

integration("MaterializeAttributeValuesIndex against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Record<string, unknown> | undefined;

  async function rows<T>(
    query: string,
    queryParams: Record<string, unknown> = {},
  ): Promise<Array<T>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: query,
      query_params: queryParams,
      format: "JSONEachRow",
      clickhouse_settings: { use_query_condition_cache: 0 },
    });

    return (await result.json()) as Array<T>;
  }

  async function value(query: string): Promise<number> {
    const result: Array<{ v: string | number }> = await rows<{
      v: string | number;
    }>(`SELECT toUInt64(${query}) AS v`);

    return Number(result[0]?.v);
  }

  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
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

  // A local table from the model's own columns, keys and skip indexes.
  async function createLocalTable(modelType: ModelType): Promise<void> {
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
      query: `CREATE TABLE ${database}.${getStorageTableName(model.tableName)} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS index_granularity = ${GRANULE_ROWS}, index_granularity_bytes = 0`,
      query_params: columns.query_params,
    });
  }

  // Days of rows, one INSERT - so one part - per day and table.
  async function writeDays(): Promise<void> {
    for (const daysAgo of DAYS) {
      const dayStart: string = `(toStartOfDay(now()) - toIntervalDay(${daysAgo}))`;
      const attributes: string = `map('http.route', if(number % ${ROWS_A_DAY} = ${RARE_ROW}, '${RARE}', concat('/route-', toString(number % 50))), 'http.method', if(number % 10 < 7, 'GET', 'POST'), 'user_agent.original', concat('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_', toString(number % 50), ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'), 'request.id', toString(generateUUIDv4(number)))`;

      await client.command({
        query: `INSERT INTO ${database}.${LOG_TABLE} (projectId, primaryEntityId, primaryEntityType, time, timeUnixNano, severityText, severityNumber, attributes, attributeKeys, body, retentionDate, _id, createdAt)
        SELECT '${projectId}', '${projectId}', 'Service',
          toDateTime64(${dayStart} + toIntervalSecond(number), 9) AS time,
          toUInt64(toUnixTimestamp(time)) * 1000000000,
          'Information', 9, ${attributes} AS attrs, arraySort(mapKeys(attrs)),
          concat('line ', toString(${daysAgo}), '-', toString(number)),
          now() + INTERVAL 30 DAY, generateUUIDv4(number), now()
        FROM numbers(${ROWS_A_DAY})`,
      });

      await client.command({
        query: `INSERT INTO ${database}.${SPAN_TABLE} (projectId, primaryEntityId, primaryEntityType, startTime, endTime, startTimeUnixNano, endTimeUnixNano, durationUnixNano, traceId, spanId, name, attributes, attributeKeys, retentionDate, _id, createdAt)
        SELECT '${projectId}', '${projectId}', 'Service',
          toDateTime64(${dayStart} + toIntervalSecond(number), 9) AS startTime, startTime,
          toUInt64(toUnixTimestamp(startTime)) * 1000000000, toUInt64(toUnixTimestamp(startTime)) * 1000000000, 0,
          concat('trace-', toString(${daysAgo}), '-', toString(number)), concat('span-', toString(number)),
          concat('span ', toString(${daysAgo}), '-', toString(number)),
          ${attributes} AS attrs, arraySort(mapKeys(attrs)),
          now() + INTERVAL 30 DAY, generateUUIDv4(number), now()
        FROM numbers(${ROWS_A_DAY})`,
      });
    }
  }

  async function dropAndCreate(withIndex: boolean): Promise<void> {
    for (const modelType of [Log, Span]) {
      const table: string = getStorageTableName(new modelType().tableName);

      await client.command({
        query: `DROP TABLE IF EXISTS ${database}.${table} SYNC`,
      });
      await createLocalTable(modelType);

      if (!withIndex) {
        // As an install created before the index existed has it.
        await client.command({
          query: `ALTER TABLE ${database}.${table} DROP INDEX idx_attribute_values`,
        });
      }
    }

    await writeDays();
  }

  async function valueIndex(
    table: string,
  ): Promise<Array<{ type_full: string; expr: string }>> {
    return rows<{ type_full: string; expr: string }>(
      "SELECT type_full, expr FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String} AND name = 'idx_attribute_values'",
      { database: database, table: table },
    );
  }

  async function partsOf(table: string): Promise<number> {
    return value(
      `(SELECT count() FROM system.parts WHERE database = '${database}' AND table = '${table}' AND active)`,
    );
  }

  // The server's clock, to tell this run's mutations from earlier ones.
  async function serverNow(): Promise<string> {
    const result: Array<{ now: string }> = await rows<{ now: string }>(
      "SELECT toString(now64(6)) AS now",
    );

    return result[0]!.now;
  }

  // The parts mutated since `since`, the rows they hold and the bytes read.
  async function mutatedSince(table: string, since: string): Promise<Mutated> {
    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const result: Array<{
      parts: string | number;
      rows: string | number;
      bytes: string | number;
    }> = await rows<{
      parts: string | number;
      rows: string | number;
      bytes: string | number;
    }>(
      `SELECT count() AS parts, sum(read_rows) AS rows, sum(read_bytes) AS bytes FROM system.part_log WHERE database = {database:String} AND table = {table:String} AND event_type = 'MutatePart' AND event_time_microseconds >= toDateTime64({since:String}, 6)`,
      { database: database, table: table, since: since },
    );

    return {
      parts: Number(result[0]?.parts || 0),
      rows: Number(result[0]?.rows || 0),
      bytes: Number(result[0]?.bytes || 0),
    };
  }

  function bytesARow(mutation: Mutated): number {
    return mutation.rows === 0 ? 0 : mutation.bytes / mutation.rows;
  }

  async function mutationsDone(): Promise<void> {
    await waitFor("the index build to finish", async (): Promise<boolean> => {
      return (
        (await value(
          `(SELECT count() FROM system.mutations WHERE database = '${database}' AND NOT is_done)`,
        )) === 0
      );
    });
  }

  // The search a chart runs for one attribute value, on one table.
  function chartStatement(table: string): Statement {
    const statement: Statement = SQL`SELECT count() AS rows FROM ${database}.${table} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: new ObjectID(projectId),
    }}`;

    appendAttributeFilters({
      statement: statement,
      attributes: { "http.route": RARE },
      validateKey: (): void => {},
    });

    return statement;
  }

  // What EXPLAIN says idx_attribute_values leaves of the granules before it.
  async function valueIndexGranules(
    table: string,
  ): Promise<{ selected: number; of: number } | undefined> {
    const statement: Statement = chartStatement(table);
    const lines: Array<string> = (
      await rows<{ explain: string }>(
        `EXPLAIN indexes = 1 ${statement.query}`,
        statement.query_params,
      )
    ).map((row: { explain: string }): string => {
      return row.explain;
    });

    const at: number = lines.findIndex((line: string): boolean => {
      return line.includes("Name: idx_attribute_values");
    });

    if (at < 0) {
      return undefined;
    }

    for (const line of lines.slice(at + 1, at + 6)) {
      const match: RegExpExecArray | null = GRANULES_LINE.exec(line);

      if (match) {
        return { selected: Number(match[1]), of: Number(match[2]) };
      }
    }

    return undefined;
  }

  async function rareRows(table: string): Promise<number> {
    const statement: Statement = chartStatement(table);
    const result: Array<{ rows: string | number }> = await rows<{
      rows: string | number;
    }>(statement.query, statement.query_params);

    return Number(result[0]?.rows);
  }

  // A fingerprint of every row's attributes, to show the rows are untouched.
  async function fingerprint(table: string): Promise<string> {
    const result: Array<{ f: string }> = await rows<{ f: string }>(
      `SELECT toString(count()) || ':' || toString(sum(cityHash64(toString(attributes)))) AS f FROM ${database}.${table}`,
    );

    return result[0]!.f;
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

  describe("on the tables an install had before the index", () => {
    const fingerprints: Map<string, string> = new Map();
    const partsBefore: Map<string, number> = new Map();
    let firstRun: string;

    beforeAll(async (): Promise<void> => {
      await dropAndCreate(false);

      for (const table of [LOG_TABLE, SPAN_TABLE]) {
        fingerprints.set(table, await fingerprint(table));
        partsBefore.set(table, await partsOf(table));
      }
    });

    test("before it runs, the tables have no value index and a rare value is read everywhere", async () => {
      for (const table of [LOG_TABLE, SPAN_TABLE]) {
        expect(await valueIndex(table)).toEqual([]);
        expect(await valueIndexGranules(table)).toBeUndefined();
        expect(partsBefore.get(table)).toBe(DAYS.length);
      }
    });

    test("it adds the definition a fresh table has, and queues the build", async () => {
      firstRun = await serverNow();

      await new MaterializeAttributeValuesIndex().migrate();

      for (const table of [LOG_TABLE, SPAN_TABLE]) {
        expect(await valueIndex(table)).toEqual([
          { type_full: "bloom_filter(0.01)", expr: "mapValues(attributes)" },
        ]);
      }

      const queued: Array<{ table: string; command: string }> = await rows<{
        table: string;
        command: string;
      }>(
        "SELECT table, command FROM system.mutations WHERE database = {database:String} AND command LIKE '%MATERIALIZE%' ORDER BY table",
        { database: database },
      );

      expect(
        queued.map((mutation: { table: string; command: string }): string => {
          return `${mutation.table}: ${mutation.command}`;
        }),
      ).toEqual([
        `${LOG_TABLE}: (MATERIALIZE INDEX idx_attribute_values)`,
        `${SPAN_TABLE}: (MATERIALIZE INDEX idx_attribute_values)`,
      ]);
    });

    test("the build reads each old part once, and then a rare value skips the granules that do not hold it", async () => {
      await mutationsDone();

      for (const table of [LOG_TABLE, SPAN_TABLE]) {
        const build: Mutated = await mutatedSince(table, firstRun);

        expect(build.parts).toBe(DAYS.length);
        expect(build.rows).toBe(DAYS.length * ROWS_A_DAY);
        // It read every row's attributes to build the index.
        expect(bytesARow(build)).toBeGreaterThan(BYTES_A_ROW_OF_A_BUILD);

        const granules: { selected: number; of: number } | undefined =
          await valueIndexGranules(table);

        expect(granules).toBeDefined();
        expect(granules!.of).toBe(DAYS.length * GRANULES_A_DAY);
        // One row a day holds it: a granule a day, plus the odd false positive.
        expect(granules!.selected).toBeGreaterThanOrEqual(DAYS.length);
        expect(granules!.selected).toBeLessThanOrEqual(DAYS.length + 3);
      }
    });

    test("every row is still there, unchanged", async () => {
      for (const table of [LOG_TABLE, SPAN_TABLE]) {
        expect(await fingerprint(table)).toBe(fingerprints.get(table));
        expect(await rareRows(table)).toBe(DAYS.length);
      }
    });

    test("running it again reads nothing", async () => {
      const secondRun: string = await serverNow();

      await new MaterializeAttributeValuesIndex().migrate();
      await mutationsDone();

      for (const table of [LOG_TABLE, SPAN_TABLE]) {
        const again: Mutated = await mutatedSince(table, secondRun);

        expect(bytesARow(again)).toBeLessThan(BYTES_A_ROW_OF_A_BUILD / 10);
        expect(bytesARow(await mutatedSince(table, firstRun))).toBeGreaterThan(
          BYTES_A_ROW_OF_A_BUILD,
        );
        expect(await valueIndex(table)).toHaveLength(1);
        expect(await fingerprint(table)).toBe(fingerprints.get(table));
        expect((await valueIndexGranules(table))?.selected).toBeLessThanOrEqual(
          DAYS.length + 3,
        );
      }
    });
  });

  describe("on tables created with the index", () => {
    beforeAll(async (): Promise<void> => {
      await dropAndCreate(true);
    });

    test("a fresh install's tables prune from the first part on, and the migration reads nothing", async () => {
      for (const table of [LOG_TABLE, SPAN_TABLE]) {
        const granules: { selected: number; of: number } | undefined =
          await valueIndexGranules(table);

        expect(granules).toBeDefined();
        expect(granules!.selected).toBeLessThanOrEqual(DAYS.length + 3);
      }

      const run: string = await serverNow();

      await new MaterializeAttributeValuesIndex().migrate();
      await mutationsDone();

      for (const table of [LOG_TABLE, SPAN_TABLE]) {
        expect(bytesARow(await mutatedSince(table, run))).toBeLessThan(
          BYTES_A_ROW_OF_A_BUILD / 10,
        );
        expect(await valueIndex(table)).toHaveLength(1);
      }
    });
  });

  describe("when a table does not exist", () => {
    beforeAll(async (): Promise<void> => {
      await dropAndCreate(false);
      await client.command({
        query: `DROP TABLE IF EXISTS ${database}.${SPAN_TABLE} SYNC`,
      });
    });

    test("it builds the index on the table there is and skips the other", async () => {
      await new MaterializeAttributeValuesIndex().migrate();
      await mutationsDone();

      expect(await valueIndex(LOG_TABLE)).toHaveLength(1);
      expect(
        (await valueIndexGranules(LOG_TABLE))?.selected,
      ).toBeLessThanOrEqual(DAYS.length + 3);
      expect(
        await value(
          `(SELECT count() FROM system.tables WHERE database = '${database}' AND name = '${SPAN_TABLE}')`,
        ),
      ).toBe(0);
    });
  });
});

describe("MaterializeAttributeValuesIndex ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
