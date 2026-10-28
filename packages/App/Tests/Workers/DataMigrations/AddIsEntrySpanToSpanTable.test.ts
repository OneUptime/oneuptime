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
 * Spans gained isEntrySpan - a root span, or a SERVER or CONSUMER span -
 * the traces explorer's default list. Its DEFAULT expression is what makes
 * the rows stored before it filter correctly: a part written before the
 * column existed has no file for it, and ClickHouse reads the expression
 * from the row's own isRootSpan and kind. That only holds if the column was
 * added WITH the expression, so what is pinned here:
 *
 *   - the model declares the column as a non-Nullable Bool with that DEFAULT,
 *     and the DDL boot schema-sync and CREATE TABLE send carries it, before
 *     the codec, as one well-formed statement;
 *   - the migration adds the column to the local table (through that same
 *     generator) and to the Distributed wrapper (whose default fills an
 *     INSERT that leaves the column out), and puts the DEFAULT back on a
 *     column that lacks it - with a metadata-only MODIFY, never a rewrite;
 *   - it leaves a column that is already right alone, skips a table that
 *     does not exist, tries both tables before failing and then names the
 *     one that failed;
 *   - it runs on the clustered schema rather than being baselined, rolls
 *     nothing back, and is registered once, above the runbook moves.
 */

jest.mock("Common/Server/Services/SpanService", () => {
  return {
    __esModule: true,
    default: {
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
      default: { tableExists: jest.fn(), getColumnDefault: jest.fn() },
    };
  },
);

import Span from "Common/Models/AnalyticsModels/Span";
import ClickhouseDatabase from "Common/Server/Infrastructure/ClickhouseDatabase";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import SpanService from "Common/Server/Services/SpanService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import { IS_ENTRY_SPAN_DEFAULT_EXPRESSION } from "Common/Utils/Telemetry/EntrySpan";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddIsEntrySpanToSpanTable, {
  ColumnDefault,
  IS_ENTRY_SPAN_COLUMN_KEY,
} from "../../../FeatureSet/Workers/DataMigrations/AddIsEntrySpanToSpanTable";

type MockFunction = ReturnType<typeof jest.fn>;

const spanService: {
  addColumnInDatabase: MockFunction;
  execute: MockFunction;
} = SpanService as unknown as {
  addColumnInDatabase: MockFunction;
  execute: MockFunction;
};

const migrationUtil: {
  tableExists: MockFunction;
  getColumnDefault: MockFunction;
} = ClickHouseMigrationUtil as unknown as {
  tableExists: MockFunction;
  getColumnDefault: MockFunction;
};

const MIGRATION_NAME: string = "AddIsEntrySpanToSpanTable";
const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const LOCAL_TABLE: string = "SpanItemV3Local";
const DISTRIBUTED_TABLE: string = "SpanItemV3";

const EXPRESSION: string =
  "isRootSpan OR (ifNull(kind, '') IN ('SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER'))";

// How ClickHouse reports the column once it has the DEFAULT.
const MODEL_DEFAULT: ColumnDefault = {
  kind: "DEFAULT",
  expression: EXPRESSION,
};

// A column added without one: rows stored before it would read false.
const NO_DEFAULT: ColumnDefault = { kind: "", expression: "" };

const DISTRIBUTED_ADD_STATEMENT: string = `ALTER TABLE SpanItemV3 ON CLUSTER 'oneuptime' ADD COLUMN IF NOT EXISTS isEntrySpan Bool DEFAULT ${EXPRESSION}`;

const SET_DEFAULT_STATEMENT: (table: string) => string = (
  table: string,
): string => {
  return `ALTER TABLE ${table} ON CLUSTER 'oneuptime' MODIFY COLUMN isEntrySpan DEFAULT ${EXPRESSION}`;
};

let savedClusterName: string | undefined;
let missingTables: Set<string>;
let columnDefaults: Map<string, ColumnDefault | null>;
let failingTables: Map<string, Error>;
let loggedWarnings: Array<string>;

function executedStatements(): Array<string> {
  return spanService.execute.mock.calls.map((call: Array<unknown>): string => {
    return call[0] as string;
  });
}

function addedColumnKeys(): Array<string> {
  return spanService.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
}

function entrySpanColumn(): AnalyticsTableColumn {
  const column: AnalyticsTableColumn | undefined =
    AddIsEntrySpanToSpanTable.getColumn(new Span());

  expect(column).toBeDefined();

  return column!;
}

function generator(): StatementGenerator<Span> {
  return new StatementGenerator<Span>({
    modelType: Span,
    database: {
      getDatasourceOptions: (): { database: string } => {
        return { database: "oneuptime" };
      },
    } as unknown as ClickhouseDatabase,
  });
}

