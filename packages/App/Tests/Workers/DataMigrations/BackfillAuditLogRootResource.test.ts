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
 * AuditLog rows gained a root-resource pointer, and the SLO audit page now
 * filters on it. Rows written before the columns existed point at nothing, so
 * without this backfill up to 180 days of SLO history would vanish from the
 * page the day it ships.
 *
 * What is pinned: the mutation points each un-pointed row at itself (what
 * current code writes for a top-level resource) and ONLY un-pointed rows, so
 * re-runs and child rows are untouched; it targets the local storage table ON
 * CLUSTER; it adds a missing column before touching it; and it never halts
 * the migration chain over a table that does not exist yet.
 */

jest.mock("Common/Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      doesColumnExist: jest.fn(),
      addColumnInDatabase: jest.fn(),
      execute: jest.fn(),
    },
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

import AuditLogService from "Common/Server/Services/AuditLogService";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import logger from "Common/Server/Utils/Logger";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "Common/Types/AnalyticsDatabase/TableColumn";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import BackfillAuditLogRootResource, {
  ROOT_RESOURCE_COLUMN_KEYS,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillAuditLogRootResource";

type MockFunction = ReturnType<typeof jest.fn>;

const auditLogService: {
  doesColumnExist: MockFunction;
  addColumnInDatabase: MockFunction;
  execute: MockFunction;
} = AuditLogService as unknown as {
  doesColumnExist: MockFunction;
  addColumnInDatabase: MockFunction;
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const EXPECTED_STATEMENT: string =
  "ALTER TABLE AuditLogV2Local ON CLUSTER 'oneuptime' UPDATE rootResourceType = resourceType, rootResourceId = resourceId WHERE rootResourceId IS NULL";

let savedClusterName: string | undefined;

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  auditLogService.doesColumnExist.mockReset();
  auditLogService.addColumnInDatabase.mockReset();
  auditLogService.execute.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  auditLogService.doesColumnExist.mockImplementation(() => {
    return Promise.resolve(true);
  });
  auditLogService.addColumnInDatabase.mockImplementation(() => {
    return Promise.resolve(undefined);
  });
  auditLogService.execute.mockImplementation(() => {
    return Promise.resolve(undefined);
  });

  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }

  jest.restoreAllMocks();
});

describe("BackfillAuditLogRootResource", () => {
  test("has a stable name and runs on the clustered schema", () => {
    const migration: BackfillAuditLogRootResource =
      new BackfillAuditLogRootResource();

    // The runner records migrations by name; renaming it would re-run it.
    expect(migration.name).toBe("BackfillAuditLogRootResource");
    expect(migration.runsInClusterMode()).toBe(true);
  });

  test("points every un-pointed row at itself, and only those rows", () => {
    expect(
      BackfillAuditLogRootResource.getBackfillStatement("AuditLogV2"),
    ).toBe(EXPECTED_STATEMENT);
    expect(new AuditLog().tableName).toBe("AuditLogV2");
  });

  test("targets the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(
      BackfillAuditLogRootResource.getBackfillStatement("AuditLogV2"),
    ).toContain("ALTER TABLE AuditLogV2Local ON CLUSTER 'analytics' UPDATE");
  });

  test("backfills the columns the model declares", () => {
    const keys: Array<string> = new AuditLog().tableColumns.map(
      (column: AnalyticsTableColumn) => {
        return column.key;
      },
    );

    expect([...ROOT_RESOURCE_COLUMN_KEYS]).toEqual([
      "rootResourceType",
      "rootResourceId",
    ]);
    for (const key of ROOT_RESOURCE_COLUMN_KEYS) {
      expect(keys).toContain(key);
    }
  });

  test("queues the mutation once the columns exist", async () => {
    await new BackfillAuditLogRootResource().migrate();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith("AuditLogV2Local");
    expect(auditLogService.doesColumnExist).toHaveBeenCalledWith(
      "rootResourceType",
    );
    expect(auditLogService.doesColumnExist).toHaveBeenCalledWith(
      "rootResourceId",
    );
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(auditLogService.execute).toHaveBeenCalledTimes(1);
    expect(auditLogService.execute).toHaveBeenCalledWith(
      EXPECTED_STATEMENT,
      MigrationExecuteOptions,
    );
  });

  test("adds a missing column, with its bloom filter, before the mutation reads it", async () => {
    auditLogService.doesColumnExist.mockImplementation(((key: string) => {
      return Promise.resolve(key !== "rootResourceId");
    }) as never);

    await new BackfillAuditLogRootResource().migrate();

    expect(auditLogService.addColumnInDatabase).toHaveBeenCalledTimes(1);

    const added: AnalyticsTableColumn = auditLogService.addColumnInDatabase.mock
      .calls[0]![0] as AnalyticsTableColumn;

    expect(added.key).toBe("rootResourceId");
    expect(added.skipIndex?.type).toBe(SkipIndexType.BloomFilter);
    expect(
      auditLogService.addColumnInDatabase.mock.invocationCallOrder[0]!,
    ).toBeLessThan(auditLogService.execute.mock.invocationCallOrder[0]!);
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new BackfillAuditLogRootResource().migrate(),
    ).resolves.toBeUndefined();

    expect(auditLogService.doesColumnExist).not.toHaveBeenCalled();
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(auditLogService.execute).not.toHaveBeenCalled();
  });

  test("a failed mutation fails the migration, so the runner retries it on the next run", async () => {
    auditLogService.execute.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(new BackfillAuditLogRootResource().migrate()).rejects.toThrow(
      "TIMEOUT_EXCEEDED",
    );
  });

  test("rollback leaves the pointers in place", async () => {
    await expect(
      new BackfillAuditLogRootResource().rollback(),
    ).resolves.toBeUndefined();
    expect(auditLogService.execute).not.toHaveBeenCalled();
  });

  test("runs last, after every migration that existed before it", () => {
    const index: string = fs
      .readFileSync(
        path.join(
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

    expect(index).toContain(
      'import BackfillAuditLogRootResource from "./BackfillAuditLogRootResource";',
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string) => {
        return name === "BackfillAuditLogRootResource";
      }),
    ).toHaveLength(1);
    expect(registered.indexOf("BackfillAuditLogRootResource")).toBeGreaterThan(
      registered.indexOf("RepairHashedStringEnvelopeSecrets"),
    );
  });
});
