import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  ClickHouseSettings,
  ClickhouseExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import QueryTimeoutException from "Common/Types/Exception/QueryTimeoutException";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The attribute value lookup (issue #4708) against a real ClickHouse
 * server.
 *
 * The value picker behind `@key:` used to read every row of the last day
 * that held the key - the whole attributes map of each - and sort them all:
 * 40 to 57 CPU-seconds per lookup on a project writing 30 million log lines a
 * day, whatever the key, a key no row has included. The unit suites pin the
 * SQL a lookup sends now (TelemetryAttributeValueSuggestions.test.ts); this
 * one shows what ClickHouse does with it, through the Log model's own table
 * behind a Distributed table, as production reads it:
 *
 *   1. The answers are right: for every kind of key - on every row with few
 *      values, with thousands of values, on one row in two hundred, in one
 *      burst, holding empty and overlong values - the values offered are
 *      exactly those an independent reading of the fixture finds (all of
 *      them while there are no more than 100), from this project, this
 *      scope and this window only, narrowed by the search text as ILIKE
 *      reads it.
 *   2. The reads are bounded: a key no row has reads no rows; a key in one
 *      burst reads that burst's granules; a key on every row stops long
 *      before the window's end - where the lookup as it was read every row
 *      in the window each time.
 *   3. The rows-read budget stops a read part way and ClickHouse still
 *      answers with a whole document: the values it found, never an empty or
 *      cut-off body (the reason the budget may keep 'break' -
 *      ExplorerReadsStopWithErrorGuard).
 *   4. A lookup that runs out of time fails as a QueryTimeoutException - never
 *      as "no values" - and is not sent again for a minute.
 *   5. The older analyzer (enable_analyzer = 0), still set on some servers,
 *      answers the same.
 *
 * The local table keeps the model's columns, skip indexes and sort key with
 * 256-row granules (index_granularity = 256, index_granularity_bytes = 0),
 * so a fixture of 131,072 rows spans 512 granules.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/AttributeValueSuggestionsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
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

import LogService from "Common/Server/Services/LogService";
import TelemetryAttributeServiceInstance, {
  TelemetryAttributeService,
} from "Common/Server/Services/TelemetryAttributeService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `attribute_value_suggestions_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const STEP: number = 5 * MINUTE;

// A past hour on whole five minutes, so the lookup reads exactly it.
const WINDOW_START: Date = new Date(
  Math.floor(Date.now() / STEP) * STEP - 2 * 60 * MINUTE,
);
const WINDOW_END: Date = new Date(WINDOW_START.getTime() + 60 * MINUTE);

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000004708",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000004708",
);
const SERVICES: Array<ObjectID> = [
  new ObjectID("c1c1c1c1-0000-4000-8000-000000004708"),
  new ObjectID("c2c2c2c2-0000-4000-8000-000000004708"),
  new ObjectID("c3c3c3c3-0000-4000-8000-000000004708"),
  new ObjectID("c4c4c4c4-0000-4000-8000-000000004708"),
];

const GRANULE_ROWS: number = 256;
const ROWS: number = 512 * GRANULE_ROWS;
const OLD_ROWS: number = 2048;
const OTHER_PROJECT_ROWS: number = 4096;

// payment.provider is on these rows only: one burst, three granules or so.
const BURST_START: number = 70000;
const BURST_END: number = 70600;

const PROVIDERS: Array<string> = ["stripe", "adyen", "paypal", "braintree"];

/*
 * --- The fixture, and an independent reading of it ---
 *
 * Row n of the project, in the window, carries the attributes below. The
 * same rules are written twice: once as the SQL that generates the rows,
 * once in TypeScript to say what a lookup should find.
 */
