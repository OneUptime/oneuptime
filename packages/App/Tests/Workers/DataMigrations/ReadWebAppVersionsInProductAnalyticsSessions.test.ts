import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * #6625: a web app had no app version in Product Analytics. The browser
 * recorder now takes an appVersion option, the replay ingest keeps it in
 * RumSessionV1.appVersion, and RumProductAnalyticsSessionV1_mv reads it
 * before a mobile app's browser version. Boot's schema-sync adds the
 * column but does not see a change to an expression inside the view, so
 * this migration puts the model's query on the view an install already has.
 *
 * What is pinned:
 *
 *   - one statement: ALTER TABLE ... MODIFY QUERY on the view, ON CLUSTER,
 *     with the model's own SELECT in the cluster form boot creates it in -
 *     atomic, so no session header goes by unfiled;
 *   - the query files the web page's own version
 *     (PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL reads appVersion first);
 *   - a view that does not exist is left to boot, a statement that fails
 *     fails the migration, and a second run writes the same query;
 *   - its rollback does nothing, it runs on the clustered schema, and it is
 *     registered once, after the hash route migration (which set the query
 *     before it) and before the last slot.
 *
 * ReadWebAppVersionsInProductAnalyticsSessionsClickhouse.test.ts runs it
 * against a real ClickHouse server.
 */

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock(
  "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil",
  () => {
    return {
      __esModule: true,
      default: { tableExists: jest.fn() },
    };
  },
);

import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";
import RumProductAnalyticsSession, {
  PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL,
} from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import { applyClusterToMaterializedViewQuery } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import { getProductAnalyticsSessionViewModifyQueryStatement } from "../../../FeatureSet/Workers/DataMigrations/ProductAnalyticsSessionViewQuery";
import ReadHashRoutesInProductAnalyticsEntryPages from "../../../FeatureSet/Workers/DataMigrations/ReadHashRoutesInProductAnalyticsEntryPages";
import ReadWebAppVersionsInProductAnalyticsSessions from "../../../FeatureSet/Workers/DataMigrations/ReadWebAppVersionsInProductAnalyticsSessions";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const MIGRATION_NAME: string = "ReadWebAppVersionsInProductAnalyticsSessions";
const VIEW: string = "RumProductAnalyticsSessionV1_mv";

let savedClusterName: string | undefined;
let viewExists: boolean;
let failing: Error | null;
let infoSpy: MockSpy;

function executedStatements(): Array<string> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  viewExists = true;
  failing = null;

  metricService.execute.mockReset();
  metricService.execute.mockImplementation(async (): Promise<void> => {
    if (failing) {
      throw failing;
    }
  });

  migrationUtil.tableExists.mockReset();
  migrationUtil.tableExists.mockImplementation(async (): Promise<boolean> => {
    return viewExists;
  });

  infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }

  infoSpy.mockRestore();
});

function registeredMigrations(): Array<string> {
  const index: string = fs
    .readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "FeatureSet",
        "Workers",
        "DataMigrations",
        "Index.ts",
      ),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  return Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("ReadWebAppVersionsInProductAnalyticsSessions", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: ReadWebAppVersionsInProductAnalyticsSessions =
        new ReadWebAppVersionsInProductAnalyticsSessions();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      expect(
        new ReadWebAppVersionsInProductAnalyticsSessions().runsInClusterMode(),
      ).toBe(true);
    });

    test("is registered once, after the hash route migration and before the last slot", () => {
      const registered: Array<string> = registeredMigrations();

      expect(
        registered.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        registered.indexOf("ReadHashRoutesInProductAnalyticsEntryPages"),
      );
      expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
        registered.indexOf("AddAuditLogMcpClientColumns"),
      );
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });
  });

  describe("the statement", () => {
    test("sets the model's query on the view, in place, on every node", () => {
      const statement: string =
        getProductAnalyticsSessionViewModifyQueryStatement();

      expect(
        statement.startsWith(
          `ALTER TABLE ${VIEW} ON CLUSTER 'oneuptime' MODIFY QUERY SELECT`,
        ),
      ).toBe(true);
      expect(statement).toContain("FROM RumSessionV1Local");
      expect(statement).not.toContain("CREATE");
    });

    test("is the view boot creates, from SELECT on", () => {
      const view: { query: string } = new RumProductAnalyticsSession()
        .materializedViews[0]!;
      const created: string = applyClusterToMaterializedViewQuery(view.query);

      expect(
        getProductAnalyticsSessionViewModifyQueryStatement().replace(
          /^ALTER TABLE \S+ ON CLUSTER '[^']+' MODIFY QUERY /,
          "",
        ),
      ).toBe(created.slice(created.search(/\bSELECT\b/)));
    });

    test("files the web page's own app version before a mobile app's browser version", () => {
      const statement: string =
        getProductAnalyticsSessionViewModifyQueryStatement();

      expect(statement).toContain(
        `maxSimpleState(${PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL}) AS appVersion`,
      );
      expect(PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL).toMatch(
        /^multiIf\(appVersion != '', toString\(appVersion\), recorderKind = 'rn-view-tree'/,
      );
    });

    test("is the same query the hash route migration sets: one view, one model", () => {
      expect(
        ReadHashRoutesInProductAnalyticsEntryPages.getModifyQueryStatement(),
      ).toBe(getProductAnalyticsSessionViewModifyQueryStatement());
    });
  });

  describe("running it", () => {
    test("sets the query once, through the migration connection", async () => {
      await new ReadWebAppVersionsInProductAnalyticsSessions().migrate();

      expect(migrationUtil.tableExists).toHaveBeenCalledWith(VIEW);
      expect(executedStatements()).toEqual([
        getProductAnalyticsSessionViewModifyQueryStatement(),
      ]);
      expect(metricService.execute.mock.calls[0]![1]).toBe(
        MigrationExecuteOptions as ClickhouseExecuteOptions,
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("app version"),
      );
    });

    test("leaves a view that is not there to boot, which creates it from the model", async () => {
      viewExists = false;

      await new ReadWebAppVersionsInProductAnalyticsSessions().migrate();

      expect(metricService.execute).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("does not exist"),
      );
    });

    test("fails when the query cannot be set, so it is tried again on the next boot", async () => {
      failing = new Error("ALTER of view failed");

      await expect(
        new ReadWebAppVersionsInProductAnalyticsSessions().migrate(),
      ).rejects.toThrow("ALTER of view failed");
    });

    test("writes the same query when run again", async () => {
      await new ReadWebAppVersionsInProductAnalyticsSessions().migrate();
      await new ReadWebAppVersionsInProductAnalyticsSessions().migrate();

      const statements: Array<string> = executedStatements();

      expect(statements).toHaveLength(2);
      expect(statements[0]).toBe(statements[1]);
    });

    test("has nothing to roll back", async () => {
      await new ReadWebAppVersionsInProductAnalyticsSessions().rollback();

      expect(metricService.execute).not.toHaveBeenCalled();
    });
  });
});
