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
 * Security events gained four columns that say which request an event
 * happened in and how far that request got: traceId, spanId, sessionId and
 * requestOutcome on SecurityEvent. The log scan writes them on every row, and
 * an insert that names a column the table does not have is refused - so until
 * the columns exist, no security event at all would be stored.
 *
 * This migration is the non-cluster path's way of getting them there. What
 * is pinned:
 *
 *   - it adds exactly the four columns, as the model declares them (String
 *     with a '' default, so every row written before reads "not part of a
 *     request OneUptime followed"), the outcome as LowCardinality;
 *   - the trace and session ids carry bloom-filter indexes, added beside
 *     them, so the trace, log and session pages find their events cheaply;
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
import AnalyticsTableColumn, {
  SkipIndexType,
} from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddRequestColumnsToSecurityEvent, {
  SECURITY_EVENT_REQUEST_COLUMN_KEYS,
} from "../../../FeatureSet/Workers/DataMigrations/AddRequestColumnsToSecurityEvent";

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

const MIGRATION_NAME: string = "AddRequestColumnsToSecurityEvent";
const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const REQUEST_COLUMNS: Array<string> = [
  "traceId",
  "spanId",
  "sessionId",
  "requestOutcome",
];

// The columns a page looks events up by, and so indexed.
const INDEXED_COLUMNS: Array<string> = ["traceId", "sessionId"];

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

describe("AddRequestColumnsToSecurityEvent", () => {
  test("has a stable name: the runner records migrations by name, so renaming it would run it again", () => {
    const migration: AddRequestColumnsToSecurityEvent =
      new AddRequestColumnsToSecurityEvent();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("is baselined on the clustered schema, where boot schema-sync adds the columns", () => {
    expect(new AddRequestColumnsToSecurityEvent().runsInClusterMode()).toBe(
      false,
    );
  });

  test("adds exactly the four request columns, and the model declares every one", () => {
    expect([...SECURITY_EVENT_REQUEST_COLUMN_KEYS]).toEqual(REQUEST_COLUMNS);

    const declared: Array<string> = new SecurityEvent().tableColumns.map(
      (column: AnalyticsTableColumn): string => {
        return column.key;
      },
    );

    for (const key of SECURITY_EVENT_REQUEST_COLUMN_KEYS) {
      expect(declared).toContain(key);
    }

    expect(new SecurityEvent().tableName).toBe("SecurityEventItemV1");
  });

  test.each(REQUEST_COLUMNS)(
    "%s is text with a '' default, so rows written before read 'not part of a request OneUptime followed'",
    (key: string) => {
      const column: AnalyticsTableColumn = columnOf(key);

      expect(column.type).toBe(TableColumnType.Text);
      expect(column.required).toBe(true);
      expect(column.defaultValue).toBe("");
    },
  );

  test("the trace and session ids are bloom-indexed; the span id and the outcome are not", () => {
    for (const key of REQUEST_COLUMNS) {
      const column: AnalyticsTableColumn = columnOf(key);

      if (INDEXED_COLUMNS.includes(key)) {
        expect(column.skipIndex?.type).toBe(SkipIndexType.BloomFilter);
      } else {
        expect(column.skipIndex).toBeUndefined();
      }
    }
  });

  test("the outcome is one of four words, so it is stored LowCardinality", () => {
    expect(columnOf("requestOutcome").isLowCardinality).toBe(true);
    expect(columnOf("traceId").isLowCardinality).toBeFalsy();
  });

  test("adds all four columns to the storage table when none exists", async () => {
    await new AddRequestColumnsToSecurityEvent().migrate();

    // The columns live on the local storage table, not the Distributed wrapper.
    expect(migrationUtil.tableExists).toHaveBeenCalledTimes(1);
    expect(migrationUtil.tableExists).toHaveBeenCalledWith(
      "SecurityEventItemV1Local",
    );

    expect(checkedKeys()).toEqual(REQUEST_COLUMNS);
    expect(addedKeys()).toEqual(REQUEST_COLUMNS);
  });

  test("hands the service the model's own column definitions, not copies made here", async () => {
    await new AddRequestColumnsToSecurityEvent().migrate();

    const added: Array<AnalyticsTableColumn> =
      securityEventService.addColumnInDatabase.mock.calls.map(
        (call: Array<unknown>): AnalyticsTableColumn => {
          return call[0] as AnalyticsTableColumn;
        },
      );

    expect(added).toHaveLength(REQUEST_COLUMNS.length);

    for (const column of added) {
      expect(column).toBeInstanceOf(AnalyticsTableColumn);

      const declared: AnalyticsTableColumn = columnOf(column.key);

      expect(column.type).toBe(declared.type);
      expect(column.required).toBe(declared.required);
      expect(column.title).toBe(declared.title);
    }
  });

  test("leaves the columns that are already there alone, and still adds the others", async () => {
    existingColumns.add("traceId");
    existingColumns.add("requestOutcome");

    await new AddRequestColumnsToSecurityEvent().migrate();

    // Every one is still asked about; only the missing ones are added.
    expect(checkedKeys()).toEqual(REQUEST_COLUMNS);
    expect(addedKeys()).toEqual(["spanId", "sessionId"]);
  });

  test("does nothing when every column is already there (boot schema-sync got there first)", async () => {
    for (const key of REQUEST_COLUMNS) {
      existingColumns.add(key);
    }

    await expect(
      new AddRequestColumnsToSecurityEvent().migrate(),
    ).resolves.toBeUndefined();

    expect(checkedKeys()).toEqual(REQUEST_COLUMNS);
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("is idempotent: a second run adds nothing", async () => {
    const migration: AddRequestColumnsToSecurityEvent =
      new AddRequestColumnsToSecurityEvent();

    await migration.migrate();

    expect(addedKeys()).toEqual(REQUEST_COLUMNS);

    await expect(migration.migrate()).resolves.toBeUndefined();

    // Still the four adds of the first run.
    expect(securityEventService.addColumnInDatabase).toHaveBeenCalledTimes(
      REQUEST_COLUMNS.length,
    );
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new AddRequestColumnsToSecurityEvent().migrate(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith(
      "SecurityEventItemV1Local",
    );
    expect(securityEventService.doesColumnExist).not.toHaveBeenCalled();
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("skips a column the model does not declare, with a warning, and still adds the ones it does", async () => {
    hiddenColumnKeys.push("sessionId");

    await expect(
      new AddRequestColumnsToSecurityEvent().migrate(),
    ).resolves.toBeUndefined();

    const declared: Array<string> = REQUEST_COLUMNS.filter(
      (key: string): boolean => {
        return key !== "sessionId";
      },
    );

    // Never asked about, never added: there is no definition to add it from.
    expect(checkedKeys()).toEqual(declared);
    expect(addedKeys()).toEqual(declared);

    expect(
      loggedWarnings.some((message: string): boolean => {
        return (
          message.includes(MIGRATION_NAME) && message.includes("sessionId")
        );
      }),
    ).toBe(true);
  });

  test("does not fail when the model declares none of the columns", async () => {
    hiddenColumnKeys.push(...REQUEST_COLUMNS);

    await expect(
      new AddRequestColumnsToSecurityEvent().migrate(),
    ).resolves.toBeUndefined();

    expect(securityEventService.doesColumnExist).not.toHaveBeenCalled();
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(loggedWarnings).toHaveLength(REQUEST_COLUMNS.length);
  });

  test("a failed add fails the migration and names the column, so the runner retries it on the next run", async () => {
    securityEventService.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(
      new AddRequestColumnsToSecurityEvent().migrate(),
    ).rejects.toThrow(
      "AddRequestColumnsToSecurityEvent: SecurityEventItemV1.traceId: TIMEOUT_EXCEEDED",
    );

    // It stops at the first failure rather than pressing on to the next column.
    expect(securityEventService.addColumnInDatabase).toHaveBeenCalledTimes(1);
    expect(checkedKeys()).toEqual(["traceId"]);
  });

  test("a failure on a later column names that column", async () => {
    securityEventService.addColumnInDatabase.mockImplementation(((
      column: AnalyticsTableColumn,
    ) => {
      if (column.key === "sessionId") {
        return Promise.reject(new Error("UNKNOWN_TABLE"));
      }

      existingColumns.add(column.key);
      return Promise.resolve(undefined);
    }) as never);

    await expect(
      new AddRequestColumnsToSecurityEvent().migrate(),
    ).rejects.toThrow(
      "AddRequestColumnsToSecurityEvent: SecurityEventItemV1.sessionId: UNKNOWN_TABLE",
    );

    expect(addedKeys()).toEqual(["traceId", "spanId", "sessionId"]);
  });

  test("a failed existence check fails the migration too, rather than adding blind", async () => {
    securityEventService.doesColumnExist.mockImplementation(() => {
      return Promise.reject(new Error("NETWORK_ERROR"));
    });

    await expect(
      new AddRequestColumnsToSecurityEvent().migrate(),
    ).rejects.toThrow(
      "AddRequestColumnsToSecurityEvent: SecurityEventItemV1.traceId: NETWORK_ERROR",
    );

    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("a failed table check fails the migration", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.reject(new Error("CONNECTION_REFUSED"));
    });

    await expect(
      new AddRequestColumnsToSecurityEvent().migrate(),
    ).rejects.toThrow("CONNECTION_REFUSED");

    expect(securityEventService.doesColumnExist).not.toHaveBeenCalled();
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("rollback drops nothing: the columns hold the request of every event since", async () => {
    await expect(
      new AddRequestColumnsToSecurityEvent().rollback(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).not.toHaveBeenCalled();
    expect(securityEventService.doesColumnExist).not.toHaveBeenCalled();
    expect(securityEventService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(securityEventService.dropColumnInDatabase).not.toHaveBeenCalled();
    expect(securityEventService.execute).not.toHaveBeenCalled();
  });

  test("the migration only adds: it issues no statement of its own", async () => {
    await new AddRequestColumnsToSecurityEvent().migrate();

    expect(securityEventService.execute).not.toHaveBeenCalled();
    expect(securityEventService.dropColumnInDatabase).not.toHaveBeenCalled();
  });

  test("is registered once, above the runbook moves that keep their places before the last slot", () => {
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
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.indexOf("MoveRunbookApprovalsBeforeTheirSteps"),
    );
  });
});

describe("the statements the four columns are added with", () => {
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

  test.each(["traceId", "spanId", "sessionId"])(
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

  test("the outcome is added as LowCardinality(String)", () => {
    const rendered: RenderedStatement = render("requestOutcome");

    expect(rendered.query).toContain(
      "ADD COLUMN IF NOT EXISTS requestOutcome LowCardinality(String)",
    );
    expect(rendered.identifiers).toEqual([
      "oneuptime",
      "SecurityEventItemV1Local",
    ]);
  });

  test("the statement follows the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(render("traceId").query).toBe(
      "ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'analytics' ADD COLUMN IF NOT EXISTS traceId String CODEC(ZSTD(1))",
    );
  });

  test("the trace and session ids each build a bloom-filter index, without materializing it", () => {
    for (const key of REQUEST_COLUMNS) {
      const statement: Statement | null =
        generatorFor().toAddSkipIndexStatement(columnOf(key));

      if (!INDEXED_COLUMNS.includes(key)) {
        expect(statement).toBeNull();
        continue;
      }

      const query: string = statement!.query.replace(WHITESPACE_RUN, " ");

      expect(query).toContain("ADD INDEX IF NOT EXISTS");
      expect(query).toContain("bloom_filter");
      expect(query).not.toContain("MATERIALIZE");
    }
  });
});