function attributesOfRow(n: number): Record<string, string> {
  const attributes: Record<string, string> = {
    env: n % 10 < 8 ? "production" : n % 10 === 8 ? "staging" : "development",
    "user.id": `user-${n % 5000}`,
    team: n % 4 === 0 ? "alpha" : n % 4 === 1 ? "beta" : "gamma",
    "http.route":
      n % 7 === 0 ? "/100%_off" : n % 7 === 1 ? "/100xyoff" : "/cart",
    tenant: n % 2 === 0 ? "Tenant-A" : "tenant-a",
  };

  if (n % 200 === 7) {
    attributes["retry.count"] = String(1 + (Math.floor(n / 200) % 5));
  }

  if (n >= BURST_START && n < BURST_END) {
    attributes["payment.provider"] = PROVIDERS[n % 4]!;
  }

  if (n % 100 === 13) {
    attributes["exception.message"] =
      Math.floor(n / 100) % 2 === 0
        ? `Timeout calling service ${Math.floor(n / 100) % 50}`
        : "x".repeat(1500);
  }

  if (n % 50 < 3) {
    attributes["blank"] = ["", "   ", "set"][n % 50]!;
  }

  return attributes;
}

const FIXTURE_ROW_SQL: string = `
  mapConcat(
    map(
      'env', multiIf(number % 10 < 8, 'production', number % 10 = 8, 'staging', 'development'),
      'user.id', concat('user-', toString(number % 5000)),
      'team', multiIf(number % 4 = 0, 'alpha', number % 4 = 1, 'beta', 'gamma'),
      'http.route', multiIf(number % 7 = 0, '/100%_off', number % 7 = 1, '/100xyoff', '/cart'),
      'tenant', if(number % 2 = 0, 'Tenant-A', 'tenant-a')
    ),
    if(number % 200 = 7, map('retry.count', toString(1 + intDiv(number, 200) % 5)), map()),
    if(number >= ${BURST_START} AND number < ${BURST_END}, map('payment.provider', ['stripe', 'adyen', 'paypal', 'braintree'][1 + number % 4]), map()),
    if(number % 100 = 13, map('exception.message', if(intDiv(number, 100) % 2 = 0, concat('Timeout calling service ', toString(intDiv(number, 100) % 50)), repeat('x', 1500))), map()),
    if(number % 50 < 3, map('blank', ['', '   ', 'set'][1 + number % 50]), map())
  )`;

// What a lookup of `key` should offer from the project's rows in the window.
function expectedValues(
  key: string,
  options: {
    services?: Array<number> | undefined;
    search?: string | undefined;
  } = {},
): Array<string> {
  const values: Set<string> = new Set<string>();

  for (let n: number = 0; n < ROWS; n++) {
    if (options.services && !options.services.includes(n % 4)) {
      continue;
    }

    const value: string | undefined = attributesOfRow(n)[key];

    if (value === undefined || value === "" || value.length > 1000) {
      continue;
    }

    if (
      options.search &&
      !value.toLowerCase().includes(options.search.toLowerCase())
    ) {
      continue;
    }

    if (value.trim()) {
      values.add(value.trim());
    }
  }

  return Array.from(values).sort((a: string, b: string): number => {
    return a.localeCompare(b);
  });
}

// What the lookup sent before #4708, for comparison: every row with the key.
function lookupAsItWas(key: string): Statement {
  const statement: Statement = new Statement();

  statement.append(
    `SELECT DISTINCT attributes['${key}'] AS attributeValue FROM ${database}.LogItemV3 WHERE projectId = '${PROJECT_ID.toString()}' AND time >= '${OneUptimeDate.toClickhouseDateTime(WINDOW_START)}' AND time <= '${OneUptimeDate.toClickhouseDateTime(WINDOW_END)}' AND mapContains(attributes, '${key}') ORDER BY attributeValue ASC LIMIT 100 SETTINGS max_execution_time = 45, timeout_overflow_mode = 'throw'`,
  );

  return statement;
}

type ExecuteQuery = (
  statement: Statement | string,
  options?: ClickhouseExecuteOptions,
) => Promise<unknown>;

// A statement's SQL rewritten by a test, with the statement's own parameters.
class RewrittenStatement extends Statement {
  public constructor(
    private readonly source: Statement,
    private readonly rewrite: (query: string) => string,
  ) {
    super();
  }

  public override get query(): string {
    return this.rewrite(this.source.query);
  }

  public override get query_params(): Record<string, unknown> {
    return this.source.query_params;
  }
}

