import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumProductAnalyticsSession, {
  PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL,
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
 * ReadWebAppVersionsInProductAnalyticsSessions against a real ClickHouse
 * (#6625).
 *
 * The unit suite pins the statement. This one runs it on a view an install
 * already has - RumProductAnalyticsSessionV1_mv as it was, filing a version
 * for a mobile app alone - over a RumSessionV1 that boot has given the new
 * appVersion column, and shows that:
 *
 *   - before it runs, a web session's version is filed as none;
 *   - the view's query is replaced in place, and the next header of a web
 *     session files the version its page gave the recorder, while a mobile
 *     app's version is filed from its browser version as before;
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
 *     npx jest Tests/Workers/DataMigrations/ReadWebAppVersionsInProductAnalyticsSessionsClickhouse.test.ts
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
import ReadWebAppVersionsInProductAnalyticsSessions from "../../../FeatureSet/Workers/DataMigrations/ReadWebAppVersionsInProductAnalyticsSessions";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `pa_app_version_view_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000f1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000f2");

const VIEW: string = "RumProductAnalyticsSessionV1_mv";
const SOURCE: string = "RumSessionV1Local";
const TARGET: string = "RumProductAnalyticsSessionV1Local";

/* The expression the view had before #6625: a mobile app's version alone. */
const OLD_APP_VERSION_SQL: string = `if(recorderKind = 'rn-view-tree' AND browserVersion != 'unknown', toString(browserVersion), '')`;

const acrossTheUpgrade: string = "a2".repeat(16);
const startedAfter: string = "b2".repeat(16);
const mobile: string = "c2".repeat(16);

const startedAt: Date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

function header(data: {
  sessionId: string;
  appVersion: string;
  finished: boolean;
  isMobile?: boolean | undefined;
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
    deviceType: data.isMobile ? "android" : "desktop",
    browserName: data.isMobile ? "Shop" : "Chrome",
    browserVersion: data.isMobile ? "5.0.0" : "141",
    appVersion: data.appVersion,
    osName: data.isMobile ? "Android 15" : "macOS",
    recorderKind: data.isMobile ? "rn-view-tree" : "dom",
    countryCode: "DE",
    entryUrl: "https://shop.example.com/",
    routes: ["https://shop.example.com/"],
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    endTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(startedAt.getTime() + (data.finished ? 90000 : 15000)),
    ),
    isFinalized: data.finished,
    durationMs: data.finished ? "90000" : "0",
    pageCount: 1,
    isPinnedCopy: false,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    ).substring(0, 10),
  };
}

integration(
  "ReadWebAppVersionsInProductAnalyticsSessions against ClickHouse",
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

    async function filedVersion(sessionId: string): Promise<string> {
      const found: Array<{ appVersion: string }> = await rows<{
        appVersion: string;
      }>(
        `SELECT max(appVersion) AS appVersion FROM ${database}.${TARGET} WHERE sessionId = {sessionId:String} GROUP BY sessionId`,
        { sessionId: sessionId },
      );

      return found[0]?.appVersion ?? "(none)";
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

      /* RumSessionV1 as boot leaves it: the appVersion column added. */
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

      // The view as an install has it: a mobile app's version alone.
      const model: string = new RumProductAnalyticsSession()
        .materializedViews[0]!.query;

      expect(model).toContain(PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL);

      await client.command({
        query: model
          .replace(
            PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL,
            OLD_APP_VERSION_SQL,
          )
          .replace(
            "TO RumProductAnalyticsSessionV1",
            `TO ${database}.${TARGET}`,
          )
          .replace("FROM RumSessionV1", `FROM ${database}.${SOURCE}`),
      });

      // The first header of a web session recorded across the upgrade.
      await insert(
        header({
          sessionId: acrossTheUpgrade,
          appVersion: "2.3.1",
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

    test("before it runs, a web session's version is filed as none", async () => {
      expect(await filedVersion(acrossTheUpgrade)).toBe("");
      expect(await viewQuery()).not.toContain("appVersion != ''");
    });

    test("it replaces the view's query in place, and the next header files the page's version", async () => {
      await new ReadWebAppVersionsInProductAnalyticsSessions().migrate();

      const query: string = await viewQuery();

      expect(query).toContain("appVersion != ''");
      // Still the same view, between the same tables.
      expect(query).toContain(`TO ${database}.${TARGET}`);
      expect(query).toContain(`FROM ${database}.${SOURCE}`);

      // The finalizer's header of the session recorded across the upgrade.
      await insert(
        header({
          sessionId: acrossTheUpgrade,
          appVersion: "2.3.1",
          finished: true,
        }),
      );

      expect(await filedVersion(acrossTheUpgrade)).toBe("2.3.1");
    });

    test("a web session that starts after has its version from its first header; a mobile app's is its browser version", async () => {
      await insert(
        header({
          sessionId: startedAfter,
          appVersion: "2.4.0",
          finished: false,
        }),
      );
      await insert(
        header({
          sessionId: mobile,
          appVersion: "",
          finished: true,
          isMobile: true,
        }),
      );

      expect(await filedVersion(startedAfter)).toBe("2.4.0");
      expect(await filedVersion(mobile)).toBe("5.0.0");
    });

    test("running it again changes nothing", async () => {
      const before: string = await viewQuery();
      const fingerprint: string = `SELECT toString(count()) || ':' || toString(sum(cityHash64(sessionId, appVersion))) AS f FROM ${database}.${TARGET}`;
      const rowsBefore: Array<{ f: string }> = await rows<{ f: string }>(
        fingerprint,
      );

      await new ReadWebAppVersionsInProductAnalyticsSessions().migrate();

      expect(await viewQuery()).toBe(before);
      expect(await rows<{ f: string }>(fingerprint)).toEqual(rowsBefore);
    });
  },
);

describe("ReadWebAppVersionsInProductAnalyticsSessions ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
