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
 * Audit entries gained two columns that name the workflow whose step made a
 * change: workflowId and workflowName on AuditLogV2. A workflow step acts as
 * a Project Admin of its project and as no person (WorkflowPrincipal), so the
 * recorder names the workflow instead of a user, and an insert that names a
 * column the table does not have is refused - so until the columns exist,
 * every change a workflow makes would record nothing at all.
 *
 * What is pinned:
 *
 *   - it adds exactly the two columns, as the model declares them (Nullable,
 *     so every row written before reads "not made by a workflow");
 *   - it is idempotent: a column that is already there is left alone;
 *   - it never halts the migration chain over a table that does not exist
 *     yet or a column the model does not declare;
 *   - a real failure IS a failure, and names the column;
 *   - it is baselined on the clustered schema (boot schema-sync adds the
 *     columns there), its rollback drops nothing, and it is registered once,
 *     before the MCP client columns that keep the last slot.
 */

jest.mock("Common/Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      doesColumnExist: jest.fn(),
      addColumnInDatabase: jest.fn(),
      dropColumnInDatabase: jest.fn(),
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

// The real AuditLog model, with a switch to hide columns from it.
jest.mock("Common/Models/AnalyticsModels/AuditLog", () => {
  type ColumnLike = { key: string };
  type AuditLogLike = { tableColumns: Array<ColumnLike> };

  const actual: { default: new () => AuditLogLike } = jest.requireActual(
    "Common/Models/AnalyticsModels/AuditLog",
  ) as { default: new () => AuditLogLike };

  const hiddenColumnKeys: Array<string> = [];

  class AuditLogWithHiddenColumns extends actual.default {
    public constructor() {
      super();
      this.tableColumns = this.tableColumns.filter(
        (column: ColumnLike): boolean => {
          return !hiddenColumnKeys.includes(column.key);
        },
      );
    }
  }

  return {
    __esModule: true,
    default: AuditLogWithHiddenColumns,
    hiddenColumnKeys,
  };
});

import AuditLogService from "Common/Server/Services/AuditLogService";
import logger from "Common/Server/Utils/Logger";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddAuditLogWorkflowColumns, {
  AUDIT_LOG_WORKFLOW_COLUMN_KEYS,
} from "../../../FeatureSet/Workers/DataMigrations/AddAuditLogWorkflowColumns";

type MockFunction = ReturnType<typeof jest.fn>;

interface AuditLogServiceMock {
  doesColumnExist: MockFunction;
  addColumnInDatabase: MockFunction;
  dropColumnInDatabase: MockFunction;
  execute: MockFunction;
}

const auditLogService: AuditLogServiceMock =
  AuditLogService as unknown as AuditLogServiceMock;

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const hiddenColumnKeys: Array<string> = (
  jest.requireMock("Common/Models/AnalyticsModels/AuditLog") as {
    hiddenColumnKeys: Array<string>;
  }
).hiddenColumnKeys;

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const WORKFLOW_ID_COLUMN: string = "workflowId";
const WORKFLOW_NAME_COLUMN: string = "workflowName";

let savedClusterName: string | undefined;
let existingColumns: Set<string>;
let loggedWarnings: Array<string>;

type KeysFunction = () => Array<string>;

// The keys of the columns the migration asked to add, in order.
const addedKeys: KeysFunction = (): Array<string> => {
  return auditLogService.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
};

const checkedKeys: KeysFunction = (): Array<string> => {
  return auditLogService.doesColumnExist.mock.calls.map(
    (call: Array<unknown>): string => {
      return call[0] as string;
    },
  );
};

type ColumnOfFunction = (key: string) => AnalyticsTableColumn;

const columnOf: ColumnOfFunction = (key: string): AnalyticsTableColumn => {
  const column: AnalyticsTableColumn | undefined =
    new AuditLog().tableColumns.find((item: AnalyticsTableColumn): boolean => {
      return item.key === key;
    });

  expect(column).toBeDefined();

  return column!;
};

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  hiddenColumnKeys.length = 0;
  existingColumns = new Set<string>();
  loggedWarnings = [];

  auditLogService.doesColumnExist.mockReset();
  auditLogService.addColumnInDatabase.mockReset();
  auditLogService.dropColumnInDatabase.mockReset();
  auditLogService.execute.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  auditLogService.doesColumnExist.mockImplementation(((key: string) => {
    return Promise.resolve(existingColumns.has(key));
  }) as never);
  // Adding a column makes it exist, as it does in the database.
  auditLogService.addColumnInDatabase.mockImplementation(((
    column: AnalyticsTableColumn,
  ) => {
    existingColumns.add(column.key);
    return Promise.resolve(undefined);
  }) as never);

  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
    loggedWarnings.push(String(message));
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }

  hiddenColumnKeys.length = 0;
  jest.restoreAllMocks();
});