const WHITESPACE_RUN: RegExp = /\s+/g;

function collapse(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

// The SQL is one statement: balanced parentheses and quotes, no `;`.
function expectWellFormed(sql: string): void {
  expect(sql).not.toContain(";");
  expect(sql.split("'").length % 2).toBe(1);

  let depth: number = 0;
  for (const character of sql.replace(/'[^']*'/g, "''")) {
    if (character === "(") {
      depth++;
    }
    if (character === ")") {
      depth--;
    }
    expect(depth).toBeGreaterThanOrEqual(0);
  }
  expect(depth).toBe(0);
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  missingTables = new Set<string>();
  columnDefaults = new Map<string, ColumnDefault | null>([
    [LOCAL_TABLE, null],
    [DISTRIBUTED_TABLE, null],
  ]);
  failingTables = new Map<string, Error>();
  loggedWarnings = [];

  spanService.addColumnInDatabase.mockReset();
  spanService.execute.mockReset();
  migrationUtil.tableExists.mockReset();
  migrationUtil.getColumnDefault.mockReset();

  migrationUtil.tableExists.mockImplementation(((table: string) => {
    return Promise.resolve(!missingTables.has(table));
  }) as never);
  migrationUtil.getColumnDefault.mockImplementation(((table: string) => {
    const failure: Error | undefined = failingTables.get(table);
    if (failure) {
      return Promise.reject(failure);
    }
    return Promise.resolve(columnDefaults.get(table) ?? null);
  }) as never);
  // Adding the column makes it exist, with the model's DEFAULT.
  spanService.addColumnInDatabase.mockImplementation((() => {
    columnDefaults.set(LOCAL_TABLE, MODEL_DEFAULT);
    return Promise.resolve(undefined);
  }) as never);
  spanService.execute.mockImplementation(((statement: string) => {
    const table: string = statement.split(" ")[2] || "";
    columnDefaults.set(table, MODEL_DEFAULT);
    return Promise.resolve(undefined);
  }) as never);

  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
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

  jest.restoreAllMocks();
});

describe("the isEntrySpan column the model declares", () => {
  test("a non-Nullable Bool, defaulting to its expression over isRootSpan and kind", () => {
    const column: AnalyticsTableColumn = entrySpanColumn();

    expect(column.key).toBe(IS_ENTRY_SPAN_COLUMN_KEY);
    expect(column.type).toBe(TableColumnType.Boolean);
    expect(column.required).toBe(true);
    expect(column.defaultExpression).toBe(IS_ENTRY_SPAN_DEFAULT_EXPRESSION);
    expect(column.defaultExpression).toBe(EXPRESSION);
  });

  test("the expression reads only columns the span table has, of the types it assumes", () => {
    const columns: Array<AnalyticsTableColumn> = new Span().tableColumns;
    const byKey: (key: string) => AnalyticsTableColumn | undefined = (
      key: string,
    ): AnalyticsTableColumn | undefined => {
      return columns.find((column: AnalyticsTableColumn): boolean => {
        return column.key === key;
      });
    };

    // A non-Nullable Bool, and a Nullable String (which ifNull covers).
    expect(byKey("isRootSpan")?.type).toBe(TableColumnType.Boolean);
    expect(byKey("isRootSpan")?.required).toBe(true);
    expect(byKey("kind")?.type).toBe(TableColumnType.Text);
    expect(byKey("kind")?.required).toBe(false);
  });

  test("its permissions are isRootSpan's: read by everyone who reads spans, written only by ingest", () => {
    const columns: Array<AnalyticsTableColumn> = new Span().tableColumns;
    const isRootSpan: AnalyticsTableColumn | undefined = columns.find(
      (column: AnalyticsTableColumn): boolean => {
        return column.key === "isRootSpan";
      },
    );

    expect(entrySpanColumn().accessControl).toEqual(isRootSpan?.accessControl);
  });

  test("ADD COLUMN, as boot schema-sync sends it, carries the DEFAULT on the local table of every node", () => {
    const statement: Statement =
      generator().toAddColumnStatement(entrySpanColumn());
    const sql: string = collapse(statement.query);

    expect(sql).toBe(
      `ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ADD COLUMN IF NOT EXISTS isEntrySpan Bool DEFAULT ${EXPRESSION}`,
    );
    expect(Object.values(statement.query_params)).toEqual([
      "oneuptime",
      LOCAL_TABLE,
    ]);
    expectWellFormed(sql);
  });

  test("CREATE TABLE writes the column with its DEFAULT, so a fresh install reads the same", () => {
    const sql: string = collapse(generator().toTableCreateStatement().query);

    expect(sql).toContain(`isEntrySpan Bool DEFAULT ${EXPRESSION},`);
    // isRootSpan still has none: it is written for every row.
    expect(sql).toContain("isRootSpan Bool,");
  });

  test("the DEFAULT comes after the type and before a codec", () => {
    const column: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "derived",
      title: "Derived",
      description: "",
      required: true,
      type: TableColumnType.Boolean,
      defaultExpression: "isRootSpan",
      codec: { codec: "ZSTD", level: 1 },
    });

    expect(collapse(generator().toAddColumnStatement(column).query)).toMatch(
      / ADD COLUMN IF NOT EXISTS derived Bool DEFAULT isRootSpan CODEC\(ZSTD\(1\)\)$/,
    );
  });

  test("a column without a DEFAULT expression is written exactly as before", () => {
    const column: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "plain",
      title: "Plain",
      description: "",
      required: true,
      type: TableColumnType.Boolean,
      defaultValue: false,
    });

    expect(collapse(generator().toAddColumnStatement(column).query)).toMatch(
      / ADD COLUMN IF NOT EXISTS plain Bool$/,
    );
  });

  test("an empty DEFAULT, or one that carries a second statement, is refused", () => {
    for (const defaultExpression of ["", "   ", "1; DROP TABLE SpanItemV3"]) {
      const column: AnalyticsTableColumn = new AnalyticsTableColumn({
        key: "broken",
        title: "Broken",
        description: "",
        required: true,
        type: TableColumnType.Boolean,
        defaultExpression,
      });

      expect(() => {
        return generator().toAddColumnStatement(column);
      }).toThrow("Column broken has an invalid default expression.");
    }
  });

  test("its skip index is isRootSpan's: a set of the two values", () => {
    expect(entrySpanColumn().skipIndex).toEqual({
      name: "idx_is_entry_span",
      type: "set",
      params: [2],
      granularity: 4,
    });
  });
});

