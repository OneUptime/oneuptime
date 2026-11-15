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
 * #8194: RumProductAnalyticsSessionV1_mv filed a session's entry page as
 * path(entryUrl), and path() stops at the fragment, so every session of a
 * hash-routed app was filed under "/". The model's view reads the route
 * now; this migration puts that query on the view an install already has,
 * which boot's schema-sync does not see (it checks a view's tables and
 * aggregate functions, not the expressions inside).
 *
 * What is pinned:
 *
 *   - one statement: ALTER TABLE ... MODIFY QUERY on the view, ON CLUSTER,
 *     with the model's own SELECT in the cluster form boot creates it in
 *     (the local source table) - atomic, so no insert goes by unfiled;
 *   - the query is the model's: its entry page reads the route
 *     (PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL), and nothing else differs
 *     from the view boot would create;
 *   - a view that does not exist is left to boot, and a statement that
 *     fails fails the migration, so it is tried again on the next boot;
 *   - its rollback does nothing, it runs on the clustered schema, and it is
 *     registered once, before the last slot.
 *
 * ReadHashRoutesInProductAnalyticsEntryPagesClickhouse.test.ts runs it
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
  PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL,
} from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import { applyClusterToMaterializedViewQuery } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import ReadHashRoutesInProductAnalyticsEntryPages from "../../../FeatureSet/Workers/DataMigrations/ReadHashRoutesInProductAnalyticsEntryPages";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const MIGRATION_NAME: string = "ReadHashRoutesInProductAnalyticsEntryPages";
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

describe("ReadHashRoutesInProductAnalyticsEntryPages", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: ReadHashRoutesInProductAnalyticsEntryPages =
        new ReadHashRoutesInProductAnalyticsEntryPages();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      expect(
        new ReadHashRoutesInProductAnalyticsEntryPages().runsInClusterMode(),
      ).toBe(true);
    });

    test("is registered once, after the page redaction and before the last slot", () => {
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

      const registered: Array<string> = Array.from(
        index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(
        registered.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        registered.indexOf("RedactPersonalDataInProductAnalyticsPages"),
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
        ReadHashRoutesInProductAnalyticsEntryPages.getModifyQueryStatement();

      expect(
        statement.startsWith(
          `ALTER TABLE ${VIEW} ON CLUSTER 'oneuptime' MODIFY QUERY SELECT`,
        ),
      ).toBe(true);
      // The local source table, as boot creates the view on a cluster.
      expect(statement).toContain("FROM RumSessionV1Local");
      expect(statement).not.toContain("CREATE");
      expect(statement).not.toMatch(/\bTO\s+RumProductAnalyticsSessionV1/);
    });

    test("is the view boot creates, from SELECT on", () => {
      const view: { query: string } = new RumProductAnalyticsSession()
        .materializedViews[0]!;
      const created: string = applyClusterToMaterializedViewQuery(view.query);

      expect(
        ReadHashRoutesInProductAnalyticsEntryPages.getModifyQueryStatement().replace(
          /^ALTER TABLE \S+ ON CLUSTER '[^']+' MODIFY QUERY /,
          "",
        ),
      ).toBe(created.slice(created.search(/\bSELECT\b/)));
    });

    test("files the entry page by its hash route, no longer by path() alone", () => {
      const statement: string =
        ReadHashRoutesInProductAnalyticsEntryPages.getModifyQueryStatement();

      expect(statement).toContain(
        `maxSimpleState(${PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL}) AS entryPage`,
      );
      expect(PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL).toContain(
        "fragment(entryUrl)",
      );
      expect(statement).not.toContain("maxSimpleState(path(entryUrl))");
    });

    test("names the cluster it is given", () => {
      process.env[CLUSTER_ENV_KEY] = "analytics";

      expect(
        ReadHashRoutesInProductAnalyticsEntryPages.getModifyQueryStatement(),
      ).toContain(`ALTER TABLE ${VIEW} ON CLUSTER 'analytics' MODIFY QUERY`);
    });
  });

  describe("running it", () => {
    test("sets the query once, through the migration connection", async () => {
      await new ReadHashRoutesInProductAnalyticsEntryPages().migrate();

      expect(migrationUtil.tableExists).toHaveBeenCalledWith(VIEW);
      expect(executedStatements()).toEqual([
        ReadHashRoutesInProductAnalyticsEntryPages.getModifyQueryStatement(),
      ]);
      expect(metricService.execute.mock.calls[0]![1]).toBe(
        MigrationExecuteOptions as ClickhouseExecuteOptions,
      );
    });

    test("leaves a view that is not there to boot, which creates it from the model", async () => {
      viewExists = false;

      await new ReadHashRoutesInProductAnalyticsEntryPages().migrate();

      expect(metricService.execute).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("does not exist"),
      );
    });

    test("fails when the query cannot be set, so it is tried again on the next boot", async () => {
      failing = new Error("ALTER of view failed");

      await expect(
        new ReadHashRoutesInProductAnalyticsEntryPages().migrate(),
      ).rejects.toThrow("ALTER of view failed");
    });

    test("writes the same query when run again", async () => {
      await new ReadHashRoutesInProductAnalyticsEntryPages().migrate();
      await new ReadHashRoutesInProductAnalyticsEntryPages().migrate();

      const statements: Array<string> = executedStatements();

      expect(statements).toHaveLength(2);
      expect(statements[0]).toBe(statements[1]);
    });

    test("has nothing to roll back", async () => {
      await new ReadHashRoutesInProductAnalyticsEntryPages().rollback();

      expect(metricService.execute).not.toHaveBeenCalled();
    });
  });
});
