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
 * The audit log's columns that say whose permissions a workflow's step ran
 * with were first named workflowRunAsGivenByUserId, workflowRunAsGivenByApiKeyId
 * and workflowRunAsGivenByName (#9791), and are workflowRunAsGiverUserId,
 * workflowRunAsGiverApiKeyId and workflowRunAsGiverName now: no analytics
 * model names a column "<act> by user" (UserAttributionColumns). Boot
 * schema-sync adds the new columns empty, so an install that recorded
 * entries under the first names would see them stop saying whose
 * permissions their workflow ran with.
 *
 * What is pinned: the mutation copies each value only into a column that
 * holds none, and only on rows recorded under the first names; it copies
 * only the first names an install has; it does nothing on an install that
 * never had them; it adds a missing new column before it writes it; it
 * targets the local storage table ON CLUSTER; it never halts the chain over
 * a table that does not exist yet; and it is registered once, after the
 * migration that added the columns.
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
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import { WORKFLOW_RUN_AS_AUDIT_COLUMNS } from "Common/Types/Workflow/WorkflowRunAs";
import { AUDIT_LOG_EXPORT_WORKFLOW_RUN_AS_KEYS } from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import CopyAuditLogWorkflowRunAsGiverColumns, {
  AUDIT_LOG_WORKFLOW_RUN_AS_GIVER_RENAMES,
  RenamedAuditLogColumn,
} from "../../../FeatureSet/Workers/DataMigrations/CopyAuditLogWorkflowRunAsGiverColumns";

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

const FIRST_NAMES: Array<string> = [
  "workflowRunAsGivenByUserId",
  "workflowRunAsGivenByApiKeyId",
  "workflowRunAsGivenByName",
];

const NEW_NAMES: Array<string> = [
  "workflowRunAsGiverUserId",
  "workflowRunAsGiverApiKeyId",
  "workflowRunAsGiverName",
];

const COPY_OF_ALL_THREE: string =
  "ALTER TABLE AuditLogV2Local ON CLUSTER 'oneuptime' UPDATE " +
  "workflowRunAsGiverUserId = coalesce(workflowRunAsGiverUserId, workflowRunAsGivenByUserId), " +
  "workflowRunAsGiverApiKeyId = coalesce(workflowRunAsGiverApiKeyId, workflowRunAsGivenByApiKeyId), " +
  "workflowRunAsGiverName = coalesce(workflowRunAsGiverName, workflowRunAsGivenByName) " +
  "WHERE workflowRunAsGivenByUserId IS NOT NULL OR workflowRunAsGivenByApiKeyId IS NOT NULL OR workflowRunAsGivenByName IS NOT NULL";

let savedClusterName: string | undefined;
let existingColumns: Set<string>;

function addedKeys(): Array<string> {
  return auditLogService.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  // An install that ran a build with the first names, and booted this one.
  existingColumns = new Set<string>([...FIRST_NAMES, ...NEW_NAMES]);

  auditLogService.doesColumnExist.mockReset();
  auditLogService.addColumnInDatabase.mockReset();
  auditLogService.execute.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  auditLogService.doesColumnExist.mockImplementation(((key: string) => {
    return Promise.resolve(existingColumns.has(key));
  }) as never);
  auditLogService.addColumnInDatabase.mockImplementation(((
    column: AnalyticsTableColumn,
  ) => {
    existingColumns.add(column.key);
    return Promise.resolve(undefined);
  }) as never);
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

describe("CopyAuditLogWorkflowRunAsGiverColumns", () => {
  test("has a stable name and runs on the clustered schema", () => {
    const migration: CopyAuditLogWorkflowRunAsGiverColumns =
      new CopyAuditLogWorkflowRunAsGiverColumns();

    // The runner records migrations by name; renaming it would re-run it.
    expect(migration.name).toBe("CopyAuditLogWorkflowRunAsGiverColumns");
    expect(migration.runsInClusterMode()).toBe(true);
  });

  test("copies from each first name into the name the model, the recorder and the export use now", () => {
    expect(
      AUDIT_LOG_WORKFLOW_RUN_AS_GIVER_RENAMES.map(
        (rename: RenamedAuditLogColumn): string => {
          return rename.from;
        },
      ),
    ).toEqual(FIRST_NAMES);
    expect(
      AUDIT_LOG_WORKFLOW_RUN_AS_GIVER_RENAMES.map(
        (rename: RenamedAuditLogColumn): string => {
          return rename.to;
        },
      ),
    ).toEqual(NEW_NAMES);

    const model: AuditLog = new AuditLog();
    const keys: Array<string> = model.tableColumns.map(
      (column: AnalyticsTableColumn): string => {
        return column.key;
      },
    );

    for (const name of NEW_NAMES) {
      // Nullable, as the first ones were: a row with no giver holds NULL.
      expect(keys).toContain(name);
      expect(
        model.tableColumns.find((column: AnalyticsTableColumn): boolean => {
          return column.key === name;
        })?.required,
      ).toBe(false);
      expect(WORKFLOW_RUN_AS_AUDIT_COLUMNS).toContain(name);
      expect(AUDIT_LOG_EXPORT_WORKFLOW_RUN_AS_KEYS).toContain(name);
    }

    for (const name of FIRST_NAMES) {
      expect(keys).not.toContain(name);
      expect(WORKFLOW_RUN_AS_AUDIT_COLUMNS).not.toContain(name);
      expect(AUDIT_LOG_EXPORT_WORKFLOW_RUN_AS_KEYS).not.toContain(name);
    }
  });

  test("the copy writes only a column that holds nothing, on rows recorded under the first names", () => {
    expect(
      CopyAuditLogWorkflowRunAsGiverColumns.getCopyStatement({
        tableName: "AuditLogV2",
        renames: AUDIT_LOG_WORKFLOW_RUN_AS_GIVER_RENAMES,
      }),
    ).toBe(COPY_OF_ALL_THREE);
    expect(new AuditLog().tableName).toBe("AuditLogV2");
  });

  test("targets the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(
      CopyAuditLogWorkflowRunAsGiverColumns.getCopyStatement({
        tableName: "AuditLogV2",
        renames: AUDIT_LOG_WORKFLOW_RUN_AS_GIVER_RENAMES,
      }),
    ).toContain("ALTER TABLE AuditLogV2Local ON CLUSTER 'analytics' UPDATE");
  });

  test("queues one copy of all three on an install that has the first names", async () => {
    await new CopyAuditLogWorkflowRunAsGiverColumns().migrate();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith("AuditLogV2Local");
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(auditLogService.execute).toHaveBeenCalledTimes(1);
    expect(auditLogService.execute).toHaveBeenCalledWith(
      COPY_OF_ALL_THREE,
      MigrationExecuteOptions,
    );
  });

  test("copies only the first names an install has", async () => {
    existingColumns.delete("workflowRunAsGivenByApiKeyId");

    await new CopyAuditLogWorkflowRunAsGiverColumns().migrate();

    expect(auditLogService.execute).toHaveBeenCalledWith(
      "ALTER TABLE AuditLogV2Local ON CLUSTER 'oneuptime' UPDATE " +
        "workflowRunAsGiverUserId = coalesce(workflowRunAsGiverUserId, workflowRunAsGivenByUserId), " +
        "workflowRunAsGiverName = coalesce(workflowRunAsGiverName, workflowRunAsGivenByName) " +
        "WHERE workflowRunAsGivenByUserId IS NOT NULL OR workflowRunAsGivenByName IS NOT NULL",
      MigrationExecuteOptions,
    );
  });

  test("does nothing on an install that never had the first names: a new one, or one upgraded from a release before them", async () => {
    existingColumns = new Set<string>(NEW_NAMES);

    await new CopyAuditLogWorkflowRunAsGiverColumns().migrate();

    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(auditLogService.execute).not.toHaveBeenCalled();
  });

  test("adds a new column boot schema-sync has not added yet, as the model declares it, before the copy writes it", async () => {
    existingColumns.delete("workflowRunAsGiverName");

    await new CopyAuditLogWorkflowRunAsGiverColumns().migrate();

    expect(addedKeys()).toEqual(["workflowRunAsGiverName"]);

    const added: AnalyticsTableColumn = auditLogService.addColumnInDatabase.mock
      .calls[0]![0] as AnalyticsTableColumn;

    expect(added.type).toBe(TableColumnType.Text);
    expect(added.required).toBe(false);
    expect(
      auditLogService.addColumnInDatabase.mock.invocationCallOrder[0]!,
    ).toBeLessThan(auditLogService.execute.mock.invocationCallOrder[0]!);
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new CopyAuditLogWorkflowRunAsGiverColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(auditLogService.doesColumnExist).not.toHaveBeenCalled();
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(auditLogService.execute).not.toHaveBeenCalled();
  });

  test("a failed copy fails the migration, so the runner retries it on the next run", async () => {
    auditLogService.execute.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(
      new CopyAuditLogWorkflowRunAsGiverColumns().migrate(),
    ).rejects.toThrow("TIMEOUT_EXCEEDED");
  });

  test("rollback leaves the copies, and the first names' columns, as they are", async () => {
    await expect(
      new CopyAuditLogWorkflowRunAsGiverColumns().rollback(),
    ).resolves.toBeUndefined();
    expect(auditLogService.execute).not.toHaveBeenCalled();
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("is registered once, after the migration that added the columns", () => {
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
      'import CopyAuditLogWorkflowRunAsGiverColumns from "./CopyAuditLogWorkflowRunAsGiverColumns";',
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string) => {
        return name === "CopyAuditLogWorkflowRunAsGiverColumns";
      }),
    ).toHaveLength(1);
    expect(
      registered.indexOf("CopyAuditLogWorkflowRunAsGiverColumns"),
    ).toBeGreaterThan(registered.indexOf("AddAuditLogWorkflowRunAsColumns"));
    // The last two slots are kept by the migrations that assert them.
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
  });
});
