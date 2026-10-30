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
 * An exception's occurrence gained the column that names the user it
 * happened to: ExceptionInstance.userId, the one the exceptions list counts
 * as each row's affected users. Ingest writes it on every occurrence, and an
 * insert that names a column the table does not have is refused - so until
 * the column exists, no exception occurrence would be stored at all.
 *
 * This migration is the non-cluster path's way of getting it there. What is
 * pinned:
 *
 *   - it adds exactly that column, as the model declares it (String DEFAULT
 *     '', so every row stored before reads "names no user"), with no skip
 *     index, so the add is metadata-only;
 *   - it is idempotent: a column that is already there is left alone;
 *   - it never halts the migration chain over a table that does not exist
 *     yet or a column the model does not declare;
 *   - a real failure IS a failure, and names the column;
 *   - it is baselined on the clustered schema (boot schema-sync adds the
 *     column there), its rollback drops nothing, and it sits above the
 *     runbook moves, before the last slot.
 */

jest.mock("Common/Server/Services/ExceptionInstanceService", () => {
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
 * The real ExceptionInstance model, with a switch to hide columns from it:
 * the only way to show what the migration does about a column the model does
 * not declare without editing the model.
 */
jest.mock("Common/Models/AnalyticsModels/ExceptionInstance", () => {
  type ColumnLike = { key: string };
  type ModelLike = { tableColumns: Array<ColumnLike> };

  const actual: { default: new () => ModelLike } = jest.requireActual(
    "Common/Models/AnalyticsModels/ExceptionInstance",
  ) as { default: new () => ModelLike };

  const hiddenColumnKeys: Array<string> = [];

  class ExceptionInstanceWithHiddenColumns extends actual.default {
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
    default: ExceptionInstanceWithHiddenColumns,
    hiddenColumnKeys,
  };
});

import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ClickhouseDatabase from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddUserIdToExceptionInstance, {
  EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY,
} from "../../../FeatureSet/Workers/DataMigrations/AddUserIdToExceptionInstance";

type MockFunction = ReturnType<typeof jest.fn>;

interface ServiceMock {
  doesColumnExist: MockFunction;
  addColumnInDatabase: MockFunction;
  dropColumnInDatabase: MockFunction;
  execute: MockFunction;
}

const service: ServiceMock = ExceptionInstanceService as unknown as ServiceMock;

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const hiddenColumnKeys: Array<string> = (
  jest.requireMock("Common/Models/AnalyticsModels/ExceptionInstance") as {
    hiddenColumnKeys: Array<string>;
  }
).hiddenColumnKeys;

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

let savedClusterName: string | undefined;
let existingColumns: Set<string>;
let loggedWarnings: Array<string>;

function userIdColumn(): AnalyticsTableColumn {
  const column: AnalyticsTableColumn | undefined =
    new ExceptionInstance().tableColumns.find(
      (item: AnalyticsTableColumn): boolean => {
        return item.key === "userId";
      },
    );

  expect(column).toBeDefined();

  return column!;
}

function addedKeys(): Array<string> {
  return service.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  hiddenColumnKeys.length = 0;
  existingColumns = new Set<string>();
  loggedWarnings = [];

  service.doesColumnExist.mockReset();
  service.addColumnInDatabase.mockReset();
  service.dropColumnInDatabase.mockReset();
  service.execute.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  service.doesColumnExist.mockImplementation(((key: string) => {
    return Promise.resolve(existingColumns.has(key));
  }) as never);
  service.addColumnInDatabase.mockImplementation(((
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

describe("AddUserIdToExceptionInstance", () => {
  test("has a stable name: the runner records migrations by name", () => {
    const migration: AddUserIdToExceptionInstance =
      new AddUserIdToExceptionInstance();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe("AddUserIdToExceptionInstance");
  });

  test("is baselined on the clustered schema, where boot schema-sync adds the column", () => {
    expect(new AddUserIdToExceptionInstance().runsInClusterMode()).toBe(false);
  });

  test("the column is a required String with a '' default and no skip index", () => {
    expect(EXCEPTION_INSTANCE_USER_ID_COLUMN_KEY).toBe("userId");

    const column: AnalyticsTableColumn = userIdColumn();

    expect(column.type).toBe(TableColumnType.Text);
    expect(column.required).toBe(true);
    expect(column.defaultValue).toBe("");
    expect(column.skipIndex).toBeUndefined();
    // Read by whoever may read the occurrence, as its session id is.
    expect(column.accessControl).toEqual(
      new ExceptionInstance().tableColumns.find(
        (item: AnalyticsTableColumn): boolean => {
          return item.key === "sessionId";
        },
      )!.accessControl,
    );
  });

  test("adds the column to the storage table when it does not exist", async () => {
    await new AddUserIdToExceptionInstance().migrate();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith(
      `${new ExceptionInstance().tableName}Local`,
    );
    expect(addedKeys()).toEqual(["userId"]);
    // The model's own definition, not a copy made here.
    expect(service.addColumnInDatabase.mock.calls[0]![0]).toBeInstanceOf(
      AnalyticsTableColumn,
    );
  });

  test("is idempotent: a column already there is left alone, and a second run adds nothing", async () => {
    await new AddUserIdToExceptionInstance().migrate();
    await new AddUserIdToExceptionInstance().migrate();

    expect(addedKeys()).toEqual(["userId"]);
  });

  test("a table that does not exist yet is skipped, not thrown over", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new AddUserIdToExceptionInstance().migrate(),
    ).resolves.toBeUndefined();
    expect(service.doesColumnExist).not.toHaveBeenCalled();
    expect(service.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("a model that does not declare the column is skipped with a warning, so the chain goes on", async () => {
    hiddenColumnKeys.push("userId");

    await expect(
      new AddUserIdToExceptionInstance().migrate(),
    ).resolves.toBeUndefined();
    expect(service.addColumnInDatabase).not.toHaveBeenCalled();
    expect(loggedWarnings.join("\n")).toContain("does not declare userId");
  });

  test("a real failure fails the migration and names the column", async () => {
    service.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("TOO_MANY_PARTS"));
    });

    await expect(new AddUserIdToExceptionInstance().migrate()).rejects.toThrow(
      `AddUserIdToExceptionInstance: ${new ExceptionInstance().tableName}.userId: TOO_MANY_PARTS`,
    );
  });

  test("rollback drops nothing: the column holds who every occurrence since happened to", async () => {
    await expect(
      new AddUserIdToExceptionInstance().rollback(),
    ).resolves.toBeUndefined();

    expect(service.dropColumnInDatabase).not.toHaveBeenCalled();
    expect(service.execute).not.toHaveBeenCalled();
  });

  test("is registered once, above the runbook moves, before the last slot", () => {
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
      'import AddUserIdToExceptionInstance from "./AddUserIdToExceptionInstance";',
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === "AddUserIdToExceptionInstance";
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf("AddUserIdToExceptionInstance")).toBeLessThan(
      registered.indexOf("MoveRunbookApprovalsBeforeTheirSteps"),
    );
  });
});

describe("the statement the column is added with", () => {
  /*
   * A non-Nullable String: every row stored before the column existed reads
   * the type's own default, '' - names no user.
   */
  test("ADD COLUMN IF NOT EXISTS userId String, compressed, on the local table of every node", () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });

    const generator: StatementGenerator<ExceptionInstance> =
      new StatementGenerator<ExceptionInstance>({
        modelType: ExceptionInstance,
        database: {
          getDatasourceOptions: (): { database: string } => {
            return { database: "oneuptime" };
          },
        } as unknown as ClickhouseDatabase,
      });

    const statement: Statement = generator.toAddColumnStatement(userIdColumn());
    const query: string = statement.query.replace(/\s+/g, " ").trim();

    expect(query).toBe(
      "ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ADD COLUMN IF NOT EXISTS userId String CODEC(ZSTD(1))",
    );
    expect(Object.values(statement.query_params)).toEqual([
      "oneuptime",
      `${new ExceptionInstance().tableName}Local`,
    ]);
    expect(generator.toAddSkipIndexStatement(userIdColumn())).toBeNull();
  });
});
