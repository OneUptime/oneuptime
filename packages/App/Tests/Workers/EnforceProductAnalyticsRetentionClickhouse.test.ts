import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumProductAnalyticsEventService from "Common/Server/Services/RumProductAnalyticsEventService";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
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
 * Rum:EnforceProductAnalyticsRetention against a real ClickHouse (#6626).
 *
 * The unit suite pins the statements. This one runs a day's run over the
 * three product analytics tables, holding months of rows of four
 * applications - one that keeps 3 months, one that keeps the default 13,
 * one that keeps 25, and one deleted since, whose rows no setting names -
 * and shows that, once the queued deletes land:
 *
 *   - each application keeps exactly the months its choice keeps, in every
 *     table, and a deleted application's rows go at 13 months;
 *   - another application's rows are never touched by a shorter choice;
 *   - a second run queues nothing: every probe finds nothing past anyone's
 *     retention.
 *
 * The CI server is a single node without a cluster, so ON CLUSTER is left
 * out and the tables are plain engines under the local tables' names, with
 * a view under each Distributed table's name for the probes. The App Test
 * workflow provides the server; the guard at the bottom fails the run there
 * if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/EnforceProductAnalyticsRetentionClickhouse.test.ts
 * ------------------------------------------------------------------
 */

jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

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

import {
  ProductAnalyticsRetentionResult,
  enforceProductAnalyticsRetention,
} from "../../FeatureSet/Workers/Jobs/Rum/EnforceProductAnalyticsRetention";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `pa_retention_job_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000d1");
const keepsThree: ObjectID = new ObjectID("6600000000000000000000d3");
const keepsDefault: ObjectID = new ObjectID("6600000000000000000000d4");
const keepsTwentyFive: ObjectID = new ObjectID("6600000000000000000000d5");
const deletedSince: ObjectID = new ObjectID("6600000000000000000000d6");

const APPLICATIONS: Array<ObjectID> = [
  keepsThree,
  keepsDefault,
  keepsTwentyFive,
  deletedSince,
];

/* Months before the running one each application has rows in. */
const MONTHS_AGO: Array<number> = [0, 2, 3, 5, 6, 12, 13, 20, 24];

const now: Date = new Date();

function monthStart(monthsAgo: number): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1),
  );
}

function within(monthsAgo: number): Date {
  return new Date(monthStart(monthsAgo).getTime() + 3 * 24 * 60 * 60 * 1000);
}

function sessionIdOf(application: ObjectID, monthsAgo: number): string {
  return `${application.toString().slice(-4)}${String(monthsAgo).padStart(4, "0")}`.padEnd(
    32,
    "0",
  );
}

integration("Rum:EnforceProductAnalyticsRetention against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const originals: Array<Record<string, unknown>> = [];

  const services: Array<{
    database: unknown;
    databaseClient: unknown;
    migrationDatabase: unknown;
    migrationDatabaseClient: unknown;
  }> = [
    RumProductAnalyticsSessionService,
    RumProductAnalyticsUserService,
    RumProductAnalyticsEventService,
  ] as never;

  async function rows<T>(query: string): Promise<Array<T>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: query,
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<T>;
  }

  /* The months, as months ago, an application still has rows of in a table. */
  async function keptMonths(
    table: string,
    timeColumn: string,
    application: ObjectID,
  ): Promise<Array<number>> {
    const found: Array<{ m: string }> = await rows<{ m: string }>(
      `SELECT toString(dateDiff('month', toStartOfMonth(${timeColumn}), toStartOfMonth(now('UTC')))) AS m FROM ${database}.${table} WHERE rumApplicationId = '${application.toString()}' GROUP BY m ORDER BY toInt32(m)`,
    );

    return found.map((row: { m: string }): number => {
      return Number(row.m);
    });
  }

  async function waitForMutations(): Promise<void> {
    const deadline: number = Date.now() + 90000;

    while (Date.now() < deadline) {
      const pending: Array<{ c: string }> = await rows<{ c: string }>(
        `SELECT toString(count()) AS c FROM system.mutations WHERE database = '${database}' AND NOT is_done`,
      );

      if (Number(pending[0]?.c || 0) === 0) {
        return;
      }

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 500);
      });
    }

    throw new Error("Timed out waiting for the deletes to land");
  }

  async function createTable(modelType: {
    new (): AnalyticsBaseModel;
  }): Promise<void> {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    }).toColumnsCreateStatement(model.tableColumns);

    const engine: string =
      model.tableEngine === AnalyticsTableEngine.AggregatingMergeTree
        ? "AggregatingMergeTree"
        : "MergeTree";

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName}Local (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });

    // The Distributed table's name, which the probes read.
    await client.command({
      query: `CREATE VIEW ${database}.${model.tableName} AS SELECT * FROM ${database}.${model.tableName}Local`,
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

    for (const service of services) {
      originals.push({
        database: service.database,
        databaseClient: service.databaseClient,
        migrationDatabase: service.migrationDatabase,
        migrationDatabaseClient: service.migrationDatabaseClient,
      });

      service.database = clickhouse;
      service.databaseClient = client;
      service.migrationDatabase = clickhouse;
      service.migrationDatabaseClient = client;
    }

    for (const modelType of [
      RumProductAnalyticsSession,
      RumProductAnalyticsUser,
      RumProductAnalyticsEvent,
    ]) {
      await createTable(modelType as unknown as { new (): AnalyticsBaseModel });
    }

    for (const application of APPLICATIONS) {
      for (const monthsAgo of MONTHS_AGO) {
        const at: string = OneUptimeDate.toClickhouseDateTime64(
          within(monthsAgo),
        );
        const sessionId: string = sessionIdOf(application, monthsAgo);

        await client.command({
          query: `INSERT INTO ${database}.RumProductAnalyticsSessionV1Local (projectId, rumApplicationId, startTime, sessionId, visitorId) VALUES ('${projectId.toString()}', '${application.toString()}', '${at}', '${sessionId}', '${sessionId}')`,
        });
        await client.command({
          query: `INSERT INTO ${database}.RumProductAnalyticsUserV1Local (projectId, rumApplicationId, personKey, month, firstSeen, lastSeen) VALUES ('${projectId.toString()}', '${application.toString()}', 'v:${sessionId}', toStartOfMonth(toDateTime64('${at}', 9)), '${at}', '${at}')`,
        });
        await client.command({
          query: `INSERT INTO ${database}.RumProductAnalyticsEventV1Local (projectId, rumApplicationId, kind, name, time, sessionId) VALUES ('${projectId.toString()}', '${application.toString()}', 'session', '', '${at}', '${sessionId}')`,
        });
      }
    }

    /* What the applications chose; the deleted one has no row at all. */
    jest
      .spyOn(RumApplicationService, "findAllBy")
      .mockImplementation((async (): Promise<Array<RumApplication>> => {
        return [
          [keepsThree, 3],
          [keepsTwentyFive, 25],
        ].map(([id, months]: Array<ObjectID | number>): RumApplication => {
          const application: RumApplication = new RumApplication();
          application.id = id as ObjectID;
          application.productAnalyticsRetentionInMonths = months as number;
          return application;
        });
      }) as never);
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();

    originals.forEach((original: Record<string, unknown>, index: number) => {
      Object.assign(services[index]!, original);
    });

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("each application keeps exactly the months its choice keeps, in every table", async () => {
    const result: ProductAnalyticsRetentionResult =
      await enforceProductAnalyticsRetention({
        databaseName: database,
        now: now,
      });

    expect(result.failures).toEqual([]);
    /* The 3-month group and the default's, on each of the three tables. */
    expect(result.deletesSubmitted).toBe(6);

    await waitForMutations();

    for (const [table, timeColumn] of [
      ["RumProductAnalyticsSessionV1Local", "startTime"],
      ["RumProductAnalyticsUserV1Local", "month"],
      ["RumProductAnalyticsEventV1Local", "time"],
    ] as Array<[string, string]>) {
      /* 3 months: the running one and the two before it. */
      expect(await keptMonths(table, timeColumn, keepsThree)).toEqual([0, 2]);
      /* 13 months: twelve full ones and the running one. */
      expect(await keptMonths(table, timeColumn, keepsDefault)).toEqual([
        0, 2, 3, 5, 6, 12,
      ]);
      /* 25 months: every month here, older than the default's included. */
      expect(await keptMonths(table, timeColumn, keepsTwentyFive)).toEqual(
        MONTHS_AGO,
      );
      /* No setting names it: the default's 13 months. */
      expect(await keptMonths(table, timeColumn, deletedSince)).toEqual([
        0, 2, 3, 5, 6, 12,
      ]);
    }
  });

  test("a second run queues nothing", async () => {
    const result: ProductAnalyticsRetentionResult =
      await enforceProductAnalyticsRetention({
        databaseName: database,
        now: now,
      });

    expect(result).toEqual({ deletesSubmitted: 0, failures: [] });
  });
});

describe("Rum:EnforceProductAnalyticsRetention ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
