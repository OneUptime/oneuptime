import StoredLogScreenshots, {
  CANDIDATE_MIN_STORED_BYTES,
  CLEAR_TIME_BUDGET_MS,
  CURSOR_CACHE_NAMESPACE,
  CURSOR_EXPIRES_IN_DAYS,
  DEFAULT_LIMITS,
  DONE_MARKER_PREFIX,
  READ_BATCH_MAX_STORED_BYTES,
  READ_BATCH_SIZE,
  SCAN_PAGE_SIZE,
  STORED_LOG_COLUMNS,
  STORED_LOG_TABLES,
  StoredLogCandidate,
  StoredLogScreenshotsStatement,
  StoredLogScreenshotsSummary,
  StoredLogTable,
  StoredLogTableResult,
  buildClearLogStatement,
  buildDoneMarkersStatement,
  buildPageCandidatesStatement,
  buildPageEndStatement,
  buildReadLogsStatement,
  formatStoredBytes,
  getDoneMarkerName,
  toReadBatches,
} from "../../../../Server/Utils/Retention/StoredLogScreenshots";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import DataMigrationService from "../../../../Server/Services/DataMigrationService";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import DataMigration from "../../../../Models/DatabaseModels/DataMigration";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import StateChangeLogScreenshots, {
  SCREENSHOTS_OMITTED_FIELD,
} from "../../../../Utils/Monitor/StateChangeLogScreenshots";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { TableMetadataArgs } from "typeorm/metadata-args/TableMetadataArgs";

/*
 * CLEARING THE SCREENSHOTS STORED LOGS KEPT (issues #6903, #6942):
 * Server/Utils/Retention/StoredLogScreenshots, which the Workers job
 * Monitor:ClearStoredLogScreenshots runs every hour until every table is
 * done.
 *
 * Here, without a database: the statements it reads and writes with -
 * exactly, and that nothing a caller gives is written into their text - and
 * how a run walks the tables, pages and read batches, over an in-memory
 * stand-in that answers its statements: what it clears and what it leaves
 * untouched, where a walk keeps where it got to, when a table is done, the
 * time budget, and what a failure does. What the statements do to real rows
 * is StoredLogScreenshotsPostgres.test.ts's, against a migrated Postgres.
 */

const ALL_TABLES: Array<StoredLogTable> = [
  StoredLogTable.IncidentStateTimeline,
  StoredLogTable.AlertStateTimeline,
  StoredLogTable.Alert,
  StoredLogTable.Incident,
  StoredLogTable.MonitorStatusTimeline,
];

const PREFIX_BY_TABLE: Record<StoredLogTable, string> = {
  [StoredLogTable.IncidentStateTimeline]: "a6942001",
  [StoredLogTable.AlertStateTimeline]: "a6942002",
  [StoredLogTable.Alert]: "a6942003",
  [StoredLogTable.Incident]: "a6942004",
  [StoredLogTable.MonitorStatusTimeline]: "a6942005",
};

