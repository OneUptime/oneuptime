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
 * Audit entries gained two columns that say a change was made through an MCP
 * client a member connected by signing in, and which one: mcpOAuthGrantId and
 * mcpClientName on AuditLogV2. The recorder writes them on every such entry,
 * and an insert that names a column the table does not have is refused - so
 * until the columns exist, every change an MCP client makes would record
 * nothing at all.
 *
 * This migration is the non-cluster path's way of getting them there. What is
 * pinned:
 *
 *   - it adds exactly the two columns, as the model declares them (Nullable,
 *     so every row written before reads "not through an MCP client");
 *   - it is idempotent: a column that is already there is left alone, and a
 *     second run does nothing;
 *   - it never halts the migration chain over a table that does not exist
 *     yet or a column the model does not declare - the runner stops at the
 *     first failure, and freezing every later migration over an audit label
 *     is the wrong trade;
 *   - a real failure IS a failure, and names the column;
 *   - it is baselined on the clustered schema (boot schema-sync adds the
 *     columns there), its rollback drops nothing, and it runs last.
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

/*
 * The real AuditLog model, with a switch to hide columns from it: the only
 * way to show what the migration does about a column the model does not
 * declare (an older or a later model than the one this migration was written
 * against) without editing the model.
 */
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
import ClickhouseDatabase from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddAuditLogMcpClientColumns, {
  AUDIT_LOG_MCP_CLIENT_COLUMN_KEYS,
} from "../../../FeatureSet/Workers/DataMigrations/AddAuditLogMcpClientColumns";

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

const GRANT_ID_COLUMN: string = "mcpOAuthGrantId";
const CLIENT_NAME_COLUMN: string = "mcpClientName";

let savedClusterName: string | undefined;
let existingColumns: Set<string>;
let loggedWarnings: Array<string>;

type AddedKeysFunction = () => Array<string>;

// The keys of the columns the migration asked to add, in order.
const addedKeys: AddedKeysFunction = (): Array<string> => {
  return auditLogService.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
};

type CheckedKeysFunction = () => Array<string>;