describe("AddAuditLogWorkflowColumns", () => {
  test("has a stable name: the runner records migrations by name, so renaming it would run it again", () => {
    const migration: AddAuditLogWorkflowColumns =
      new AddAuditLogWorkflowColumns();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe("AddAuditLogWorkflowColumns");
  });

  test("is baselined on the clustered schema, where boot schema-sync adds the columns", () => {
    expect(new AddAuditLogWorkflowColumns().runsInClusterMode()).toBe(false);
  });

  test("adds exactly the two workflow columns, and the model declares both, optional", () => {
    expect([...AUDIT_LOG_WORKFLOW_COLUMN_KEYS]).toEqual([
      WORKFLOW_ID_COLUMN,
      WORKFLOW_NAME_COLUMN,
    ]);

    const workflowId: AnalyticsTableColumn = columnOf(WORKFLOW_ID_COLUMN);
    const workflowName: AnalyticsTableColumn = columnOf(WORKFLOW_NAME_COLUMN);

    expect(workflowId.required).toBe(false);
    expect(workflowId.type).toBe(TableColumnType.ObjectID);
    expect(workflowName.required).toBe(false);
    expect(workflowName.type).toBe(TableColumnType.Text);

    // Nothing to backfill and no index to build: the add is metadata-only.
    for (const column of [workflowId, workflowName]) {
      expect(column.defaultValue).toBeUndefined();
      expect(column.skipIndex).toBeUndefined();
    }

    expect(new AuditLog().tableName).toBe("AuditLogV2");
  });

  test("adds both columns to the storage table when neither exists, from the model's own definitions", async () => {
    await new AddAuditLogWorkflowColumns().migrate();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith("AuditLogV2Local");
    expect(checkedKeys()).toEqual([WORKFLOW_ID_COLUMN, WORKFLOW_NAME_COLUMN]);
    expect(addedKeys()).toEqual([WORKFLOW_ID_COLUMN, WORKFLOW_NAME_COLUMN]);

    for (const call of auditLogService.addColumnInDatabase.mock.calls) {
      const column: AnalyticsTableColumn = call[0] as AnalyticsTableColumn;

      expect(column).toBeInstanceOf(AnalyticsTableColumn);
      expect(column.type).toBe(columnOf(column.key).type);
    }
  });

  test("leaves a column that is already there alone, and still adds the other", async () => {
    existingColumns.add(WORKFLOW_ID_COLUMN);

    await new AddAuditLogWorkflowColumns().migrate();

    expect(checkedKeys()).toEqual([WORKFLOW_ID_COLUMN, WORKFLOW_NAME_COLUMN]);
    expect(addedKeys()).toEqual([WORKFLOW_NAME_COLUMN]);
  });

  test("is idempotent: a second run adds nothing", async () => {
    const migration: AddAuditLogWorkflowColumns =
      new AddAuditLogWorkflowColumns();

    await migration.migrate();
    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(auditLogService.addColumnInDatabase).toHaveBeenCalledTimes(2);
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new AddAuditLogWorkflowColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(auditLogService.doesColumnExist).not.toHaveBeenCalled();
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("skips a column the model does not declare, with a warning, and still adds the one it does", async () => {
    hiddenColumnKeys.push(WORKFLOW_NAME_COLUMN);

    await expect(
      new AddAuditLogWorkflowColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(addedKeys()).toEqual([WORKFLOW_ID_COLUMN]);
    expect(
      loggedWarnings.some((message: string): boolean => {
        return (
          message.includes("AddAuditLogWorkflowColumns") &&
          message.includes(WORKFLOW_NAME_COLUMN)
        );
      }),
    ).toBe(true);
  });

  test("a failed add fails the migration and names the column", async () => {
    auditLogService.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(new AddAuditLogWorkflowColumns().migrate()).rejects.toThrow(
      "AddAuditLogWorkflowColumns: AuditLogV2.workflowId: TIMEOUT_EXCEEDED",
    );

    expect(auditLogService.addColumnInDatabase).toHaveBeenCalledTimes(1);
  });

  test("rollback drops nothing: the columns hold which workflow made every change since", async () => {
    await expect(
      new AddAuditLogWorkflowColumns().rollback(),
    ).resolves.toBeUndefined();

    expect(auditLogService.dropColumnInDatabase).not.toHaveBeenCalled();
    expect(auditLogService.execute).not.toHaveBeenCalled();
  });

  test("is registered exactly once, before the MCP client columns that keep the last slot", () => {
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

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === "AddAuditLogWorkflowColumns";
      }),
    ).toHaveLength(1);
    expect(registered.indexOf("AddAuditLogWorkflowColumns")).toBeLessThan(
      registered.indexOf("AddAuditLogMcpClientColumns"),
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });
});