describe(MIGRATION_NAME, () => {
  test("has a stable name: the runner records migrations by name, so renaming it would run it again", () => {
    const migration: AddIsEntrySpanToSpanTable =
      new AddIsEntrySpanToSpanTable();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("runs on the clustered schema instead of being baselined", () => {
    expect(new AddIsEntrySpanToSpanTable().runsInClusterMode()).toBe(true);
  });

  test("the statements it writes itself are single, well-formed, ON CLUSTER and metadata-only", () => {
    const column: AnalyticsTableColumn = entrySpanColumn();
    const statements: Array<string> = [
      AddIsEntrySpanToSpanTable.getDistributedAddColumnStatement(
        new Span(),
        column,
      ),
      AddIsEntrySpanToSpanTable.getSetDefaultStatement(LOCAL_TABLE, column),
      AddIsEntrySpanToSpanTable.getSetDefaultStatement(
        DISTRIBUTED_TABLE,
        column,
      ),
    ];

    expect(statements).toEqual([
      DISTRIBUTED_ADD_STATEMENT,
      SET_DEFAULT_STATEMENT(LOCAL_TABLE),
      SET_DEFAULT_STATEMENT(DISTRIBUTED_TABLE),
    ]);

    for (const statement of statements) {
      expectWellFormed(statement);
      // Nothing that drops, rewrites or waits on data.
      expect(statement).not.toMatch(
        /DROP|DELETE|UPDATE|MATERIALIZE|CLEAR|SETTINGS/,
      );
    }
  });

  test("the statements follow the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(
      AddIsEntrySpanToSpanTable.getSetDefaultStatement(
        LOCAL_TABLE,
        entrySpanColumn(),
      ),
    ).toBe(
      `ALTER TABLE ${LOCAL_TABLE} ON CLUSTER 'analytics' MODIFY COLUMN isEntrySpan DEFAULT ${EXPRESSION}`,
    );
  });

  test("adds the column to the local table through the model's own DDL, and to the Distributed wrapper", async () => {
    await new AddIsEntrySpanToSpanTable().migrate();

    expect(addedColumnKeys()).toEqual([IS_ENTRY_SPAN_COLUMN_KEY]);
    expect(spanService.addColumnInDatabase.mock.calls[0]![0]).toBeInstanceOf(
      AnalyticsTableColumn,
    );
    expect(
      (
        spanService.addColumnInDatabase.mock
          .calls[0]![0] as AnalyticsTableColumn
      ).defaultExpression,
    ).toBe(EXPRESSION);

    expect(executedStatements()).toEqual([DISTRIBUTED_ADD_STATEMENT]);
    expect(spanService.execute.mock.calls[0]![1]).toBe(MigrationExecuteOptions);

    // The local table first, then its wrapper.
    expect(
      migrationUtil.tableExists.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([LOCAL_TABLE, DISTRIBUTED_TABLE]);
  });

  test("does nothing when boot schema-sync already added it with its DEFAULT", async () => {
    columnDefaults.set(LOCAL_TABLE, MODEL_DEFAULT);
    columnDefaults.set(DISTRIBUTED_TABLE, MODEL_DEFAULT);

    await expect(
      new AddIsEntrySpanToSpanTable().migrate(),
    ).resolves.toBeUndefined();

    expect(spanService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(spanService.execute).not.toHaveBeenCalled();
  });

  test("takes ClickHouse's own formatting of the expression for the model's", async () => {
    columnDefaults.set(LOCAL_TABLE, {
      kind: "DEFAULT",
      expression:
        "(isRootSpan OR (ifNull(kind, '') IN ('SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER')))",
    });
    columnDefaults.set(DISTRIBUTED_TABLE, {
      kind: "DEFAULT",
      expression:
        "isRootSpan OR (ifNull(kind,'') IN ('SPAN_KIND_SERVER','SPAN_KIND_CONSUMER'))",
    });

    await new AddIsEntrySpanToSpanTable().migrate();

    expect(spanService.execute).not.toHaveBeenCalled();
  });

  test("puts the DEFAULT back on a column added without one, on both tables", async () => {
    columnDefaults.set(LOCAL_TABLE, NO_DEFAULT);
    columnDefaults.set(DISTRIBUTED_TABLE, NO_DEFAULT);

    await new AddIsEntrySpanToSpanTable().migrate();

    expect(spanService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(executedStatements()).toEqual([
      SET_DEFAULT_STATEMENT(LOCAL_TABLE),
      SET_DEFAULT_STATEMENT(DISTRIBUTED_TABLE),
    ]);
  });

  test("replaces a DEFAULT that is not the model's, and a MATERIALIZED one", async () => {
    columnDefaults.set(LOCAL_TABLE, { kind: "DEFAULT", expression: "false" });
    columnDefaults.set(DISTRIBUTED_TABLE, {
      kind: "MATERIALIZED",
      expression: EXPRESSION,
    });

    await new AddIsEntrySpanToSpanTable().migrate();

    expect(executedStatements()).toEqual([
      SET_DEFAULT_STATEMENT(LOCAL_TABLE),
      SET_DEFAULT_STATEMENT(DISTRIBUTED_TABLE),
    ]);
  });

  test("is idempotent: a second run issues nothing", async () => {
    const migration: AddIsEntrySpanToSpanTable =
      new AddIsEntrySpanToSpanTable();

    await migration.migrate();
    const firstRun: number =
      spanService.execute.mock.calls.length +
      spanService.addColumnInDatabase.mock.calls.length;

    await migration.migrate();

    expect(
      spanService.execute.mock.calls.length +
        spanService.addColumnInDatabase.mock.calls.length,
    ).toBe(firstRun);
  });

  test("skips a table that does not exist yet, and still covers the other", async () => {
    missingTables.add(LOCAL_TABLE);

    await expect(
      new AddIsEntrySpanToSpanTable().migrate(),
    ).resolves.toBeUndefined();

    expect(spanService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(executedStatements()).toEqual([DISTRIBUTED_ADD_STATEMENT]);
  });

  test("tries both tables before failing, then fails naming the one that failed", async () => {
    failingTables.set(LOCAL_TABLE, new Error("TIMEOUT_EXCEEDED"));

    await expect(new AddIsEntrySpanToSpanTable().migrate()).rejects.toThrow(
      "AddIsEntrySpanToSpanTable: could not add isEntrySpan on SpanItemV3Local: TIMEOUT_EXCEEDED",
    );

    // The wrapper was still covered.
    expect(executedStatements()).toEqual([DISTRIBUTED_ADD_STATEMENT]);
  });

  test("a failed add fails the migration too, so the runner tries again", async () => {
    spanService.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("UNKNOWN_TABLE"));
    });

    await expect(new AddIsEntrySpanToSpanTable().migrate()).rejects.toThrow(
      "SpanItemV3Local: UNKNOWN_TABLE",
    );
  });

  test("rollback drops nothing: the column holds what ingest wrote since", async () => {
    await expect(
      new AddIsEntrySpanToSpanTable().rollback(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).not.toHaveBeenCalled();
    expect(spanService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(spanService.execute).not.toHaveBeenCalled();
  });

  test("never warns on a normal run", async () => {
    await new AddIsEntrySpanToSpanTable().migrate();

    expect(loggedWarnings).toEqual([]);
  });

  test("is registered once, above the runbook moves that keep the last slots", () => {
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
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.indexOf("MoveRunbookApprovalsBeforeTheirSteps"),
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });
});