// A valid id, told apart by its number: rowId(table, 7) is ...-000000000007.
function rowId(table: StoredLogTable, n: number): string {
  return `${PREFIX_BY_TABLE[table]}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

// Whitespace folded, so a statement is read as words.
function words(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function screenshot(seed: string, bytes: number = 16 * 1024): string {
  return `iVBORw0KGgoAAAANSUhEUgAA${seed}`.padEnd(bytes, "A");
}

// A Synthetic monitor's check, as the services kept it before #6940.
function syntheticLog(seed: string, bytes: number = 16 * 1024): JSONObject {
  return {
    monitorId: "6f000000-0000-4000-8000-000000000001",
    isOnline: false,
    failureCause: "The checkout page did not load.",
    syntheticMonitorResponse: [
      {
        browserType: "Chromium",
        screenSizeType: "Desktop",
        executionTimeInMS: 5120,
        logMessages: [`Opened the checkout page (${seed})`],
        scriptError: "Timeout 30000ms exceeded.",
        result: { step: "checkout", ok: false },
        screenshots: {
          "checkout-page": screenshot(`${seed}-1`, bytes),
          "after-click": screenshot(`${seed}-2`, bytes),
        },
      },
      {
        browserType: "Firefox",
        screenSizeType: "Mobile",
        executionTimeInMS: 4870,
        logMessages: [],
        result: null,
      },
    ],
  };
}

// An API check with a large body: stored big, with nothing to clear.
function bigApiLog(): JSONObject {
  return {
    responseCode: 500,
    responseTimeInMs: 912,
    responseBody: "x".repeat(24 * 1024),
    responseHeaders: { "content-type": "text/html" },
  };
}

function smallLog(): JSONObject {
  return { responseCode: 503, responseTimeInMs: 81 };
}

function copyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/*
 * THE STAND-IN DATABASE: the five tables' rows, the DataMigrations markers
 * and every statement it was asked, answered as Postgres would answer the
 * statements the builders write.
 */

interface FakeRow {
  id: string;
  log: JSONValue | null;
  // As Postgres would store it: the log's length, unless a test says.
  storedBytes: number;
  writes: number;
}

type StatementKind = "markers" | "pageEnd" | "candidates" | "read" | "update";

interface RecordedStatement {
  kind: StatementKind;
  table: string | undefined;
  sql: string;
  params: Array<unknown>;
}

function kindOf(sql: string): StatementKind {
  if (sql.includes(`FROM "DataMigrations"`)) {
    return "markers";
  }

  if (sql.startsWith("UPDATE")) {
    return "update";
  }

  if (sql.includes("OFFSET")) {
    return "pageEnd";
  }

  if (sql.includes("pg_column_size")) {
    return "candidates";
  }

  if (sql.includes(`::text AS "log"`)) {
    return "read";
  }

  throw new Error(`The stand-in database does not know this statement: ${sql}`);
}

function tableOf(sql: string): string | undefined {
  const match: RegExpMatchArray | null =
    sql.match(/FROM "([A-Za-z]+)" t\b/) || sql.match(/^UPDATE "([A-Za-z]+)"/);

  return match ? match[1] : undefined;
}

function storedSizeOf(log: JSONValue | null): number {
  return log === null ? 0 : JSON.stringify(log).length;
}

let clock: number;

class FakeStoredLogDatabase {
  public readonly tables: Map<StoredLogTable, Array<FakeRow>> = new Map<
    StoredLogTable,
    Array<FakeRow>
  >();

  public readonly markers: Set<string> = new Set<string>();

  public readonly statements: Array<RecordedStatement> = [];

  // How long each statement takes, on the test's clock.
  public msPerStatement: number = 0;

  // A failure to answer a statement with, or undefined to answer it.
  public failWith:
    | ((statement: RecordedStatement) => Error | undefined)
    | undefined = undefined;

  public constructor() {
    for (const table of ALL_TABLES) {
      this.tables.set(table, []);
    }
  }

  public add(
    table: StoredLogTable,
    rows: Array<{
      n: number;
      log: JSONValue | null;
      storedBytes?: number | undefined;
    }>,
  ): Array<string> {
    const list: Array<FakeRow> = this.tables.get(table)!;

    for (const row of rows) {
      list.push({
        id: rowId(table, row.n),
        log: copyOf(row.log),
        storedBytes: row.storedBytes ?? storedSizeOf(row.log),
        writes: 0,
      });
    }

    list.sort((a: FakeRow, b: FakeRow): number => {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    return rows.map((row: { n: number }): string => {
      return rowId(table, row.n);
    });
  }

  public row(table: StoredLogTable, n: number): FakeRow {
    return this.tables.get(table)!.find((row: FakeRow): boolean => {
      return row.id === rowId(table, n);
    })!;
  }

  public remove(table: StoredLogTable, n: number): void {
    this.tables.set(
      table,
      this.tables.get(table)!.filter((row: FakeRow): boolean => {
        return row.id !== rowId(table, n);
      }),
    );
  }

  public of(
    kind: StatementKind,
    table?: StoredLogTable,
  ): Array<RecordedStatement> {
    return this.statements.filter((statement: RecordedStatement): boolean => {
      return (
        statement.kind === kind &&
        (table === undefined || statement.table === table)
      );
    });
  }

  public updatedIds(): Array<string> {
    return this.of("update").map((statement: RecordedStatement): string => {
      return String(statement.params[0]);
    });
  }

  public readIds(table?: StoredLogTable): Array<string> {
    return this.of("read", table).flatMap(
      (statement: RecordedStatement): Array<string> => {
        return statement.params[0] as Array<string>;
      },
    );
  }

  public async answer(
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const statement: RecordedStatement = {
      kind: kindOf(sql),
      table: tableOf(sql),
      sql: sql,
      params: params,
    };

    this.statements.push(statement);
    clock += this.msPerStatement;

    const failure: Error | undefined = this.failWith?.(statement);

    if (failure) {
      throw failure;
    }

    if (statement.kind === "markers") {
      return (params[0] as Array<string>)
        .filter((name: string): boolean => {
          return this.markers.has(name);
        })
        .map((name: string): Record<string, unknown> => {
          return { name: name };
        });
    }

    const rows: Array<FakeRow> =
      this.tables.get(statement.table as StoredLogTable) || [];

    if (statement.kind === "pageEnd") {
      const after: string | undefined = sql.includes(`t."_id" > $1::uuid`)
        ? (params[0] as string)
        : undefined;
      const offset: number = Number(params[params.length - 1]);
      const page: Array<FakeRow> = rows.filter((row: FakeRow): boolean => {
        return !after || row.id > after;
      });
      const end: FakeRow | undefined = page[offset];

      return end ? [{ id: end.id }] : [];
    }

    if (statement.kind === "candidates") {
      let index: number = 0;
      const after: string | undefined = sql.includes(`t."_id" > $`)
        ? (params[index++] as string)
        : undefined;
      const through: string | undefined = sql.includes(`t."_id" <= $`)
        ? (params[index++] as string)
        : undefined;
      const minStoredBytes: number = Number(params[index]);

      return rows
        .filter((row: FakeRow): boolean => {
          return (
            (!after || row.id > after) &&
            (!through || row.id <= through) &&
            row.log !== null &&
            row.storedBytes >= minStoredBytes
          );
        })
        .map((row: FakeRow): Record<string, unknown> => {
          return { id: row.id, storedBytes: row.storedBytes };
        });
    }

    if (statement.kind === "read") {
      const ids: Array<string> = params[0] as Array<string>;

      return rows
        .filter((row: FakeRow): boolean => {
          return ids.includes(row.id);
        })
        .map((row: FakeRow): Record<string, unknown> => {
          return {
            id: row.id,
            log: row.log === null ? null : JSON.stringify(row.log),
          };
        });
    }

    // An UPDATE of one row's log.
    const updated: FakeRow | undefined = rows.find((row: FakeRow): boolean => {
      return row.id === params[0];
    });

    if (updated) {
      updated.log = JSON.parse(String(params[1])) as JSONValue;
      updated.storedBytes = storedSizeOf(updated.log);
      updated.writes += 1;
    }

    return [];
  }
}

type Seams = Pick<
  typeof StoredLogScreenshots,
  | "runQuery"
  | "now"
  | "readCursor"
  | "saveCursor"
  | "forgetCursor"
  | "markTableDone"
>;

const ORIGINAL_SEAMS: Seams = {
  runQuery: StoredLogScreenshots.runQuery,
  now: StoredLogScreenshots.now,
  readCursor: StoredLogScreenshots.readCursor,
  saveCursor: StoredLogScreenshots.saveCursor,
  forgetCursor: StoredLogScreenshots.forgetCursor,
  markTableDone: StoredLogScreenshots.markTableDone,
};

let database: FakeStoredLogDatabase;
let cursors: Map<StoredLogTable, string>;
let savedCursors: Array<{ table: StoredLogTable; id: string }>;
let forgottenCursors: Array<StoredLogTable>;
let markedDone: Array<StoredLogTable>;
let failMarking: Set<StoredLogTable>;
let errorLog: SpyInstance<typeof logger.error>;

function installFakes(): void {
  StoredLogScreenshots.runQuery = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    return database.answer(sql, params);
  };
  StoredLogScreenshots.now = (): Date => {
    return new Date(clock);
  };
  StoredLogScreenshots.readCursor = async (
    table: StoredLogTable,
  ): Promise<string | undefined> => {
    return cursors.get(table);
  };
  StoredLogScreenshots.saveCursor = async (
    table: StoredLogTable,
    id: string,
  ): Promise<void> => {
    savedCursors.push({ table: table, id: id });
    cursors.set(table, id);
  };
  StoredLogScreenshots.forgetCursor = async (
    table: StoredLogTable,
  ): Promise<void> => {
    forgottenCursors.push(table);
    cursors.delete(table);
  };
  StoredLogScreenshots.markTableDone = async (
    table: StoredLogTable,
  ): Promise<void> => {
    if (failMarking.has(table)) {
      failMarking.delete(table);
      throw new Error("the database went away");
    }

    markedDone.push(table);
    database.markers.add(getDoneMarkerName(table));
  };
}

function restoreSeams(): void {
  Object.assign(StoredLogScreenshots, ORIGINAL_SEAMS);
}

beforeEach(() => {
  database = new FakeStoredLogDatabase();
  clock = new Date("2026-11-16T09:00:00.000Z").getTime();
  cursors = new Map<StoredLogTable, string>();
  savedCursors = [];
  forgottenCursors = [];
  markedDone = [];
  failMarking = new Set<StoredLogTable>();
  errorLog = jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  installFakes();
});

afterEach(() => {
  restoreSeams();
  jest.restoreAllMocks();
});

function smallLimits(
  overrides: Partial<typeof DEFAULT_LIMITS> = {},
): typeof DEFAULT_LIMITS {
  return { ...DEFAULT_LIMITS, ...overrides };
}

describe("the tables, their columns and the numbers", () => {
  test("every table whose rows keep a state change's check, once, the biggest the installation measured first", () => {
    expect(STORED_LOG_TABLES).toEqual(ALL_TABLES);
    expect(new Set(STORED_LOG_TABLES).size).toBe(
      Object.values(StoredLogTable).length,
    );
  });

  test.each([
    [
      StoredLogTable.IncidentStateTimeline,
      IncidentStateTimeline,
      "stateChangeLog",
    ],
    [StoredLogTable.AlertStateTimeline, AlertStateTimeline, "stateChangeLog"],
    [StoredLogTable.Alert, Alert, "createdStateLog"],
    [StoredLogTable.Incident, Incident, "createdStateLog"],
    [
      StoredLogTable.MonitorStatusTimeline,
      MonitorStatusTimeline,
      "statusChangeLog",
    ],
  ])(
    "%s: the entity's own table, and its jsonb column %s",
    (table: StoredLogTable, model: unknown, column: string) => {
      const entity: TableMetadataArgs | undefined =
        getMetadataArgsStorage().tables.find(
          (candidate: TableMetadataArgs): boolean => {
            return candidate.target === model;
          },
        );
      const stored: ColumnMetadataArgs | undefined =
        getMetadataArgsStorage().columns.find(
          (candidate: ColumnMetadataArgs): boolean => {
            return (
              candidate.target === model && candidate.propertyName === column
            );
          },
        );

      expect(STORED_LOG_COLUMNS[table]).toBe(column);
      expect(entity?.name).toBe(table);
      expect(stored?.options.type).toBe("jsonb");
      expect(stored?.options.nullable).toBe(true);
    },
  );

  test("the numbers a run keeps to", () => {
    expect(SCAN_PAGE_SIZE).toBe(1000);
    // Far below a log with one screenshot, above most logs without.
    expect(CANDIDATE_MIN_STORED_BYTES).toBe(4096);
    expect(READ_BATCH_SIZE).toBe(10);
    expect(READ_BATCH_MAX_STORED_BYTES).toBe(32 * 1024 * 1024);
    expect(CLEAR_TIME_BUDGET_MS).toBe(10 * 60 * 1000);
    expect(DEFAULT_LIMITS).toEqual({
      scanPageSize: SCAN_PAGE_SIZE,
      readBatchSize: READ_BATCH_SIZE,
      readBatchMaxStoredBytes: READ_BATCH_MAX_STORED_BYTES,
    });
  });

  test("a done table's DataMigrations row is named after the table", () => {
    expect(DONE_MARKER_PREFIX).toBe("ClearStoredLogScreenshots:");
    expect(STORED_LOG_TABLES.map(getDoneMarkerName)).toEqual([
      "ClearStoredLogScreenshots:IncidentStateTimeline",
      "ClearStoredLogScreenshots:AlertStateTimeline",
      "ClearStoredLogScreenshots:Alert",
      "ClearStoredLogScreenshots:Incident",
      "ClearStoredLogScreenshots:MonitorStatusTimeline",
    ]);

    // DataMigration.name is a short text: every name fits.
    for (const table of STORED_LOG_TABLES) {
      expect(getDoneMarkerName(table).length).toBeLessThanOrEqual(100);
    }
  });
});

describe("buildPageEndStatement: where a page ends", () => {
  const cursor: string = rowId(StoredLogTable.IncidentStateTimeline, 41);

  test("the first page: the table's pageSize-th row by id, from the primary key alone", () => {
    const statement: StoredLogScreenshotsStatement = buildPageEndStatement({
      table: StoredLogTable.IncidentStateTimeline,
      pageSize: SCAN_PAGE_SIZE,
    });

    expect(words(statement.sql)).toBe(
      words(`SELECT t."_id"::text AS "id"
FROM "IncidentStateTimeline" t
ORDER BY t."_id" ASC
OFFSET $1
LIMIT 1`),
    );
    expect(statement.params).toEqual([999]);
  });

  test("a page after the first starts after the last row of the one before, the id a parameter", () => {
    const statement: StoredLogScreenshotsStatement = buildPageEndStatement({
      table: StoredLogTable.MonitorStatusTimeline,
      afterId: cursor,
      pageSize: SCAN_PAGE_SIZE,
    });

    expect(words(statement.sql)).toBe(
      words(`SELECT t."_id"::text AS "id"
FROM "MonitorStatusTimeline" t
WHERE t."_id" > $1::uuid
ORDER BY t."_id" ASC
OFFSET $2
LIMIT 1`),
    );
    expect(statement.params).toEqual([cursor, 999]);
    expect(statement.sql).not.toContain(cursor);
  });

  test.each(ALL_TABLES)("%s: never reads the log", (table: StoredLogTable) => {
    const statement: StoredLogScreenshotsStatement = buildPageEndStatement({
      table: table,
      afterId: cursor,
      pageSize: 10,
    });

    expect(statement.sql).toContain(`FROM "${table}" t`);
    expect(statement.sql).not.toContain(STORED_LOG_COLUMNS[table]);
  });

  test.each([
    [0, 0],
    [-5, 0],
    [1, 0],
    [2.9, 1],
    [1000, 999],
  ])(
    "a page of %p rows ends at offset %p",
    (pageSize: number, offset: number) => {
      const statement: StoredLogScreenshotsStatement = buildPageEndStatement({
        table: StoredLogTable.Alert,
        pageSize: pageSize,
      });

      expect(statement.params).toEqual([offset]);
    },
  );
});

describe("buildPageCandidatesStatement: a page's rows whose log is stored big", () => {
  const after: string = rowId(StoredLogTable.AlertStateTimeline, 10);
  const through: string = rowId(StoredLogTable.AlertStateTimeline, 1010);

  test("inside the page, the log stored at the threshold or more, by its stored size - never the log itself", () => {
    const statement: StoredLogScreenshotsStatement =
      buildPageCandidatesStatement({
        table: StoredLogTable.AlertStateTimeline,
        afterId: after,
        throughId: through,
        minStoredBytes: CANDIDATE_MIN_STORED_BYTES,
      });

    expect(words(statement.sql)).toBe(
      words(`SELECT t."_id"::text AS "id", pg_column_size(t."stateChangeLog") AS "storedBytes"
FROM "AlertStateTimeline" t
WHERE t."_id" > $1::uuid
  AND t."_id" <= $2::uuid
  AND t."stateChangeLog" IS NOT NULL
  AND pg_column_size(t."stateChangeLog") >= $3
ORDER BY t."_id" ASC`),
    );
    expect(statement.params).toEqual([after, through, 4096]);
    expect(statement.sql).not.toContain(after);
    expect(statement.sql).not.toContain(through);
  });

  test("the first page has no lower bound, the last no upper bound, a table smaller than a page neither", () => {
    const first: StoredLogScreenshotsStatement = buildPageCandidatesStatement({
      table: StoredLogTable.Incident,
      throughId: through,
      minStoredBytes: 4096,
    });
    const last: StoredLogScreenshotsStatement = buildPageCandidatesStatement({
      table: StoredLogTable.Incident,
      afterId: after,
      minStoredBytes: 4096,
    });
    const whole: StoredLogScreenshotsStatement = buildPageCandidatesStatement({
      table: StoredLogTable.Incident,
      minStoredBytes: 4096,
    });

    expect(words(first.sql)).toContain(
      `WHERE t."_id" <= $1::uuid AND t."createdStateLog" IS NOT NULL AND pg_column_size(t."createdStateLog") >= $2`,
    );
    expect(first.params).toEqual([through, 4096]);
    expect(words(last.sql)).toContain(
      `WHERE t."_id" > $1::uuid AND t."createdStateLog" IS NOT NULL AND pg_column_size(t."createdStateLog") >= $2`,
    );
    expect(last.params).toEqual([after, 4096]);
    expect(words(whole.sql)).toContain(
      `WHERE t."createdStateLog" IS NOT NULL AND pg_column_size(t."createdStateLog") >= $1`,
    );
    expect(whole.params).toEqual([4096]);
  });

  test.each(ALL_TABLES)(
    "%s: its own column, named only to test it for NULL and to size it",
    (table: StoredLogTable) => {
      const column: string = STORED_LOG_COLUMNS[table];
      const statement: StoredLogScreenshotsStatement =
        buildPageCandidatesStatement({
          table: table,
          afterId: after,
          throughId: through,
          minStoredBytes: 4096,
        });

      const mentions: Array<string> =
        statement.sql.match(new RegExp(`.{0,16}t\\."${column}".{0,16}`, "g")) ||
        [];

      expect(statement.sql).toContain(`FROM "${table}" t`);
      expect(mentions).toHaveLength(3);

      for (const mention of mentions) {
        expect(
          mention.includes(`pg_column_size(t."${column}")`) ||
            mention.includes(`t."${column}" IS NOT NULL`),
        ).toBe(true);
      }
    },
  );
});

describe("buildReadLogsStatement: the logs of a read batch", () => {
  test("by their ids, as text, the ids one parameter", () => {
    const ids: Array<string> = [
      rowId(StoredLogTable.MonitorStatusTimeline, 1),
      rowId(StoredLogTable.MonitorStatusTimeline, 2),
    ];
    const statement: StoredLogScreenshotsStatement = buildReadLogsStatement({
      table: StoredLogTable.MonitorStatusTimeline,
      ids: ids,
    });

    expect(words(statement.sql)).toBe(
      words(`SELECT t."_id"::text AS "id", t."statusChangeLog"::text AS "log"
FROM "MonitorStatusTimeline" t
WHERE t."_id" = ANY($1::uuid[])`),
    );
    expect(statement.params).toEqual([ids]);
  });

  test("an id that is not one is never asked for", () => {
    const statement: StoredLogScreenshotsStatement = buildReadLogsStatement({
      table: StoredLogTable.Alert,
      ids: [rowId(StoredLogTable.Alert, 1), 'x\'); DROP TABLE "Alert"; --'],
    });

    expect(statement.params).toEqual([[rowId(StoredLogTable.Alert, 1)]]);
    expect(statement.sql).not.toContain("DROP");
  });
});

describe("buildClearLogStatement: one row's log, written back without its screenshots", () => {
  const id: string = rowId(StoredLogTable.IncidentStateTimeline, 7);
  const log: JSONObject = StateChangeLogScreenshots.leaveOut(syntheticLog("w"));

  test("that column alone, by the row's id, the log a parameter", () => {
    const statement: StoredLogScreenshotsStatement = buildClearLogStatement({
      table: StoredLogTable.IncidentStateTimeline,
      id: id,
      log: log,
    });

    expect(words(statement.sql)).toBe(
      words(`UPDATE "IncidentStateTimeline"
SET "stateChangeLog" = $2::jsonb
WHERE "_id" = $1::uuid`),
    );
    expect(statement.params).toEqual([id, JSON.stringify(log)]);
    expect(JSON.parse(statement.params[1] as string)).toEqual(log);
  });

  test.each(ALL_TABLES)(
    '%s: never "updatedAt" or "version" - clearing storage is no change anyone made',
    (table: StoredLogTable) => {
      const statement: StoredLogScreenshotsStatement = buildClearLogStatement({
        table: table,
        id: id,
        log: log,
      });

      expect(statement.sql).toContain(`UPDATE "${table}"`);
      expect(statement.sql).toContain(
        `SET "${STORED_LOG_COLUMNS[table]}" = $2::jsonb`,
      );
      expect(statement.sql).not.toContain("updatedAt");
      expect(statement.sql).not.toContain("version");
      expect(statement.sql).not.toContain(",");
      expect(statement.sql).not.toContain("Checkout");
    },
  );
});

describe("buildDoneMarkersStatement: which tables are done", () => {
  test("one read of every table's DataMigrations row, executed and not deleted", () => {
    const statement: StoredLogScreenshotsStatement = buildDoneMarkersStatement({
      tables: STORED_LOG_TABLES,
    });

    expect(words(statement.sql)).toBe(
      words(`SELECT DISTINCT m."name" AS "name"
FROM "DataMigrations" m
WHERE m."name" = ANY($1::text[])
  AND m."executed" = true
  AND m."deletedAt" IS NULL`),
    );
    expect(statement.params).toEqual([
      STORED_LOG_TABLES.map(getDoneMarkerName),
    ]);
  });
});

describe("toReadBatches: a page's rows, a few at a time", () => {
  function candidates(sizes: Array<number>): Array<StoredLogCandidate> {
    return sizes.map(
      (storedBytes: number, index: number): StoredLogCandidate => {
        return { id: rowId(StoredLogTable.Alert, index + 1), storedBytes };
      },
    );
  }

  function shape(batches: Array<Array<StoredLogCandidate>>): Array<number> {
    return batches.map((batch: Array<StoredLogCandidate>): number => {
      return batch.length;
    });
  }

  test("at most maxRows a batch, in the page's order", () => {
    const rows: Array<StoredLogCandidate> = candidates(
      new Array<number>(25).fill(8192),
    );
    const batches: Array<Array<StoredLogCandidate>> = toReadBatches({
      candidates: rows,
      maxRows: 10,
      maxStoredBytes: READ_BATCH_MAX_STORED_BYTES,
    });

    expect(shape(batches)).toEqual([10, 10, 5]);
    expect(batches.flat()).toEqual(rows);
  });

  test("at most maxStoredBytes of logs a batch; a log bigger than that is read alone", () => {
    const mb: number = 1024 * 1024;
    const batches: Array<Array<StoredLogCandidate>> = toReadBatches({
      candidates: candidates([12 * mb, 12 * mb, 12 * mb, 40 * mb, mb, 31 * mb]),
      maxRows: 10,
      maxStoredBytes: 32 * mb,
    });

    expect(shape(batches)).toEqual([2, 1, 1, 2]);
    expect(
      batches.map((batch: Array<StoredLogCandidate>): number => {
        return batch.reduce((sum: number, row: StoredLogCandidate): number => {
          return sum + row.storedBytes;
        }, 0);
      }),
    ).toEqual([24 * mb, 12 * mb, 40 * mb, 32 * mb]);
  });

  test("no rows, no batches; a limit below one is one", () => {
    expect(
      toReadBatches({ candidates: [], maxRows: 10, maxStoredBytes: 1 }),
    ).toEqual([]);
    expect(
      shape(
        toReadBatches({
          candidates: candidates([5000, 5000]),
          maxRows: 0,
          maxStoredBytes: READ_BATCH_MAX_STORED_BYTES,
        }),
      ),
    ).toEqual([1, 1]);
  });
});

describe("formatStoredBytes", () => {
  // Each figure kept with its unit by a no-break space.
  test.each([
    [0, "0 KB"],
    [4096, "4 KB"],
    [1024 * 1024 - 1, "1024 KB"],
    [1024 * 1024, "1.0 MB"],
    [3.44 * 1024 * 1024, "3.4 MB"],
    [27 * 1024 * 1024 * 1024, "27.0 GB"],
  ])("%p bytes read as %p", (bytes: number, text: string) => {
    expect(formatStoredBytes(bytes)).toBe(text.replace(" ", NO_BREAK_SPACE));
    expect(formatStoredBytes(bytes)).not.toContain(" ");
  });
});

describe("a run: what it clears, and what it leaves untouched", () => {
  function seedEveryTable(): void {
    for (const table of ALL_TABLES) {
      database.add(table, [
        { n: 1, log: syntheticLog(`${table}-1`) },
        { n: 2, log: bigApiLog() },
        { n: 3, log: smallLog() },
        { n: 4, log: null },
        { n: 5, log: syntheticLog(`${table}-5`) },
      ]);
    }
  }

  test("every table's logs with screenshots lose only them, and each run that had some says so", async () => {
    seedEveryTable();

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    for (const table of ALL_TABLES) {
      for (const n of [1, 5]) {
        const row: FakeRow = database.row(table, n);
        const before: JSONObject = syntheticLog(`${table}-${n}`);

        expect(row.log).toEqual(StateChangeLogScreenshots.leaveOut(before));
        expect(row.writes).toBe(1);

        const runs: Array<JSONObject> = (row.log as JSONObject)[
          "syntheticMonitorResponse"
        ] as Array<JSONObject>;

        expect(runs[0]).not.toHaveProperty("screenshots");
        expect(runs[0]![SCREENSHOTS_OMITTED_FIELD]).toBe(true);
        expect(runs[0]!["logMessages"]).toEqual([
          `Opened the checkout page (${table}-${n})`,
        ]);
        expect(runs[1]).not.toHaveProperty(SCREENSHOTS_OMITTED_FIELD);
      }
    }

    expect(summary.rowsCleared).toBe(10);
    expect(summary.storedBytesCleared).toBe(
      ALL_TABLES.reduce((sum: number, table: StoredLogTable): number => {
        return (
          sum +
          storedSizeOf(syntheticLog(`${table}-1`)) +
          storedSizeOf(syntheticLog(`${table}-5`))
        );
      }, 0),
    );
    expect(summary.failedRows).toBe(0);
    expect(summary.failedTables).toBe(0);
    expect(summary.isCutShort).toBe(false);
    expect(summary.isEveryTableDone).toBe(false);
  });

  test("a row with nothing to clear is never written: a big log without screenshots is read and left, a small one or none is not even read", async () => {
    seedEveryTable();

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    for (const table of ALL_TABLES) {
      expect(database.row(table, 2).log).toEqual(bigApiLog());
      expect(database.row(table, 3).log).toEqual(smallLog());
      expect(database.row(table, 4).log).toBeNull();

      for (const n of [2, 3, 4]) {
        expect(database.row(table, n).writes).toBe(0);
      }

      expect(database.readIds(table)).toEqual([
        rowId(table, 1),
        rowId(table, 2),
        rowId(table, 5),
      ]);
    }

    expect(database.updatedIds()).toHaveLength(10);
    // Read: the logs stored big; cleared: the ones with screenshots.
    expect(summary.rowsRead).toBe(15);
  });

  test("a log under the threshold is left as it is, whatever it holds: it is never read", async () => {
    database.add(StoredLogTable.Alert, [
      {
        n: 1,
        log: syntheticLog("tiny", 100),
        storedBytes: CANDIDATE_MIN_STORED_BYTES - 1,
      },
      {
        n: 2,
        log: syntheticLog("at-the-threshold", 100),
        storedBytes: CANDIDATE_MIN_STORED_BYTES,
      },
    ]);

    await StoredLogScreenshots.run();

    expect(database.row(StoredLogTable.Alert, 1).log).toEqual(
      syntheticLog("tiny", 100),
    );
    expect(database.readIds(StoredLogTable.Alert)).toEqual([
      rowId(StoredLogTable.Alert, 2),
    ]);
    expect(database.updatedIds()).toEqual([rowId(StoredLogTable.Alert, 2)]);
  });

  test("what a Custom Code script returned is the script's: a big log with a key called screenshots is left untouched", async () => {
    const customCode: JSONObject = {
      customCodeMonitorResponse: {
        result: { screenshots: { home: screenshot("custom", 9000) } },
        logMessages: [],
      },
    };
    database.add(StoredLogTable.Incident, [{ n: 1, log: customCode }]);

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(database.row(StoredLogTable.Incident, 1).log).toEqual(customCode);
    expect(database.updatedIds()).toEqual([]);
    expect(summary.rowsRead).toBe(1);
    expect(summary.rowsCleared).toBe(0);
  });

  test("a log that is not an object - a text, a list - is left as it is", async () => {
    database.add(StoredLogTable.IncidentStateTimeline, [
      { n: 1, log: "a log kept as text".padEnd(5000, "."), storedBytes: 5000 },
      {
        n: 2,
        log: [syntheticLog("in-a-list")] as unknown as JSONValue,
      },
    ]);

    await StoredLogScreenshots.run();

    expect(database.updatedIds()).toEqual([]);
    expect(database.row(StoredLogTable.IncidentStateTimeline, 2).log).toEqual([
      syntheticLog("in-a-list"),
    ]);
  });

  test("a row deleted between the page and its read is skipped, not failed", async () => {
    database.add(StoredLogTable.Alert, [
      { n: 1, log: syntheticLog("gone") },
      { n: 2, log: syntheticLog("kept") },
    ]);

    const answer: FakeStoredLogDatabase["answer"] =
      database.answer.bind(database);
    database.answer = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      if (kindOf(sql) === "read") {
        database.remove(StoredLogTable.Alert, 1);
      }

      return answer(sql, params);
    };

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(summary.failedRows).toBe(0);
    expect(summary.rowsCleared).toBe(1);
    expect(summary.finishedTables).toContain(StoredLogTable.Alert);
    expect(database.updatedIds()).toEqual([rowId(StoredLogTable.Alert, 2)]);
  });

  test("a log cleared once is not written again: a second walk writes nothing", async () => {
    seedEveryTable();

    await StoredLogScreenshots.run();
    const writtenOnce: Array<string> = database.updatedIds();

    // The walks asked for again: their markers removed.
    database.markers.clear();
    database.statements.length = 0;

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(writtenOnce).toHaveLength(10);
    expect(database.updatedIds()).toEqual([]);
    expect(summary.rowsCleared).toBe(0);
    expect(summary.finishedTables).toEqual(ALL_TABLES);
  });
});

describe("a run: pages, read batches and where a walk got to", () => {
  test("a page covers at most scanPageSize rows: each page ends at its scanPageSize-th row after the last, and the candidates are read inside it", async () => {
    database.add(
      StoredLogTable.IncidentStateTimeline,
      Array.from({ length: 8 }, (_value: unknown, index: number) => {
        return {
          n: index + 1,
          log: index % 2 === 0 ? syntheticLog(`p${index}`) : smallLog(),
        };
      }),
    );

    await StoredLogScreenshots.run({
      limits: smallLimits({ scanPageSize: 3 }),
    });

    const table: StoredLogTable = StoredLogTable.IncidentStateTimeline;

    expect(
      database.of("pageEnd", table).map((statement: RecordedStatement) => {
        return statement.params;
      }),
    ).toEqual([[2], [rowId(table, 3), 2], [rowId(table, 6), 2]]);
    expect(
      database.of("candidates", table).map((statement: RecordedStatement) => {
        return statement.params;
      }),
    ).toEqual([
      [rowId(table, 3), 4096],
      [rowId(table, 3), rowId(table, 6), 4096],
      [rowId(table, 6), 4096],
    ]);
    // Where the walk got to, kept after every page that had an end.
    expect(
      savedCursors.filter((saved: { table: StoredLogTable }) => {
        return saved.table === table;
      }),
    ).toEqual([
      { table: table, id: rowId(table, 3) },
      { table: table, id: rowId(table, 6) },
    ]);
    expect(database.updatedIds()).toEqual([
      rowId(table, 1),
      rowId(table, 3),
      rowId(table, 5),
      rowId(table, 7),
    ]);
  });

  test("a table with exactly a page of rows: the walk reads one more page, finds nothing, and is done", async () => {
    database.add(StoredLogTable.Alert, [
      { n: 1, log: syntheticLog("a") },
      { n: 2, log: syntheticLog("b") },
    ]);

    const summary: StoredLogScreenshotsSummary = await StoredLogScreenshots.run(
      {
        limits: smallLimits({ scanPageSize: 2 }),
      },
    );

    expect(database.of("pageEnd", StoredLogTable.Alert)).toHaveLength(2);
    expect(summary.finishedTables).toContain(StoredLogTable.Alert);
    expect(database.updatedIds()).toEqual([
      rowId(StoredLogTable.Alert, 1),
      rowId(StoredLogTable.Alert, 2),
    ]);
  });

  test("the logs are read READ_BATCH_SIZE at a time, and one write each", async () => {
    database.add(
      StoredLogTable.AlertStateTimeline,
      Array.from({ length: 25 }, (_value: unknown, index: number) => {
        return { n: index + 1, log: syntheticLog(`b${index}`) };
      }),
    );

    await StoredLogScreenshots.run();

    expect(
      database
        .of("read", StoredLogTable.AlertStateTimeline)
        .map((statement: RecordedStatement): number => {
          return (statement.params[0] as Array<string>).length;
        }),
    ).toEqual([10, 10, 5]);

    for (const update of database.of("update")) {
      expect(update.params).toHaveLength(2);
      expect(typeof update.params[0]).toBe("string");
    }

    expect(database.updatedIds()).toHaveLength(25);
  });

  test("and no more than READ_BATCH_MAX_STORED_BYTES of logs a read: a bigger one is read alone", async () => {
    const mb: number = 1024 * 1024;
    database.add(StoredLogTable.Incident, [
      { n: 1, log: syntheticLog("big-1"), storedBytes: 20 * mb },
      { n: 2, log: syntheticLog("big-2"), storedBytes: 20 * mb },
      { n: 3, log: syntheticLog("huge"), storedBytes: 64 * mb },
      { n: 4, log: syntheticLog("small-1"), storedBytes: 6 * mb },
      { n: 5, log: syntheticLog("small-2"), storedBytes: 6 * mb },
    ]);

    await StoredLogScreenshots.run();

    expect(
      database
        .of("read", StoredLogTable.Incident)
        .map((statement: RecordedStatement): Array<string> => {
          return statement.params[0] as Array<string>;
        }),
    ).toEqual([
      [rowId(StoredLogTable.Incident, 1)],
      [rowId(StoredLogTable.Incident, 2)],
      [rowId(StoredLogTable.Incident, 3)],
      [rowId(StoredLogTable.Incident, 4), rowId(StoredLogTable.Incident, 5)],
    ]);
  });

  test("a walk starts where it got to, as the cursor says", async () => {
    const table: StoredLogTable = StoredLogTable.MonitorStatusTimeline;
    database.add(table, [
      { n: 1, log: syntheticLog("before-the-cursor") },
      { n: 2, log: syntheticLog("at-the-cursor") },
      { n: 3, log: syntheticLog("after-the-cursor") },
    ]);
    cursors.set(table, rowId(table, 2));

    await StoredLogScreenshots.run();

    expect(database.of("pageEnd", table)[0]!.params).toEqual([
      rowId(table, 2),
      SCAN_PAGE_SIZE - 1,
    ]);
    expect(database.updatedIds()).toEqual([rowId(table, 3)]);
  });

  test("a lost cursor starts the walk over: what was cleared is read again if still big, and not written again", async () => {
    const table: StoredLogTable = StoredLogTable.IncidentStateTimeline;
    // Big even without its screenshots: a long body besides them.
    const bigBesides: JSONObject = {
      ...syntheticLog("one"),
      responseBody: "y".repeat(8 * 1024),
    };
    database.add(table, [
      { n: 1, log: bigBesides },
      { n: 2, log: bigApiLog() },
      { n: 3, log: syntheticLog("three") },
    ]);

    /*
     * The first run stops after its first page - a second each: the
     * markers, the page's end, its candidates, the read and the write - and
     * the cache then loses where the walk got to.
     */
    database.msPerStatement = 1000;
    await StoredLogScreenshots.run({
      timeBudgetMs: 4500,
      limits: smallLimits({ scanPageSize: 1 }),
    });
    const firstWrites: Array<string> = database.updatedIds();
    expect(cursors.get(table)).toBe(rowId(table, 1));
    cursors.clear();
    database.msPerStatement = 0;
    database.statements.length = 0;

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(firstWrites).toEqual([rowId(table, 1)]);
    expect(database.of("pageEnd", table)[0]!.params).toEqual([
      SCAN_PAGE_SIZE - 1,
    ]);
    expect(database.readIds(table)).toEqual([
      rowId(table, 1),
      rowId(table, 2),
      rowId(table, 3),
    ]);
    expect(database.updatedIds()).toEqual([rowId(table, 3)]);
    expect(database.row(table, 1).writes).toBe(1);
    expect(database.row(table, 1).log).toEqual(
      StateChangeLogScreenshots.leaveOut(bigBesides),
    );
    expect(summary.finishedTables).toContain(table);
  });
});

describe("a run: when a table is done", () => {
  test("a walk that reaches its table's end marks the table done and forgets where it got to, every table in turn", async () => {
    for (const table of ALL_TABLES) {
      database.add(table, [{ n: 1, log: syntheticLog(table) }]);
    }

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(summary.finishedTables).toEqual(ALL_TABLES);
    expect(markedDone).toEqual(ALL_TABLES);
    expect(forgottenCursors).toEqual(ALL_TABLES);
    expect(
      database.statements.map((statement: RecordedStatement): string => {
        return statement.table || statement.kind;
      }),
    ).toEqual([
      "markers",
      ...ALL_TABLES.flatMap((table: StoredLogTable): Array<string> => {
        // Where its one page ends, its candidates, their read, the write.
        return [table, table, table, table];
      }),
    ]);
  });

  test("once every table is done, a run is one read of the markers and nothing else", async () => {
    for (const table of ALL_TABLES) {
      database.add(table, [{ n: 1, log: syntheticLog(table) }]);
      database.markers.add(getDoneMarkerName(table));
    }

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]!.kind).toBe("markers");
    expect(summary).toEqual({
      rowsRead: 0,
      rowsCleared: 0,
      storedBytesCleared: 0,
      failedRows: 0,
      failedTables: 0,
      finishedTables: [],
      isCutShort: false,
      isEveryTableDone: true,
    });
    // The rows are left as they are: a done table is never read again.
    expect(database.row(StoredLogTable.Alert, 1).writes).toBe(0);
  });

  test("a table marked done is skipped; the others are walked", async () => {
    for (const table of ALL_TABLES) {
      database.add(table, [{ n: 1, log: syntheticLog(table) }]);
    }
    database.markers.add(getDoneMarkerName(StoredLogTable.AlertStateTimeline));
    database.markers.add(getDoneMarkerName(StoredLogTable.Incident));

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    const walked: Array<string> = [
      ...new Set(
        database.statements
          .map((statement: RecordedStatement): string | undefined => {
            return statement.table;
          })
          .filter((table: string | undefined): table is string => {
            return Boolean(table);
          }),
      ),
    ];

    expect(walked).toEqual([
      StoredLogTable.IncidentStateTimeline,
      StoredLogTable.Alert,
      StoredLogTable.MonitorStatusTimeline,
    ]);
    expect(summary.finishedTables).toEqual(walked);
    expect(database.row(StoredLogTable.Incident, 1).writes).toBe(0);
  });

  test("an empty table is done at once", async () => {
    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(summary.finishedTables).toEqual(ALL_TABLES);
    expect(database.of("read")).toEqual([]);
    expect(database.of("update")).toEqual([]);
  });
});

describe("a run: the time budget and the job's deadline", () => {
  const table: StoredLogTable = StoredLogTable.IncidentStateTimeline;

  function seedPages(rows: number): void {
    database.add(
      table,
      Array.from({ length: rows }, (_value: unknown, index: number) => {
        return { n: index + 1, log: syntheticLog(`t${index}`) };
      }),
    );
  }

  test("stops starting work once the budget is spent, keeps where it got to, and says the rest wait", async () => {
    seedPages(6);
    database.msPerStatement = 1000;

    const summary: StoredLogScreenshotsSummary = await StoredLogScreenshots.run(
      {
        timeBudgetMs: 8500,
        limits: smallLimits({ scanPageSize: 2 }),
      },
    );

    expect(summary.isCutShort).toBe(true);
    expect(summary.finishedTables).toEqual([]);
    expect(markedDone).toEqual([]);

    const cleared: Array<string> = database.updatedIds();
    const kept: string = cursors.get(table)!;

    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.length).toBeLessThan(6);
    // Every row up to where the walk got to is done; none after it was touched.
    expect(kept).toBe(cleared[cleared.length - 1]);

    for (let n: number = 1; n <= 6; n++) {
      expect(database.row(table, n).writes).toBe(
        rowId(table, n) <= kept ? 1 : 0,
      );
    }

    // The next run carries on from there and finishes.
    database.msPerStatement = 0;
    database.statements.length = 0;
    const next: StoredLogScreenshotsSummary = await StoredLogScreenshots.run({
      limits: smallLimits({ scanPageSize: 2 }),
    });

    expect(database.of("pageEnd", table)[0]!.params[0]).toBe(kept);
    expect(next.finishedTables).toContain(table);

    for (let n: number = 1; n <= 6; n++) {
      expect(database.row(table, n).writes).toBe(1);
    }
  });

  test("stops between read batches too, the walk kept at the last row it cleared", async () => {
    seedPages(5);
    database.msPerStatement = 1000;

    /*
     * A second each: the markers, the page's end and its candidates, then a
     * batch of two - a read, two writes. The next batch would start past
     * the budget.
     */
    await StoredLogScreenshots.run({
      timeBudgetMs: 5500,
      limits: smallLimits({ readBatchSize: 2 }),
    });

    expect(database.updatedIds()).toEqual([rowId(table, 1), rowId(table, 2)]);
    expect(cursors.get(table)).toBe(rowId(table, 2));
    expect(markedDone).toEqual([]);
  });

  test("a run out of time before a table starts it next run", async () => {
    seedPages(1);
    database.add(StoredLogTable.AlertStateTimeline, [
      { n: 1, log: syntheticLog("next-table") },
    ]);
    database.msPerStatement = 1000;

    const summary: StoredLogScreenshotsSummary = await StoredLogScreenshots.run(
      {
        timeBudgetMs: 5000,
      },
    );

    expect(summary.finishedTables).toEqual([table]);
    expect(summary.isCutShort).toBe(true);
    expect(database.of("pageEnd", StoredLogTable.AlertStateTimeline)).toEqual(
      [],
    );
  });

  test("the job's deadline - its time limit, or its lock lost - stops it as the budget does", async () => {
    seedPages(4);
    const deadline: JobDeadline = new JobDeadline();

    const answer: FakeStoredLogDatabase["answer"] =
      database.answer.bind(database);
    database.answer = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      // The lock is lost while the first row is written.
      if (kindOf(sql) === "update") {
        deadline.end();
      }

      return answer(sql, params);
    };

    const summary: StoredLogScreenshotsSummary = await StoredLogScreenshots.run(
      {
        deadline: deadline,
        limits: smallLimits({ readBatchSize: 1 }),
      },
    );

    expect(summary.isCutShort).toBe(true);
    expect(database.updatedIds()).toEqual([rowId(table, 1)]);
    expect(cursors.get(table)).toBe(rowId(table, 1));
  });

  test("a deadline already passed walks nothing", async () => {
    seedPages(2);
    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    const summary: StoredLogScreenshotsSummary = await StoredLogScreenshots.run(
      {
        deadline: deadline,
      },
    );

    expect(summary.isCutShort).toBe(true);
    expect(
      database.statements.map((s: RecordedStatement) => {
        return s.kind;
      }),
    ).toEqual(["markers"]);
  });

  test("the budget is CLEAR_TIME_BUDGET_MS unless a run is given one", async () => {
    seedPages(1);
    database.msPerStatement = CLEAR_TIME_BUDGET_MS;

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    // The markers' read spent the whole budget: no table is started.
    expect(summary.isCutShort).toBe(true);
    expect(database.of("pageEnd")).toEqual([]);
  });
});

describe("a run: failures", () => {
  const table: StoredLogTable = StoredLogTable.AlertStateTimeline;

  function seedFive(): void {
    database.add(
      table,
      Array.from({ length: 5 }, (_value: unknown, index: number) => {
        return { n: index + 1, log: syntheticLog(`f${index}`) };
      }),
    );
  }

  test("a row whose write fails is logged and the rest go on, but the walk stops at it for the run: the table is not marked done", async () => {
    seedFive();
    const failing: string = rowId(table, 3);
    let failures: number = 1;

    database.failWith = (statement: RecordedStatement): Error | undefined => {
      if (
        statement.kind === "update" &&
        statement.params[0] === failing &&
        failures-- > 0
      ) {
        return new Error("canceling statement due to lock timeout");
      }

      return undefined;
    };

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(summary.failedRows).toBe(1);
    expect(summary.failedTables).toBe(0);
    expect(summary.finishedTables).not.toContain(table);
    expect(markedDone).not.toContain(table);
    // The rest of the page went on.
    expect(database.updatedIds()).toEqual(
      [1, 2, 3, 4, 5].map((n: number): string => {
        return rowId(table, n);
      }),
    );
    expect(database.row(table, 3).writes).toBe(0);
    expect(database.row(table, 4).writes).toBe(1);
    // The walk starts at the row next run.
    expect(cursors.get(table)).toBe(rowId(table, 2));
    expect(
      errorLog.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes(`row ${failing} failed`);
      }),
    ).toBe(true);
    // The other tables went on.
    expect(summary.finishedTables).toContain(
      StoredLogTable.MonitorStatusTimeline,
    );

    // Next run: the row is cleared, the others are not written again, and the table is done.
    database.statements.length = 0;
    const next: StoredLogScreenshotsSummary = await StoredLogScreenshots.run();

    expect(database.updatedIds()).toEqual([failing]);
    expect(next.finishedTables).toEqual([table]);
  });

  test("the first row of a page failing keeps the walk where the page started", async () => {
    seedFive();
    cursors.set(table, rowId(table, 0));
    database.failWith = (statement: RecordedStatement): Error | undefined => {
      return statement.kind === "update" &&
        statement.params[0] === rowId(table, 1)
        ? new Error("deadlock detected")
        : undefined;
    };

    await StoredLogScreenshots.run();

    expect(cursors.get(table)).toBe(rowId(table, 0));
    expect(
      savedCursors.filter((saved: { table: StoredLogTable }) => {
        return saved.table === table;
      }),
    ).toEqual([]);
  });

  test("a read batch that fails is logged once, its rows tried again next run, and the other batches go on", async () => {
    seedFive();
    database.failWith = (statement: RecordedStatement): Error | undefined => {
      return statement.kind === "read" &&
        (statement.params[0] as Array<string>).includes(rowId(table, 3))
        ? new Error("missing chunk number 0 for toast value")
        : undefined;
    };

    const summary: StoredLogScreenshotsSummary = await StoredLogScreenshots.run(
      {
        limits: smallLimits({ readBatchSize: 2 }),
      },
    );

    expect(summary.failedRows).toBe(2);
    expect(database.updatedIds()).toEqual([
      rowId(table, 1),
      rowId(table, 2),
      rowId(table, 5),
    ]);
    expect(cursors.get(table)).toBe(rowId(table, 2));
    expect(summary.finishedTables).not.toContain(table);
    expect(
      errorLog.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).includes("of rows");
      }),
    ).toHaveLength(1);
  });

  test("a table whose walk fails is logged, and the other tables go on", async () => {
    for (const each of ALL_TABLES) {
      database.add(each, [{ n: 1, log: syntheticLog(each) }]);
    }
    database.failWith = (statement: RecordedStatement): Error | undefined => {
      return statement.kind === "pageEnd" &&
        statement.table === StoredLogTable.Alert
        ? new Error("relation is being vacuumed")
        : undefined;
    };

    const summary: StoredLogScreenshotsSummary =
      await StoredLogScreenshots.run();

    expect(summary.failedTables).toBe(1);
    expect(summary.finishedTables).toEqual(
      ALL_TABLES.filter((each: StoredLogTable): boolean => {
        return each !== StoredLogTable.Alert;
      }),
    );
    expect(database.row(StoredLogTable.Alert, 1).writes).toBe(0);
    expect(
      errorLog.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes("Alert.createdStateLog");
      }),
    ).toBe(true);
  });

  test("a page whose end cannot be read fails its table, rather than walking on to the table's end", async () => {
    seedFive();
    const answer: FakeStoredLogDatabase["answer"] =
      database.answer.bind(database);
    database.answer = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      if (kindOf(sql) === "pageEnd" && tableOf(sql) === table) {
        database.statements.push({ kind: "pageEnd", table, sql, params });
        return [{ id: "not an id" }];
      }

      return answer(sql, params);
    };

    const summary: StoredLogScreenshotsSummary = await StoredLogScreenshots.run(
      {
        limits: smallLimits({ scanPageSize: 2 }),
      },
    );

    expect(summary.failedTables).toBe(1);
    expect(database.of("candidates", table)).toEqual([]);
  });

  test("a table that cannot be marked done is a table that failed: the next run reads its last page again and marks it", async () => {
    database.add(StoredLogTable.Incident, [
      { n: 1, log: syntheticLog("i1") },
      { n: 2, log: syntheticLog("i2") },
    ]);
    failMarking.add(StoredLogTable.Incident);

    const summary: StoredLogScreenshotsSummary = await StoredLogScreenshots.run(
      {
        limits: smallLimits({ scanPageSize: 1 }),
      },
    );

    expect(summary.failedTables).toBe(1);
    expect(summary.finishedTables).not.toContain(StoredLogTable.Incident);
    expect(cursors.get(StoredLogTable.Incident)).toBe(
      rowId(StoredLogTable.Incident, 2),
    );

    database.statements.length = 0;
    const next: StoredLogScreenshotsSummary = await StoredLogScreenshots.run({
      limits: smallLimits({ scanPageSize: 1 }),
    });

    expect(next.finishedTables).toEqual([StoredLogTable.Incident]);
    expect(database.updatedIds()).toEqual([]);
    expect(database.row(StoredLogTable.Incident, 1).writes).toBe(1);
    expect(database.row(StoredLogTable.Incident, 2).writes).toBe(1);
  });

  test("the markers' read failing fails the run, for the job to log", async () => {
    database.failWith = (statement: RecordedStatement): Error | undefined => {
      return statement.kind === "markers"
        ? new Error("the database is starting up")
        : undefined;
    };

    await expect(StoredLogScreenshots.run()).rejects.toThrow(
      "the database is starting up",
    );
  });
});

describe("clearTable and clearBatch on their own", () => {
  test("clearTable: one table's walk, with what it did", async () => {
    database.add(StoredLogTable.MonitorStatusTimeline, [
      { n: 1, log: syntheticLog("m1") },
      { n: 2, log: bigApiLog() },
    ]);

    const result: StoredLogTableResult = await StoredLogScreenshots.clearTable({
      table: StoredLogTable.MonitorStatusTimeline,
    });

    expect(result).toEqual({
      table: StoredLogTable.MonitorStatusTimeline,
      rowsRead: 2,
      rowsCleared: 1,
      storedBytesCleared: storedSizeOf(syntheticLog("m1")),
      failedRows: 0,
      isFinished: true,
      isCutShort: false,
    });
  });

  test("clearBatch: each row read once, written only when it had screenshots", async () => {
    database.add(StoredLogTable.Alert, [
      { n: 1, log: syntheticLog("a1") },
      { n: 2, log: bigApiLog() },
    ]);

    const outcomes: Array<{ id: string; isCleared: boolean; isRead: boolean }> =
      (
        await StoredLogScreenshots.clearBatch({
          table: StoredLogTable.Alert,
          candidates: [
            { id: rowId(StoredLogTable.Alert, 1), storedBytes: 40000 },
            { id: rowId(StoredLogTable.Alert, 2), storedBytes: 25000 },
            { id: rowId(StoredLogTable.Alert, 9), storedBytes: 9000 },
          ],
        })
      ).map(
        (outcome: {
          candidate: StoredLogCandidate;
          isCleared: boolean;
          isRead: boolean;
        }) => {
          return {
            id: outcome.candidate.id,
            isCleared: outcome.isCleared,
            isRead: outcome.isRead,
          };
        },
      );

    expect(outcomes).toEqual([
      { id: rowId(StoredLogTable.Alert, 1), isCleared: true, isRead: true },
      { id: rowId(StoredLogTable.Alert, 2), isCleared: false, isRead: true },
      // Not there any more: nothing to clear.
      { id: rowId(StoredLogTable.Alert, 9), isCleared: false, isRead: false },
    ]);
    expect(database.of("read")).toHaveLength(1);
  });
});

describe("the seams' own implementations", () => {
  test("runQuery runs on the DataMigration repository's manager", async () => {
    restoreSeams();
    const query: Mock<(...args: Array<unknown>) => Promise<unknown>> = jest.fn(
      async (): Promise<unknown> => {
        return [{ name: "x" }];
      },
    );
    jest.spyOn(DataMigrationService, "getRepository").mockReturnValue({
      manager: { query: query },
    } as never);

    await expect(
      StoredLogScreenshots.runQuery("SELECT $1", [1]),
    ).resolves.toEqual([{ name: "x" }]);
    expect(query).toHaveBeenCalledWith("SELECT $1", [1]);
  });

  test("where a walk got to is read from the cache under the table's name; anything but an id is none", async () => {
    restoreSeams();
    const id: string = rowId(StoredLogTable.Alert, 5);
    const getString: SpyInstance<typeof GlobalCache.getString> = jest
      .spyOn(GlobalCache, "getString")
      .mockResolvedValueOnce(id)
      .mockResolvedValueOnce("garbage")
      .mockResolvedValueOnce(null);

    await expect(
      StoredLogScreenshots.readCursor(StoredLogTable.Alert),
    ).resolves.toBe(id);
    await expect(
      StoredLogScreenshots.readCursor(StoredLogTable.Alert),
    ).resolves.toBeUndefined();
    await expect(
      StoredLogScreenshots.readCursor(StoredLogTable.Alert),
    ).resolves.toBeUndefined();
    expect(getString).toHaveBeenCalledWith(CURSOR_CACHE_NAMESPACE, "Alert");
  });

  test("a cache that cannot be reached is no error: the walk starts at the beginning, and goes on without keeping its place", async () => {
    restoreSeams();
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("Cache is not connected") as never);
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected") as never);
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockRejectedValue(new Error("Cache is not connected") as never);

    await expect(
      StoredLogScreenshots.readCursor(StoredLogTable.Incident),
    ).resolves.toBeUndefined();
    await expect(
      StoredLogScreenshots.saveCursor(
        StoredLogTable.Incident,
        rowId(StoredLogTable.Incident, 1),
      ),
    ).resolves.toBeUndefined();
    await expect(
      StoredLogScreenshots.forgetCursor(StoredLogTable.Incident),
    ).resolves.toBeUndefined();
    expect(errorLog).not.toHaveBeenCalled();
  });

  test("where a walk got to is kept for CURSOR_EXPIRES_IN_DAYS, and forgotten by its key", async () => {
    restoreSeams();
    const setString: SpyInstance<typeof GlobalCache.setString> = jest
      .spyOn(GlobalCache, "setString")
      .mockResolvedValue(undefined as never);
    const deleteKey: SpyInstance<typeof GlobalCache.deleteKey> = jest
      .spyOn(GlobalCache, "deleteKey")
      .mockResolvedValue(undefined as never);
    const id: string = rowId(StoredLogTable.MonitorStatusTimeline, 3);

    await StoredLogScreenshots.saveCursor(
      StoredLogTable.MonitorStatusTimeline,
      id,
    );
    await StoredLogScreenshots.forgetCursor(
      StoredLogTable.MonitorStatusTimeline,
    );

    expect(CURSOR_EXPIRES_IN_DAYS).toBe(30);
    expect(setString).toHaveBeenCalledWith(
      CURSOR_CACHE_NAMESPACE,
      "MonitorStatusTimeline",
      id,
      { expiresInSeconds: 30 * 24 * 60 * 60 },
    );
    expect(deleteKey).toHaveBeenCalledWith(
      CURSOR_CACHE_NAMESPACE,
      "MonitorStatusTimeline",
    );
  });

  test("a table is marked done as the data migration runner records a migration: a DataMigrations row, as root, executed, now", async () => {
    restoreSeams();
    const now: Date = new Date("2026-11-16T10:30:00.000Z");
    StoredLogScreenshots.now = (): Date => {
      return now;
    };
    const create: SpyInstance<typeof DataMigrationService.create> = jest
      .spyOn(DataMigrationService, "create")
      .mockResolvedValue(new DataMigration() as never);

    await StoredLogScreenshots.markTableDone(
      StoredLogTable.IncidentStateTimeline,
    );

    expect(create).toHaveBeenCalledTimes(1);

    const createBy: { data: DataMigration; props: unknown } = create.mock
      .calls[0]![0] as unknown as { data: DataMigration; props: unknown };

    expect(createBy.props).toEqual({ isRoot: true });
    expect(createBy.data.name).toBe(
      "ClearStoredLogScreenshots:IncidentStateTimeline",
    );
    expect(createBy.data.executed).toBe(true);
    expect(createBy.data.executedAt).toEqual(now);
  });

  test("readDoneTables: the tables whose marker the read found, and no others", async () => {
    database.markers.add(getDoneMarkerName(StoredLogTable.Alert));
    database.markers.add("ClearStoredLogScreenshots:SomethingElse");
    database.markers.add("AddIncidentNumber");

    const done: Set<StoredLogTable> =
      await StoredLogScreenshots.readDoneTables();

    expect([...done]).toEqual([StoredLogTable.Alert]);
  });
});