const checkedKeys: CheckedKeysFunction = (): Array<string> => {
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

describe("AddAuditLogMcpClientColumns", () => {
  test("has a stable name: the runner records migrations by name, so renaming it would run it again", () => {
    const migration: AddAuditLogMcpClientColumns =
      new AddAuditLogMcpClientColumns();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe("AddAuditLogMcpClientColumns");
  });

  test("is baselined on the clustered schema, where boot schema-sync adds the columns", () => {
    /*
     * The runner records a migration that answers false here as executed
     * WITHOUT running it. That is what this one wants: its ADD COLUMN is
     * single-node DDL in spirit, and the reconciler has already added every
     * column the model declares by the time data migrations run.
     */
    expect(new AddAuditLogMcpClientColumns().runsInClusterMode()).toBe(false);
  });

  test("adds exactly the two MCP client columns, and the model declares both", () => {
    expect([...AUDIT_LOG_MCP_CLIENT_COLUMN_KEYS]).toEqual([
      GRANT_ID_COLUMN,
      CLIENT_NAME_COLUMN,
    ]);

    const declared: Array<string> = new AuditLog().tableColumns.map(
      (column: AnalyticsTableColumn): string => {
        return column.key;
      },
    );

    for (const key of AUDIT_LOG_MCP_CLIENT_COLUMN_KEYS) {
      expect(declared).toContain(key);
    }

    expect(new AuditLog().tableName).toBe("AuditLogV2");
  });

  test("both columns are optional, so rows written before the migration read as 'not through an MCP client'", () => {
    const grantId: AnalyticsTableColumn = columnOf(GRANT_ID_COLUMN);
    const clientName: AnalyticsTableColumn = columnOf(CLIENT_NAME_COLUMN);

    expect(grantId.required).toBe(false);
    expect(grantId.type).toBe(TableColumnType.ObjectID);
    expect(clientName.required).toBe(false);
    expect(clientName.type).toBe(TableColumnType.Text);

    // No default to backfill and no index to build: the add is metadata-only.
    for (const column of [grantId, clientName]) {
      expect(column.defaultValue).toBeUndefined();
      expect(column.skipIndex).toBeUndefined();
    }
  });

  test("adds both columns to the storage table when neither exists", async () => {
    await new AddAuditLogMcpClientColumns().migrate();

    // The columns live on the local storage table, not the Distributed wrapper.
    expect(migrationUtil.tableExists).toHaveBeenCalledTimes(1);
    expect(migrationUtil.tableExists).toHaveBeenCalledWith("AuditLogV2Local");

    expect(checkedKeys()).toEqual([GRANT_ID_COLUMN, CLIENT_NAME_COLUMN]);
    expect(addedKeys()).toEqual([GRANT_ID_COLUMN, CLIENT_NAME_COLUMN]);
  });

  test("hands the service the model's own column definitions, not copies made here", async () => {
    await new AddAuditLogMcpClientColumns().migrate();

    const added: Array<AnalyticsTableColumn> =
      auditLogService.addColumnInDatabase.mock.calls.map(
        (call: Array<unknown>): AnalyticsTableColumn => {
          return call[0] as AnalyticsTableColumn;
        },
      );

    expect(added).toHaveLength(2);

    for (const column of added) {
      expect(column).toBeInstanceOf(AnalyticsTableColumn);

      const declared: AnalyticsTableColumn = columnOf(column.key);

      expect(column.type).toBe(declared.type);
      expect(column.required).toBe(declared.required);
      expect(column.title).toBe(declared.title);
    }
  });

  test.each([
    {
      name: "the grant id column",
      present: GRANT_ID_COLUMN,
      added: [CLIENT_NAME_COLUMN],
    },
    {
      name: "the client name column",
      present: CLIENT_NAME_COLUMN,
      added: [GRANT_ID_COLUMN],
    },
  ])(
    "leaves $name alone when it is already there, and still adds the other",
    async (data: { present: string; added: Array<string> }) => {
      existingColumns.add(data.present);

      await new AddAuditLogMcpClientColumns().migrate();

      // Both are still asked about; only the missing one is added.
      expect(checkedKeys()).toEqual([GRANT_ID_COLUMN, CLIENT_NAME_COLUMN]);
      expect(addedKeys()).toEqual(data.added);
    },
  );

  test("does nothing when both columns are already there (boot schema-sync got there first)", async () => {
    existingColumns.add(GRANT_ID_COLUMN);
    existingColumns.add(CLIENT_NAME_COLUMN);

    await expect(
      new AddAuditLogMcpClientColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(checkedKeys()).toEqual([GRANT_ID_COLUMN, CLIENT_NAME_COLUMN]);
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("is idempotent: a second run adds nothing", async () => {
    const migration: AddAuditLogMcpClientColumns =
      new AddAuditLogMcpClientColumns();

    await migration.migrate();

    expect(addedKeys()).toEqual([GRANT_ID_COLUMN, CLIENT_NAME_COLUMN]);

    await expect(migration.migrate()).resolves.toBeUndefined();

    // Still the two adds of the first run.
    expect(auditLogService.addColumnInDatabase).toHaveBeenCalledTimes(2);
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new AddAuditLogMcpClientColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith("AuditLogV2Local");
    expect(auditLogService.doesColumnExist).not.toHaveBeenCalled();
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("skips a column the model does not declare, with a warning, and still adds the one it does", async () => {
    hiddenColumnKeys.push(CLIENT_NAME_COLUMN);

    await expect(
      new AddAuditLogMcpClientColumns().migrate(),
    ).resolves.toBeUndefined();

    // Never asked about, never added: there is no definition to add it from.
    expect(checkedKeys()).toEqual([GRANT_ID_COLUMN]);
    expect(addedKeys()).toEqual([GRANT_ID_COLUMN]);

    expect(
      loggedWarnings.some((message: string): boolean => {
        return (
          message.includes("AddAuditLogMcpClientColumns") &&
          message.includes(CLIENT_NAME_COLUMN)
        );
      }),
    ).toBe(true);
  });

  test("does not fail when the model declares neither column", async () => {
    hiddenColumnKeys.push(GRANT_ID_COLUMN, CLIENT_NAME_COLUMN);

    await expect(
      new AddAuditLogMcpClientColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(auditLogService.doesColumnExist).not.toHaveBeenCalled();
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(loggedWarnings).toHaveLength(2);
  });

  test("a failed add fails the migration and names the column, so the runner retries it on the next run", async () => {
    auditLogService.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(new AddAuditLogMcpClientColumns().migrate()).rejects.toThrow(
      "AddAuditLogMcpClientColumns: AuditLogV2.mcpOAuthGrantId: TIMEOUT_EXCEEDED",
    );

    // It stops at the first failure rather than pressing on to the next column.
    expect(auditLogService.addColumnInDatabase).toHaveBeenCalledTimes(1);
    expect(checkedKeys()).toEqual([GRANT_ID_COLUMN]);
  });

  test("a failure on the second column names the second column", async () => {
    auditLogService.addColumnInDatabase.mockImplementation(((
      column: AnalyticsTableColumn,
    ) => {
      if (column.key === CLIENT_NAME_COLUMN) {
        return Promise.reject(new Error("UNKNOWN_TABLE"));
      }

      existingColumns.add(column.key);
      return Promise.resolve(undefined);
    }) as never);

    await expect(new AddAuditLogMcpClientColumns().migrate()).rejects.toThrow(
      "AddAuditLogMcpClientColumns: AuditLogV2.mcpClientName: UNKNOWN_TABLE",
    );

    expect(addedKeys()).toEqual([GRANT_ID_COLUMN, CLIENT_NAME_COLUMN]);
  });

  test("a failed existence check fails the migration too, rather than adding blind", async () => {
    auditLogService.doesColumnExist.mockImplementation(() => {
      return Promise.reject(new Error("NETWORK_ERROR"));
    });

    await expect(new AddAuditLogMcpClientColumns().migrate()).rejects.toThrow(
      "AddAuditLogMcpClientColumns: AuditLogV2.mcpOAuthGrantId: NETWORK_ERROR",
    );

    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("a failed table check fails the migration", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.reject(new Error("CONNECTION_REFUSED"));
    });

    await expect(new AddAuditLogMcpClientColumns().migrate()).rejects.toThrow(
      "CONNECTION_REFUSED",
    );

    expect(auditLogService.doesColumnExist).not.toHaveBeenCalled();
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("rollback drops nothing: the columns hold which client made every change since", async () => {
    await expect(
      new AddAuditLogMcpClientColumns().rollback(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).not.toHaveBeenCalled();
    expect(auditLogService.doesColumnExist).not.toHaveBeenCalled();
    expect(auditLogService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(auditLogService.dropColumnInDatabase).not.toHaveBeenCalled();
    expect(auditLogService.execute).not.toHaveBeenCalled();
  });

  test("the migration only adds: it issues no statement of its own", async () => {
    await new AddAuditLogMcpClientColumns().migrate();

    expect(auditLogService.execute).not.toHaveBeenCalled();
    expect(auditLogService.dropColumnInDatabase).not.toHaveBeenCalled();
  });

  test("runs last, and exactly once", () => {
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
      'import AddAuditLogMcpClientColumns from "./AddAuditLogMcpClientColumns";',
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === "AddAuditLogMcpClientColumns";
      }),
    ).toHaveLength(1);

    // Appended after every migration that existed before it: order is history.
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf("AddAuditLogMcpClientColumns")).toBeGreaterThan(
      registered.indexOf("BackfillIncidentCustomFieldVariableKeys"),
    );
  });
});

describe("the statements the two columns are added with", () => {
  /*
   * AuditLogService is a stub above, so the DDL itself is rendered here with
   * the real generator from the model's real column definitions: this is the
   * text addColumnInDatabase sends for each of them.
   */
  interface RenderedStatement {
    // The SQL text, whitespace collapsed; identifiers are bound parameters.
    query: string;
    // The values bound to those parameters, in order.
    identifiers: Array<unknown>;
  }

  type RenderFunction = (key: string) => RenderedStatement;

  const WHITESPACE_RUN: RegExp = /\s+/g;

  const render: RenderFunction = (key: string): RenderedStatement => {
    const generator: StatementGenerator<AuditLog> =
      new StatementGenerator<AuditLog>({
        modelType: AuditLog,
        database: {
          getDatasourceOptions: (): { database: string } => {
            return { database: "oneuptime" };
          },
        } as unknown as ClickhouseDatabase,
      });

    const statement: Statement = generator.toAddColumnStatement(columnOf(key));

    return {
      query: statement.query.replace(WHITESPACE_RUN, " ").trim(),
      identifiers: Object.values(statement.query_params),
    };
  };

  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });
  });

  test.each([GRANT_ID_COLUMN, CLIENT_NAME_COLUMN])(
    "%s is added Nullable, IF NOT EXISTS, to the local table on every node",
    (key: string) => {
      const rendered: RenderedStatement = render(key);

      expect(rendered.query).toBe(
        `ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ADD COLUMN IF NOT EXISTS ${key} Nullable(String)`,
      );
      // The database, then the LOCAL storage table - not the Distributed wrapper.
      expect(rendered.identifiers).toEqual(["oneuptime", "AuditLogV2Local"]);
    },
  );

  test("the statement follows the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(render(CLIENT_NAME_COLUMN).query).toBe(
      "ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'analytics' ADD COLUMN IF NOT EXISTS mcpClientName Nullable(String)",
    );
  });

  test("neither column builds a skip index: the add stays metadata-only", () => {
    const generator: StatementGenerator<AuditLog> =
      new StatementGenerator<AuditLog>({
        modelType: AuditLog,
        database: {
          getDatasourceOptions: (): { database: string } => {
            return { database: "oneuptime" };
          },
        } as unknown as ClickhouseDatabase,
      });

    for (const key of AUDIT_LOG_MCP_CLIENT_COLUMN_KEYS) {
      expect(generator.toAddSkipIndexStatement(columnOf(key))).toBeNull();
    }
  });
});
