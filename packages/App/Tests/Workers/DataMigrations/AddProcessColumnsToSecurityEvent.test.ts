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
 * Security events gained six columns that say which process an event is
 * about and which process started it: processName, processPath,
 * processCommandLine and their parent* counterparts on SecurityEvent. The
 * ingest path writes them on every row, and an insert that names a column
 * the table does not have is refused - so until the columns exist, no
 * security event at all would be stored.
 *
 * This migration is the non-cluster path's way of getting them there. What
 * is pinned:
 *
 *   - it adds exactly the six columns, as the model declares them (String
 *     with a '' default, so every row written before reads "the source did
 *     not say");
 *   - it is idempotent: a column that is already there is left alone, and a
 *     second run does nothing;
 *   - it never halts the migration chain over a table that does not exist
 *     yet or a column the model does not declare;
 *   - a real failure IS a failure, and names the column;
 *   - it is baselined on the clustered schema (boot schema-sync adds the
 *     columns there), its rollback drops nothing, and it sits before the
 *     last slot.
 */

jest.mock("Common/Server/Services/SecurityEventService", () => {
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
 * The real SecurityEvent model, with a switch to hide columns from it: the
 * only way to show what the migration does about a column the model does not
 * declare without editing the model.
 */
jest.mock("Common/Models/AnalyticsModels/SecurityEvent", () => {
  type ColumnLike = { key: string };
  type SecurityEventLike = { tableColumns: Array<ColumnLike> };

  const actual: { default: new () => SecurityEventLike } = jest.requireActual(
    "Common/Models/AnalyticsModels/SecurityEvent",
  ) as { default: new () => SecurityEventLike };

  const hiddenColumnKeys: Array<string> = [];

  class SecurityEventWithHiddenColumns extends actual.default {
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
    default: SecurityEventWithHiddenColumns,
    hiddenColumnKeys,
  };
});

import SecurityEventService from "Common/Server/Services/SecurityEventService";
import ClickhouseDatabase from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddProcessColumnsToSecurityEvent, {
  SECURITY_EVENT_PROCESS_COLUMN_KEYS,
} from "../../../FeatureSet/Workers/DataMigrations/AddProcessColumnsToSecurityEvent";

type MockFunction = ReturnType<typeof jest.fn>;

interface SecurityEventServiceMock {
  doesColumnExist: MockFunction;
  addColumnInDatabase: MockFunction;
  dropColumnInDatabase: MockFunction;
  execute: MockFunction;
}

const securityEventService: SecurityEventServiceMock =
  SecurityEventService as unknown as SecurityEventServiceMock;

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const hiddenColumnKeys: Array<string> = (
  jest.requireMock("Common/Models/AnalyticsModels/SecurityEvent") as {
    hiddenColumnKeys: Array<string>;
  }
).hiddenColumnKeys;

const MIGRATION_NAME: string = "AddProcessColumnsToSecurityEvent";
const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const PROCESS_COLUMNS: Array<string> = [
  "processName",
  "processPath",
  "processCommandLine",
  "parentProcessName",
  "parentProcessPath",
  "parentProcessCommandLine",
];

let savedClusterName: string | undefined;
let existingColumns: Set<string>;
let loggedWarnings: Array<string>;

type KeysFunction = () => Array<string>;

// The keys of the columns the migration asked to add, in order.
const addedKeys: KeysFunction = (): Array<string> => {
  return securityEventService.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
};

const checkedKeys: KeysFunction = (): Array<string> => {
  return securityEventService.doesColumnExist.mock.calls.map(
    (call: Array<unknown>): string => {
      return call[0] as string;
    },
  );
};

type ColumnOfFunction = (key: string) => AnalyticsTableColumn;

const columnOf: ColumnOfFunction = (key: string): AnalyticsTableColumn => {
  const column: AnalyticsTableColumn | undefined =
    new SecurityEvent().tableColumns.find(
      (item: AnalyticsTableColumn): boolean => {
        return item.key === key;
      },
    );

  expect(column).toBeDefined();

  return column!;
};

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  hiddenColumnKeys.length = 0;
  existingColumns = new Set<string>();
  loggedWarnings = [];

  securityEventService.doesColumnExist.mockReset();
  securityEventService.addColumnInDatabase.mockReset();
  securityEventService.dropColumnInDatabase.mockReset();
  securityEventService.execute.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  securityEventService.doesColumnExist.mockImplementation(((key: string) => {
    return Promise.resolve(existingColumns.has(key));
  }) as never);
  // Adding a column makes it exist, as it does in the database.
  securityEventService.addColumnInDatabase.mockImplementation(((
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

describe("AddProcessColumnsToSecurityEvent", () => {
  test("has a stable name: the runner records migrations by name, so renaming it would run it again", () => {
    const migration: AddProcessColumnsToSecurityEvent =
      new AddProcessColumnsToSecurityEvent();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("is baselined on the clustered schema, where boot schema-sync adds the columns", () => {
    expect(new AddProcessColumnsToSecurityEvent().runsInClusterMode()).toBe(
      false,
    );
  });

  test("adds exactly the six process columns, and the model declares every one", () => {
    expect([...SECURITY_EVENT_PROCESS_COLUMN_KEYS]).toEqual(PROCESS_COLUMNS);

    const declared: Array<string> = new SecurityEvent().tableColumns.map(
      (column: AnalyticsTableColumn): string => {
        return column.key;
      },
    );

    for (const key of SECURITY_EVENT_PROCESS_COLUMN_KEYS) {
      expect(declared).toContain(key);
    }

    expect(new SecurityEvent().tableName).toBe("SecurityEventItemV1");
  });

  test.each(PROCESS_COLUMNS)(
    "%s is text with a '' default, so rows written before read 'the source did not say'",
    (key: string) => {
      const column: AnalyticsTableColumn = columnOf(key);

      expect(column.type).toBe(TableColumnType.Text);
      expect(column.required).toBe(true);
      expect(column.defaultValue).toBe("");
      // No index to build: the add is metadata-only.
      expect(column.skipIndex).toBeUndefined();
    },
  );

  test("adds all six columns to the storage table when none exists", async () => {
    await new AddProcessColumnsToSecurityEvent().migrate();

    // The columns live on the local storage table, not the Distributed wrapper.
    expect(migrationUtil.tableExists).toHaveBeenCalledTimes(1);
    expect(migrationUtil.tableExists).toHaveBeenCalledWith(
      "SecurityEventItemV1Local",
    );

    expect(checkedKeys()).toEqual(PROCESS_COLUMNS);
    expect(addedKeys()).toEqual(PROCESS_COLUMNS);
  });

  test("hands the service the model's own column definitions, not copies made here", async () => {
    await new AddProcessColumnsToSecurityEvent().migrate();

    const added: Array<AnalyticsTableColumn> =
      securityEventService.addColumnInDatabase.mock.calls.map(
        (call: Array<unknown>): AnalyticsTableColumn => {
          return call[0] as AnalyticsTableColumn;
        },
      );

    expect(added).toHaveLength(PROCESS_COLUMNS.length);

    for (const column of added) {
      expect(column).toBeInstanceOf(AnalyticsTableColumn);

      const declared: AnalyticsTableColumn = columnOf(column.key);

      expect(column.type).toBe(declared.type);
      expect(column.required).toBe(declared.required);
      expect(column.title).toBe(declared.title);
    }
  });

  test("leaves the columns that are already there alone, and still adds the others", async () => {
    existingColumns.add("processName");
    existingColumns.add("parentProcessCommandLine");

    await new AddProcessColumnsToSecurityEvent().migrate();

    // Every one is still asked about; only the missing ones are added.
    expect(checkedKeys()).toEqual(PROCESS_COLUMNS);
    expect(addedKeys()).toEqual([
      "processPath",
      "processCommandLine",
      "parentProcessName",
      "parentProcessPath",
    ]);
  });

  test("does nothing when every column is already there (boot schema-sync got there first)", async () => {
    for (const key of PROCESS_COLUMNS) {
      existingColumns.add(key);
    }

    await expect(
      new AddProcessColumnsToSecurityEvent().migrate(),
    ).resolves.toBeUndefined();

    expect(checkedKeys()).toEqual(PROCESS_COLUMNS);
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("is idempotent: a second run adds nothing", async () => {
    const migration: AddProcessColumnsToSecurityEvent =
      new AddProcessColumnsToSecurityEvent();

    await migration.migrate();

    expect(addedKeys()).toEqual(PROCESS_COLUMNS);

    await expect(migration.migrate()).resolves.toBeUndefined();

    // Still the six adds of the first run.
    expect(securityEventService.addColumnInDatabase).toHaveBeenCalledTimes(
      PROCESS_COLUMNS.length,
    );
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new AddProcessColumnsToSecurityEvent().migrate(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith(
      "SecurityEventItemV1Local",
    );
    expect(securityEventService.doesColumnExist).not.toHaveBeenCalled();
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("skips a column the model does not declare, with a warning, and still adds the ones it does", async () => {
    hiddenColumnKeys.push("parentProcessPath");

    await expect(
      new AddProcessColumnsToSecurityEvent().migrate(),
    ).resolves.toBeUndefined();

    const declared: Array<string> = PROCESS_COLUMNS.filter(
      (key: string): boolean => {
        return key !== "parentProcessPath";
      },
    );

    // Never asked about, never added: there is no definition to add it from.
    expect(checkedKeys()).toEqual(declared);
    expect(addedKeys()).toEqual(declared);

    expect(
      loggedWarnings.some((message: string): boolean => {
        return (
          message.includes(MIGRATION_NAME) &&
          message.includes("parentProcessPath")
        );
      }),
    ).toBe(true);
  });

  test("does not fail when the model declares none of the columns", async () => {
    hiddenColumnKeys.push(...PROCESS_COLUMNS);

    await expect(
      new AddProcessColumnsToSecurityEvent().migrate(),
    ).resolves.toBeUndefined();

    expect(securityEventService.doesColumnExist).not.toHaveBeenCalled();
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(loggedWarnings).toHaveLength(PROCESS_COLUMNS.length);
  });

  test("a failed add fails the migration and names the column, so the runner retries it on the next run", async () => {
    securityEventService.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(
      new AddProcessColumnsToSecurityEvent().migrate(),
    ).rejects.toThrow(
      "AddProcessColumnsToSecurityEvent: SecurityEventItemV1.processName: TIMEOUT_EXCEEDED",
    );

    // It stops at the first failure rather than pressing on to the next column.
    expect(securityEventService.addColumnInDatabase).toHaveBeenCalledTimes(1);
    expect(checkedKeys()).toEqual(["processName"]);
  });

  test("a failure on a later column names that column", async () => {
    securityEventService.addColumnInDatabase.mockImplementation(((
      column: AnalyticsTableColumn,
    ) => {
      if (column.key === "processCommandLine") {
        return Promise.reject(new Error("UNKNOWN_TABLE"));
      }

      existingColumns.add(column.key);
      return Promise.resolve(undefined);
    }) as never);

    await expect(
      new AddProcessColumnsToSecurityEvent().migrate(),
    ).rejects.toThrow(
      "AddProcessColumnsToSecurityEvent: SecurityEventItemV1.processCommandLine: UNKNOWN_TABLE",
    );

    expect(addedKeys()).toEqual([
      "processName",
      "processPath",
      "processCommandLine",
    ]);
  });

  test("a failed existence check fails the migration too, rather than adding blind", async () => {
    securityEventService.doesColumnExist.mockImplementation(() => {
      return Promise.reject(new Error("NETWORK_ERROR"));
    });

    await expect(
      new AddProcessColumnsToSecurityEvent().migrate(),
    ).rejects.toThrow(
      "AddProcessColumnsToSecurityEvent: SecurityEventItemV1.processName: NETWORK_ERROR",
    );

    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("a failed table check fails the migration", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.reject(new Error("CONNECTION_REFUSED"));
    });

    await expect(
      new AddProcessColumnsToSecurityEvent().migrate(),
    ).rejects.toThrow("CONNECTION_REFUSED");

    expect(securityEventService.doesColumnExist).not.toHaveBeenCalled();
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("rollback drops nothing: the columns hold the process of every event since", async () => {
    await expect(
      new AddProcessColumnsToSecurityEvent().rollback(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).not.toHaveBeenCalled();
    expect(securityEventService.doesColumnExist).not.toHaveBeenCalled();
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(securityEventService.dropColumnInDatabase).not.toHaveBeenCalled();
    expect(securityEventService.execute).not.toHaveBeenCalled();
  });

  test("the migration only adds: it issues no statement of its own", async () => {
    await new AddProcessColumnsToSecurityEvent().migrate();

    expect(securityEventService.execute).not.toHaveBeenCalled();
    expect(securityEventService.dropColumnInDatabase).not.toHaveBeenCalled();
  });

  test("is registered once, before the last slot AddAuditLogMcpClientColumns keeps", () => {
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
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

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
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });
});

describe("the statements the six columns are added with", () => {
  /*
   * SecurityEventService is a stub above, so the DDL itself is rendered here
   * with the real generator from the model's real column definitions: this
   * is the text addColumnInDatabase sends for each of them.
   */
  interface RenderedStatement {
    // The SQL text, whitespace collapsed; identifiers are bound parameters.
    query: string;
    // The values bound to those parameters, in order.
    identifiers: Array<unknown>;
  }

  type GeneratorFunction = () => StatementGenerator<SecurityEvent>;

  const generatorFor: GeneratorFunction =
    (): StatementGenerator<SecurityEvent> => {
      return new StatementGenerator<SecurityEvent>({
        modelType: SecurityEvent,
        database: {
          getDatasourceOptions: (): { database: string } => {
            return { database: "oneuptime" };
          },
        } as unknown as ClickhouseDatabase,
      });
    };

  type RenderFunction = (key: string) => RenderedStatement;

  const WHITESPACE_RUN: RegExp = /\s+/g;

  const render: RenderFunction = (key: string): RenderedStatement => {
    const statement: Statement = generatorFor().toAddColumnStatement(
      columnOf(key),
    );

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

  test.each(PROCESS_COLUMNS)(
    "%s is added as compressed String, IF NOT EXISTS, to the local table on every node",
    (key: string) => {
      const rendered: RenderedStatement = render(key);

      expect(rendered.query).toBe(
        `ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ADD COLUMN IF NOT EXISTS ${key} String CODEC(ZSTD(1))`,
      );
      // The database, then the LOCAL storage table - not the Distributed wrapper.
      expect(rendered.identifiers).toEqual([
        "oneuptime",
        "SecurityEventItemV1Local",
      ]);
    },
  );

  test("the statement follows the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(render("processCommandLine").query).toBe(
      "ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'analytics' ADD COLUMN IF NOT EXISTS processCommandLine String CODEC(ZSTD(1))",
    );
  });

  test("no column builds a skip index: the add stays metadata-only", () => {
    for (const key of SECURITY_EVENT_PROCESS_COLUMN_KEYS) {
      expect(generatorFor().toAddSkipIndexStatement(columnOf(key))).toBeNull();
    }
  });
});