integration("attribute value lookups against ClickHouse", () => {
  let options: ClickHouseClientConfigOptions;
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Record<string, unknown> | undefined;
  let measureSettings: ClickHouseSettings = {};
  let executeQuery: ExecuteQuery;

  // A lookup as the logs explorer asks for it, on the fixture's window.
  function lookUp(
    attributeKey: string,
    extra: Partial<
      Parameters<
        typeof TelemetryAttributeServiceInstance.fetchAttributeValues
      >[0]
    > = {},
  ): Promise<Array<string>> {
    return TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId: PROJECT_ID,
      telemetryType: TelemetryType.Log,
      attributeKey: attributeKey,
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      ...extra,
    });
  }

  interface Measured<T> {
    answer: T;
    readRows: number;
    statements: Array<string>;
  }

  /*
   * Runs `work` with every read LogService sends tagged, then reads the rows
   * ClickHouse says those reads read (system.query_log, the initial query:
   * its read_rows counts the shards' reads too).
   */
  async function measured<T>(work: () => Promise<T>): Promise<Measured<T>> {
    const comment: string = `attribute-value-suggestions-${ObjectID.generate().toString()}`;
    const statements: Array<string> = [];

    const spy: { mockRestore: () => void } = jest
      .spyOn(LogService, "executeQuery")
      .mockImplementation(
        (
          statement: Statement | string,
          runOptions?: ClickhouseExecuteOptions,
        ): Promise<never> => {
          statements.push(
            typeof statement === "string" ? statement : statement.query,
          );

          return executeQuery(statement, {
            ...(runOptions || {}),
            clickhouseSettings: {
              ...(runOptions?.clickhouseSettings || {}),
              ...measureSettings,
              log_comment: comment,
            },
          }) as Promise<never>;
        },
      ) as unknown as { mockRestore: () => void };

    let answer: T;

    try {
      answer = await work();
    } finally {
      spy.mockRestore();
    }

    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const result: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT sum(read_rows) AS rows, count() AS reads FROM system.query_log WHERE log_comment = {comment:String} AND type = 'QueryFinish' AND is_initial_query",
      query_params: { comment: comment },
      format: "JSONEachRow",
    });
    const [row] = (await result.json()) as Array<{
      rows: string | number;
      reads: string | number;
    }>;

    expect(Number(row!.reads)).toBe(statements.length);

    return { answer: answer, readRows: Number(row!.rows), statements };
  }

  // Rows a statement reads, run as it is.
  async function rowsReadBy(statement: Statement): Promise<number> {
    const comment: string = `attribute-value-suggestions-${ObjectID.generate().toString()}`;

    const result: { json: () => Promise<unknown> } = await client.query({
      query: statement.query,
      query_params: statement.query_params,
      format: "JSON",
      clickhouse_settings: { ...measureSettings, log_comment: comment },
    });
    await result.json();

    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const logged: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT read_rows AS rows FROM system.query_log WHERE log_comment = {comment:String} AND type = 'QueryFinish' AND is_initial_query",
      query_params: { comment: comment },
      format: "JSONEachRow",
    });
    const [row] = (await logged.json()) as Array<{ rows: string | number }>;

    return Number(row!.rows);
  }

  // The statement the service builds for a lookup, unsent.
  function lookupStatement(attributeKey: string): Statement {
    return (
      TelemetryAttributeService as unknown as {
        buildAttributeValuesStatement: (data: unknown) => Statement;
      }
    ).buildAttributeValuesStatement({
      projectId: PROJECT_ID,
      source: {
        tableName: "LogItemV3",
        attributesColumn: "attributes",
        attributeKeysColumn: "attributeKeys",
        timeColumn: "time",
      },
      attributeKey: attributeKey,
      window: { startTime: WINDOW_START, endTime: WINDOW_END },
    });
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    options = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 240000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    // Measured without the query condition cache, so a repeat is not cheaper for an earlier read.
    const conditionCache: { json: () => Promise<unknown> } = await client.query(
      {
        query:
          "SELECT count() AS present FROM system.settings WHERE name = 'use_query_condition_cache'",
        format: "JSONEachRow",
      },
    );
    const [cache] = (await conditionCache.json()) as Array<{
      present: string | number;
    }>;
    measureSettings = (
      Number(cache!.present) > 0 ? { use_query_condition_cache: 0 } : {}
    ) as ClickHouseSettings;

    // The model's own table, and the Distributed table in front of it.
    const model: AnalyticsBaseModel = new Log();
    const generator: StatementGenerator<AnalyticsBaseModel> =
      new StatementGenerator<AnalyticsBaseModel>({
        modelType: Log,
        database: clickhouse,
      });
    const columns: Statement = generator.toColumnsCreateStatement(
      model.tableColumns,
    );

    await client.command({
      query: `CREATE TABLE ${database}.LogItemV3Local (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS index_granularity = ${GRANULE_ROWS}, index_granularity_bytes = 0`,
      query_params: columns.query_params,
    });

    await client.command({
      query: `CREATE TABLE ${database}.LogItemV3 AS ${database}.LogItemV3Local ENGINE = Distributed('default', ${database}, LogItemV3Local, ${model.shardingKey || "rand()"})`,
    });

    original = {
      database: LogService.database,
      databaseClient: LogService.databaseClient,
      ingestDatabase: LogService.ingestDatabase,
      ingestDatabaseClient: LogService.ingestDatabaseClient,
    };

    LogService.database = clickhouse;
    LogService.databaseClient = client;
    LogService.ingestDatabase = clickhouse;
    LogService.ingestDatabaseClient = client;

    executeQuery = LogService.executeQuery.bind(LogService) as ExecuteQuery;

    const retention: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    );

    const insert: (data: {
      project: ObjectID;
      rows: number;
      firstRowAt: Date;
      spreadOverMs: number;
      attributes: string;
    }) => Promise<void> = async (data: {
      project: ObjectID;
      rows: number;
      firstRowAt: Date;
      spreadOverMs: number;
      attributes: string;
    }): Promise<void> => {
      await client.command({
        query: `INSERT INTO ${database}.LogItemV3Local (projectId, primaryEntityId, primaryEntityType, time, timeUnixNano, severityText, severityNumber, attributes, attributeKeys, entityKeys, body, retentionDate, _id, createdAt)
          SELECT
            '${data.project.toString()}',
            [${SERVICES.map((service: ObjectID): string => {
              return `'${service.toString()}'`;
            }).join(", ")}][1 + number % 4],
            'Service',
            toDateTime64(fromUnixTimestamp64Milli(toInt64(${data.firstRowAt.getTime()} + intDiv(number * ${data.spreadOverMs}, ${data.rows}))), 9) AS rowTime,
            toUInt64(toUnixTimestamp64Nano(rowTime)),
            'Information',
            9,
            ${data.attributes} AS rowAttributes,
            arraySort(mapKeys(rowAttributes)),
            [],
            concat('row-', toString(number)),
            '${retention}',
            concat('${data.project.toString().substring(0, 8)}-', toString(number)),
            now()
          FROM numbers(${data.rows})`,
      });
    };

    // The project's rows, fifty minutes of them inside the window.
    await insert({
      project: PROJECT_ID,
      rows: ROWS,
      firstRowAt: new Date(WINDOW_START.getTime() + MINUTE),
      spreadOverMs: 50 * MINUTE,
      attributes: FIXTURE_ROW_SQL,
    });

    // Older rows of the same project: inside the last day, outside the window.
    await insert({
      project: PROJECT_ID,
      rows: OLD_ROWS,
      firstRowAt: new Date(WINDOW_START.getTime() - 3 * 60 * MINUTE),
      spreadOverMs: 30 * MINUTE,
      attributes: "map('env', 'decommissioned', 'team', 'retired')",
    });

    // Another project's rows, in the same window.
    await insert({
      project: OTHER_PROJECT_ID,
      rows: OTHER_PROJECT_ROWS,
      firstRowAt: new Date(WINDOW_START.getTime() + MINUTE),
      spreadOverMs: 50 * MINUTE,
      attributes:
        "map('env', 'project-b-only', 'team', 'project-b-team', 'payment.provider', 'project-b-provider')",
    });

    await client.command({
      query: `OPTIMIZE TABLE ${database}.LogItemV3Local FINAL`,
    });
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(LogService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  beforeEach(() => {
    TelemetryAttributeService.clearValueSuggestionCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the table the Log model creates has the index over attribute keys the lookup reads through", async () => {
    const result: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT type_full, expr FROM system.data_skipping_indices WHERE database = {database:String} AND table = 'LogItemV3Local' AND name = 'idx_attribute_keys'",
      query_params: { database: database },
      format: "JSONEachRow",
    });

    expect(await result.json()).toEqual([
      { type_full: "bloom_filter(0.01)", expr: "attributeKeys" },
    ]);
  });

  describe("the values offered", () => {
    test.each([
      ["a key on every row, with three values", "env"],
      ["a key on one row in two hundred, with five values", "retry.count"],
      ["a key in one burst of rows", "payment.provider"],
      ["a key whose values hold LIKE metacharacters", "http.route"],
      ["a key whose values differ only in case", "tenant"],
    ])(
      "%s: every value the window holds",
      async (_label: string, key: string) => {
        const expected: Array<string> = expectedValues(key);

        expect(expected.length).toBeGreaterThan(1);
        expect(expected.length).toBeLessThanOrEqual(100);
        expect(await lookUp(key)).toEqual(expected);
      },
    );

    test("a key with thousands of values: 100 of them, all real, in order", async () => {
      const everyValue: Set<string> = new Set(expectedValues("user.id"));
      const offered: Array<string> = await lookUp("user.id");

      expect(everyValue.size).toBe(5000);
      expect(offered).toHaveLength(100);
      expect(new Set(offered).size).toBe(100);
      for (const value of offered) {
        expect(everyValue.has(value)).toBe(true);
      }
      expect(offered).toEqual(
        [...offered].sort((a: string, b: string): number => {
          return a.localeCompare(b);
        }),
      );
    });

    test("empty values and values over 1,000 characters are never offered", async () => {
      expect(await lookUp("blank")).toEqual(["set"]);

      const messages: Array<string> = await lookUp("exception.message");

      expect(messages).toEqual(expectedValues("exception.message"));
      expect(messages).toHaveLength(25);
      for (const message of messages) {
        expect(message.length).toBeLessThanOrEqual(1000);
      }
    });

    test("a key no row has: no values", async () => {
      expect(await lookUp("does.not.exist")).toEqual([]);
    });

    test("never another project's values", async () => {
      expect(await lookUp("env")).not.toContain("project-b-only");
      expect(await lookUp("payment.provider")).toEqual(
        PROVIDERS.slice().sort(),
      );

      expect(await lookUp("env", { projectId: OTHER_PROJECT_ID })).toEqual([
        "project-b-only",
      ]);
    });

    test("a caller limited to some services gets those services' values only", async () => {
      expect(
        await lookUp("team", { serviceFilter: { serviceIds: [SERVICES[0]!] } }),
      ).toEqual(expectedValues("team", { services: [0] }));
      expect(
        await lookUp("team", { serviceFilter: { serviceIds: [SERVICES[0]!] } }),
      ).toEqual(["alpha"]);

      expect(
        await lookUp("team", {
          serviceFilter: { excludedServiceIds: [SERVICES[0]!] },
        }),
      ).toEqual(["beta", "gamma"]);
    });

    test("only the window's values: older rows are offered for a window that holds them", async () => {
      expect(await lookUp("env")).not.toContain("decommissioned");

      expect(
        await lookUp("env", {
          startTime: new Date(WINDOW_START.getTime() - 4 * 60 * MINUTE),
          endTime: new Date(WINDOW_START.getTime() - 2 * 60 * MINUTE),
        }),
      ).toEqual(["decommissioned"]);

      // With no window, the last day: both.
      const lastDay: Array<string> = await lookUp("team", {
        startTime: undefined,
        endTime: undefined,
      });

      expect(lastDay).toEqual(
        expect.arrayContaining(["alpha", "beta", "gamma", "retired"]),
      );
    });

    test("the search text narrows as ILIKE reads it, its metacharacters literal", async () => {
      expect(await lookUp("http.route", { searchText: "100%_" })).toEqual([
        "/100%_off",
      ]);
      expect(await lookUp("http.route", { searchText: "100" })).toEqual(
        expectedValues("http.route", { search: "100" }),
      );
      const tenants: Array<string> = await lookUp("tenant", {
        searchText: "TENANT",
      });

      expect(tenants).toEqual(expectedValues("tenant", { search: "TENANT" }));
      expect(tenants).toHaveLength(2);
    });
  });

  describe("what a lookup reads", () => {
    test("a key no row has reads no rows - the lookup as it was read the whole window", async () => {
      const lookup: Measured<Array<string>> = await measured(() => {
        return lookUp("does.not.exist");
      });

      expect(lookup.answer).toEqual([]);
      expect(lookup.readRows).toBe(0);

      expect(
        await rowsReadBy(lookupAsItWas("does.not.exist")),
      ).toBeGreaterThanOrEqual(ROWS);
    });

    test("a key in one burst reads the granules that hold it", async () => {
      const lookup: Measured<Array<string>> = await measured(() => {
        return lookUp("payment.provider");
      });

      expect(lookup.answer).toEqual(PROVIDERS.slice().sort());
      // 600 rows in 3 or 4 granules, plus the bloom filter's false positives.
      expect(lookup.readRows).toBeGreaterThanOrEqual(BURST_END - BURST_START);
      expect(lookup.readRows).toBeLessThan(ROWS / 20);

      expect(
        await rowsReadBy(lookupAsItWas("payment.provider")),
      ).toBeGreaterThanOrEqual(ROWS);
    });

    test.each([
      ["with three values", "env"],
      ["with thousands of values", "user.id"],
    ])(
      "a key on every row %s stops long before the window's end",
      async (_label: string, key: string) => {
        const lookup: Measured<Array<string>> = await measured(() => {
          return lookUp(key);
        });

        expect(lookup.answer.length).toBeGreaterThan(0);
        expect(lookup.readRows).toBeLessThan(ROWS / 2);

        expect(await rowsReadBy(lookupAsItWas(key))).toBeGreaterThanOrEqual(
          ROWS,
        );
      },
    );

    test("one lookup is one read, and asking again within five minutes reads nothing", async () => {
      const first: Measured<Array<string>> = await measured(() => {
        return lookUp("env");
      });
      const again: Measured<Array<string>> = await measured(() => {
        return lookUp("env");
      });

      expect(first.statements).toHaveLength(1);
      expect(again.statements).toHaveLength(0);
      expect(again.readRows).toBe(0);
      expect(again.answer).toEqual(first.answer);
    });
  });

  describe("the rows-read budget", () => {
    /*
     * A key on few rows with few values never fills the row or value limits,
     * so on a big project the budget is what ends the read. The fixture is
     * smaller than the budget; the same statement with a budget of 20,000
     * shows what ClickHouse does at it.
     */
    function withBudget(statement: Statement, rows: number): Statement {
      expect(statement.query).toContain("max_rows_to_read = 1000000");
      expect(statement.query).toContain("read_overflow_mode = 'break'");

      return new RewrittenStatement(statement, (query: string): string => {
        return query
          .split("max_rows_to_read = 1000000")
          .join(`max_rows_to_read = ${rows}`);
      });
    }

    async function answerOf(statement: Statement): Promise<{
      values: Array<string>;
      rowsRead: number;
    }> {
      // Read the way the service reads: the whole body, checked by the guard.
      const result: { json: () => Promise<unknown> } = (await executeQuery(
        statement,
        { clickhouseSettings: measureSettings },
      )) as { json: () => Promise<unknown> };
      const document: {
        data: Array<{ attributeValue: string }>;
        statistics: { rows_read: number };
      } = (await result.json()) as {
        data: Array<{ attributeValue: string }>;
        statistics: { rows_read: number };
      };

      return {
        values: document.data.map((row: { attributeValue: string }): string => {
          return row.attributeValue;
        }),
        rowsRead: Number(document.statistics.rows_read),
      };
    }

    test("a rare key reads every row of the window without it", async () => {
      const unbudgeted: { values: Array<string>; rowsRead: number } =
        await answerOf(lookupStatement("retry.count"));

      expect(unbudgeted.values.sort()).toEqual(["1", "2", "3", "4", "5"]);
      expect(unbudgeted.rowsRead).toBeGreaterThan(ROWS / 2);
    });

    test("stopped at the budget, the answer is a whole document with the values it found", async () => {
      const budgeted: { values: Array<string>; rowsRead: number } =
        await answerOf(withBudget(lookupStatement("retry.count"), 20000));

      // Stopped: about the budget, plus the blocks four threads had in hand.
      expect(budgeted.rowsRead).toBeGreaterThanOrEqual(20000);
      expect(budgeted.rowsRead).toBeLessThan(ROWS / 2);

      // Whole: it parsed, and it holds real values of the key.
      expect(budgeted.values.length).toBeGreaterThan(0);
      for (const value of budgeted.values) {
        expect(["1", "2", "3", "4", "5"]).toContain(value);
      }
    });
  });

  describe("a lookup that runs out of time", () => {
    /*
     * The service's own statement, made slow: the inner read sleeps on each
     * row and has one second. PREWHERE is off so the key filter cannot drop
     * rows before they reach the sleep.
     */
    function slowed(statement: Statement): Statement {
      expect(statement.query).toContain("max_execution_time = 10");

      return new RewrittenStatement(statement, (query: string): string => {
        return query
          .split("max_execution_time = 10")
          .join("max_execution_time = 1, optimize_move_to_prewhere = 0")
          .split("WHERE projectId")
          .join("WHERE sleepEachRow(0.0002) = 0 AND projectId");
      });
    }

    test("fails as a time-out, never as no values, and is not sent again for a minute", async () => {
      const sent: Array<string> = [];

      jest
        .spyOn(LogService, "executeQuery")
        .mockImplementation(
          (
            statement: Statement | string,
            runOptions?: ClickhouseExecuteOptions,
          ): Promise<never> => {
            const slow: Statement = slowed(statement as Statement);
            sent.push(slow.query);
            return executeQuery(slow, runOptions) as Promise<never>;
          },
        );

      let stopped: unknown = undefined;

      try {
        await lookUp("retry.count");
      } catch (error) {
        stopped = error;
      }

      expect(stopped).toBeInstanceOf(QueryTimeoutException);
      expect((stopped as QueryTimeoutException).code).toBe(504);
      expect((stopped as QueryTimeoutException).message).toBe(
        "This query took longer than 1 second and was stopped before it finished. Try a shorter time range or more specific filters.",
      );
      expect(sent).toHaveLength(1);

      // Asked again: the same failure, without a read.
      await expect(lookUp("retry.count")).rejects.toBeInstanceOf(
        QueryTimeoutException,
      );
      expect(sent).toHaveLength(1);
    });
  });

  describe("the older analyzer", () => {
    test("answers the same", async () => {
      const found: { json: () => Promise<unknown> } = await client.query({
        query:
          "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
        format: "JSONEachRow",
      });
      const [setting] = (await found.json()) as Array<{ name: string }>;

      if (!setting) {
        return;
      }

      const keys: Array<string> = [
        "env",
        "retry.count",
        "payment.provider",
        "http.route",
        "does.not.exist",
      ];

      const withAnalyzer: Array<Array<string>> = [];

      for (const key of keys) {
        withAnalyzer.push(await lookUp(key));
      }

      TelemetryAttributeService.clearValueSuggestionCache();

      jest
        .spyOn(LogService, "executeQuery")
        .mockImplementation(
          (
            statement: Statement | string,
            runOptions?: ClickhouseExecuteOptions,
          ): Promise<never> => {
            return executeQuery(statement, {
              ...(runOptions || {}),
              clickhouseSettings: {
                ...(runOptions?.clickhouseSettings || {}),
                [setting.name]: 0,
              } as ClickHouseSettings,
            }) as Promise<never>;
          },
        );

      const withOlderAnalyzer: Array<Array<string>> = [];

      for (const key of keys) {
        withOlderAnalyzer.push(await lookUp(key));
      }

      expect(withOlderAnalyzer).toEqual(withAnalyzer);
      expect(withAnalyzer[0]).toEqual(["development", "production", "staging"]);
    });
  });
});

describe("attribute value suggestions ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
