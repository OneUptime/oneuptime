import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumProductAnalyticsSession, {
  PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL,
} from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
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
 * ReadHashRoutesInProductAnalyticsEntryPages against a real ClickHouse
 * (#8194).
 *
 * The unit suite pins the statement. This one runs it on a view an install
 * already has - RumProductAnalyticsSessionV1_mv as it was, filing a session's
 * entry page as path(entryUrl) - between the local tables it reads and
 * writes, and shows that:
 *
 *   - the view's query is replaced in place: a hash-routed session whose
 *     first header the old query filed under "/" ends under its route when
 *     its finished header arrives, and one that starts after has its route
 *     from its first header;
 *   - every other column is filed as before;
 *   - running it again changes nothing.
 *
 * The CI server is a single node without a cluster, so ON CLUSTER is left
 * out of the statement and the tables are plain engines under the local
 * tables' names - the statement is otherwise the migration's own. The App
 * Test workflow provides the server; the guard at the bottom fails the run
 * there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/ReadHashRoutesInProductAnalyticsEntryPagesClickhouse.test.ts
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
import ReadHashRoutesInProductAnalyticsEntryPages from "../../../FeatureSet/Workers/DataMigrations/ReadHashRoutesInProductAnalyticsEntryPages";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `pa_entry_page_view_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000f1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000f2");

const VIEW: string = "RumProductAnalyticsSessionV1_mv";
const SOURCE: string = "RumSessionV1Local";
const TARGET: string = "RumProductAnalyticsSessionV1Local";

const hashRouted: string = "a1".repeat(16);
const plain: string = "b1".repeat(16);
const startedAfter: string = "c1".repeat(16);

const startedAt: Date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

function header(data: {
  sessionId: string;
  entryUrl: string;
  routes: Array<string>;
  finished: boolean;
}): JSONObject {
  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    rumApplicationId: applicationId.toString(),
    primaryEntityId: applicationId.toString(),
    primaryEntityType: "RealUserMonitor",
    startTime: OneUptimeDate.toClickhouseDateTime64(startedAt),
    clientReportedStartTime: OneUptimeDate.toClickhouseDateTime64(startedAt),
    sessionId: data.sessionId,
    version: String(Date.now()),
    visitorId: data.sessionId,
    identifiedUserKey: "",
    identifiedUserLabel: "",
    deviceType: "desktop",
    browserName: "Chrome",
    browserVersion: "141",
    osName: "macOS",
    recorderKind: "dom",
    countryCode: "DE",
    entryUrl: data.entryUrl,
    routes: data.routes,
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    endTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(startedAt.getTime() + (data.finished ? 90000 : 15000)),
    ),
    isFinalized: data.finished,
    durationMs: data.finished ? "90000" : "0",
    pageCount: data.routes.length,
    errorCount: data.finished ? 2 : 0,
    isPinnedCopy: false,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    ).substring(0, 10),
  };
}

integration(
  "ReadHashRoutesInProductAnalyticsEntryPages against ClickHouse",
  () => {
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
      });

      return (await result.json()) as Array<T>;
    }

    interface Folded {
      entryPage: string;
      pages: Array<string>;
      durationMs: string;
      errorCount: number;
      isFinalized: boolean;
    }

    async function folded(sessionId: string): Promise<Folded> {
      const found: Array<Folded> = await rows<Folded>(
        `SELECT max(entryPage) AS entryPage, arraySort(groupUniqArrayArray(pages)) AS pages, toString(max(durationMs)) AS durationMs, max(errorCount) AS errorCount, max(isFinalized) AS isFinalized FROM ${database}.${TARGET} WHERE sessionId = {sessionId:String} GROUP BY sessionId`,
        { sessionId: sessionId },
      );

      return found[0]!;
    }

    async function insert(row: JSONObject): Promise<void> {
      await client.insert({
        table: `${database}.${SOURCE}`,
        values: [row],
        format: "JSONEachRow",
      });
    }

    async function viewQuery(): Promise<string> {
      const found: Array<{ query: string }> = await rows<{ query: string }>(
        `SELECT create_table_query AS query FROM system.tables WHERE database = {database:String} AND name = {name:String}`,
        { database: database, name: VIEW },
      );

      return found[0]?.query || "";
    }

    async function createTable(
      modelType: { new (): AnalyticsBaseModel },
      name: string,
    ): Promise<void> {
      const model: AnalyticsBaseModel = new modelType();
      const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
        modelType: modelType,
        database: clickhouse,
      }).toColumnsCreateStatement(model.tableColumns);

      const engine: string =
        model.tableEngine === AnalyticsTableEngine.ReplacingMergeTree
          ? "ReplacingMergeTree(version)"
          : model.tableEngine === AnalyticsTableEngine.AggregatingMergeTree
            ? "AggregatingMergeTree"
            : "MergeTree";

      await client.command({
        query: `CREATE TABLE ${database}.${name} (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
        query_params: columns.query_params,
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

      await createTable(
        RumSession as unknown as { new (): AnalyticsBaseModel },
        SOURCE,
      );
      await createTable(
        RumProductAnalyticsSession as unknown as {
          new (): AnalyticsBaseModel;
        },
        TARGET,
      );

      // The view as an install has it: the entry page as path(entryUrl).
      const model: string = new RumProductAnalyticsSession()
        .materializedViews[0]!.query;

      expect(model).toContain(PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL);

      await client.command({
        query: model
          .replace(PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL, "path(entryUrl)")
          .replace(
            "TO RumProductAnalyticsSessionV1",
            `TO ${database}.${TARGET}`,
          )
          .replace("FROM RumSessionV1", `FROM ${database}.${SOURCE}`),
      });

      // Headers written before the upgrade.
      await insert(
        header({
          sessionId: hashRouted,
          entryUrl: "https://shop.example.com/#/orders/42",
          routes: ["https://shop.example.com/#/orders/42"],
          finished: false,
        }),
      );
      await insert(
        header({
          sessionId: plain,
          entryUrl: "https://shop.example.com/pricing",
          routes: ["https://shop.example.com/pricing"],
          finished: false,
        }),
      );
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

    test("before it runs, a hash-routed session is filed under /", async () => {
      expect((await folded(hashRouted)).entryPage).toBe("/");
      expect((await folded(plain)).entryPage).toBe("/pricing");
      expect(await viewQuery()).toContain("path(entryUrl)");
    });

    test("it replaces the view's query in place, and the next header files the route", async () => {
      await new ReadHashRoutesInProductAnalyticsEntryPages().migrate();

      const query: string = await viewQuery();

      expect(query).toContain("fragment(entryUrl)");
      // Still the same view, between the same tables.
      expect(query).toContain(`TO ${database}.${TARGET}`);
      expect(query).toContain(`FROM ${database}.${SOURCE}`);

      // The finalizer's header of the session recorded across the upgrade.
      await insert(
        header({
          sessionId: hashRouted,
          entryUrl: "https://shop.example.com/#/orders/42",
          routes: [
            "https://shop.example.com/#/orders/42",
            "https://shop.example.com/#/cart",
          ],
          finished: true,
        }),
      );

      expect(await folded(hashRouted)).toEqual({
        entryPage: "/orders/42",
        pages: [
          "https://shop.example.com/#/cart",
          "https://shop.example.com/#/orders/42",
        ],
        durationMs: "90000",
        errorCount: 2,
        isFinalized: true,
      });
    });

    test("a session that starts after has its route from its first header, and a path is filed as before", async () => {
      await insert(
        header({
          sessionId: startedAfter,
          entryUrl: "https://shop.example.com/app/#!/cart",
          routes: ["https://shop.example.com/app/#!/cart"],
          finished: false,
        }),
      );
      await insert(
        header({
          sessionId: plain,
          entryUrl: "https://shop.example.com/pricing",
          routes: ["https://shop.example.com/pricing"],
          finished: true,
        }),
      );

      expect((await folded(startedAfter)).entryPage).toBe("/app/cart");
      expect((await folded(plain)).entryPage).toBe("/pricing");
      expect((await folded(plain)).isFinalized).toBe(true);
    });

    test("running it again changes nothing", async () => {
      const before: string = await viewQuery();
      const rowsBefore: Array<{ f: string }> = await rows<{ f: string }>(
        `SELECT toString(count()) || ':' || toString(sum(cityHash64(sessionId, entryPage))) AS f FROM ${database}.${TARGET}`,
      );

      await new ReadHashRoutesInProductAnalyticsEntryPages().migrate();

      expect(await viewQuery()).toBe(before);
      expect(
        await rows<{ f: string }>(
          `SELECT toString(count()) || ':' || toString(sum(cityHash64(sessionId, entryPage))) AS f FROM ${database}.${TARGET}`,
        ),
      ).toEqual(rowsBefore);
    });
  },
);

describe("ReadHashRoutesInProductAnalyticsEntryPages ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
