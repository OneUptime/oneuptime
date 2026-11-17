import OversizedStoredChecks, {
  CANDIDATE_MIN_STORED_BYTES,
  CURSOR_CACHE_NAMESPACE,
  DEFAULT_LIMITS,
  DONE_MARKER_PREFIX,
  OVERSIZED_CHECK_TABLES,
  OversizedStoredChecksSummary,
  OversizedChecksTableResult,
  POINTS_FIELDS,
  SERIES_FINGERPRINT_SOURCES,
  SERIES_LIST_FIELDS,
  SMALL_FIELD_MAX_BYTES,
  TOO_BIG_TO_TRIM_ERROR_CODES,
  TRIMMED_BY_CLEANUP_FIELD,
  TRIMMED_BY_CLEANUP_NOTE,
  TRIMMED_MAX_JSON_BYTES,
  TRIM_LOCK_TIMEOUT_MS,
  TRIM_STATEMENT_TIMEOUT_MS,
  TRIM_TIME_BUDGET_MS,
  buildDoneMarkersStatement,
  buildMarkersOnlyStatement,
  buildTrimStatement,
  getDoneMarkerName,
  isTooBigToTrim,
} from "../../../../Server/Utils/Retention/OversizedStoredChecks";
import {
  DONE_MARKER_PREFIX as SCREENSHOTS_DONE_MARKER_PREFIX,
  CURSOR_CACHE_NAMESPACE as SCREENSHOTS_CURSOR_CACHE_NAMESPACE,
  STORED_LOG_COLUMNS,
  StoredLogScreenshotsStatement,
  StoredLogTable,
} from "../../../../Server/Utils/Retention/StoredLogScreenshots";
import EventLoop from "../../../../Server/Utils/EventLoop";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import logger from "../../../../Server/Utils/Logger";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import MonitorSummarySnapshot from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorSummarySnapshotUtil from "../../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import StoredCheckEvidence, {
  EVIDENCE_SCOPE_FIELD,
  EVIDENCE_TRUNCATED_FIELD,
  STORED_CHECK_MAX_SIZE_IN_BYTES,
} from "../../../../Utils/Monitor/StoredCheckEvidence";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TRIMMING THE OVERSIZED CHECKS STORED BEFORE #9189 (issue #9232):
 * Server/Utils/Retention/OversizedStoredChecks, which the Workers job
 * Monitor:TrimOversizedStoredChecks runs every hour until every table is
 * done.
 *
 * Here, without a database: the statements - that the check is only ever
 * read by Postgres, that nothing a caller gives is written into their text,
 * that each trim is bounded and idempotent - and how a run walks the tables
 * and pages, over a stand-in that answers its statements: one row a
 * statement, with its own timeouts; where a walk keeps where it got to;
 * when a table is done; the time budget; a row too big to trim; a row that
 * fails. What the statements do to real rows is
 * OversizedStoredChecksPostgres.test.ts's, against a migrated Postgres.
 */

const PREFIX_BY_TABLE: Record<StoredLogTable, string> = {
  [StoredLogTable.AlertStateTimeline]: "a9232001",
  [StoredLogTable.Alert]: "a9232002",
  [StoredLogTable.IncidentStateTimeline]: "a9232003",
  [StoredLogTable.Incident]: "a9232004",
  [StoredLogTable.MonitorStatusTimeline]: "a9232005",
};

function rowId(table: StoredLogTable, n: number): string {
  return `${PREFIX_BY_TABLE[table]}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function words(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("OversizedStoredChecks - what it walks and how far", () => {
  test("the five tables that keep a check, the biggest #9189 measured first", () => {
    expect(OVERSIZED_CHECK_TABLES).toEqual([
      StoredLogTable.AlertStateTimeline,
      StoredLogTable.Alert,
      StoredLogTable.IncidentStateTimeline,
      StoredLogTable.Incident,
      StoredLogTable.MonitorStatusTimeline,
    ]);
  });

  test("a check is a candidate from the size a check stored today may take, and trimmed to that size", () => {
    expect(CANDIDATE_MIN_STORED_BYTES).toBe(STORED_CHECK_MAX_SIZE_IN_BYTES);
    expect(TRIMMED_MAX_JSON_BYTES).toBe(STORED_CHECK_MAX_SIZE_IN_BYTES);
    expect(SMALL_FIELD_MAX_BYTES).toBeLessThan(TRIMMED_MAX_JSON_BYTES);
  });

  test("its bounds: a statement timeout and a lock timeout a row, a time budget a run", () => {
    expect(TRIM_STATEMENT_TIMEOUT_MS).toBe(30 * 1000);
    expect(TRIM_LOCK_TIMEOUT_MS).toBe(3 * 1000);
    expect(TRIM_TIME_BUDGET_MS).toBe(10 * 60 * 1000);
    expect(DEFAULT_LIMITS).toEqual({
      scanPageSize: 1000,
      statementTimeoutMs: TRIM_STATEMENT_TIMEOUT_MS,
      lockTimeoutMs: TRIM_LOCK_TIMEOUT_MS,
    });
  });

  test("its done markers and cursors are its own, never the screenshot clean-up's", () => {
    expect(DONE_MARKER_PREFIX).toBe("TrimOversizedStoredChecks:");
    expect(DONE_MARKER_PREFIX).not.toBe(SCREENSHOTS_DONE_MARKER_PREFIX);
    expect(CURSOR_CACHE_NAMESPACE).not.toBe(SCREENSHOTS_CURSOR_CACHE_NAMESPACE);
    expect(getDoneMarkerName(StoredLogTable.Alert)).toBe(
      "TrimOversizedStoredChecks:Alert",
    );
    expect(
      buildDoneMarkersStatement({ tables: OVERSIZED_CHECK_TABLES }).params,
    ).toEqual([
      [
        "TrimOversizedStoredChecks:AlertStateTimeline",
        "TrimOversizedStoredChecks:Alert",
        "TrimOversizedStoredChecks:IncidentStateTimeline",
        "TrimOversizedStoredChecks:Incident",
        "TrimOversizedStoredChecks:MonitorStatusTimeline",
      ],
    ]);
  });

  test("the series lists and points it takes out are the ones MonitorStoredCheck scopes", () => {
    expect(SERIES_LIST_FIELDS).toEqual([
      "seriesBreakdown",
      "groupBreakdown",
      "resolvedGroups",
    ]);
    expect(POINTS_FIELDS).toEqual(["metricResult", "metricResultArrivals"]);
  });
});

describe("buildTrimStatement", () => {
  const id: string = rowId(StoredLogTable.AlertStateTimeline, 7);

  test("trims one row by its id, only while it is still stored past the threshold, and returns its size after", () => {
    const statement: StoredLogScreenshotsStatement = buildTrimStatement({
      table: StoredLogTable.AlertStateTimeline,
      id: id,
    });
    const sql: string = words(statement.sql);

    expect(statement.params).toEqual([
      id,
      CANDIDATE_MIN_STORED_BYTES,
      TRIMMED_MAX_JSON_BYTES,
      SMALL_FIELD_MAX_BYTES,
      TRIMMED_BY_CLEANUP_NOTE,
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    ]);
    expect(sql).toContain(`WHERE t."_id" = $1::uuid`);
    // Checked where the row is read and again where it is written: idempotent.
    expect(
      sql.match(/pg_column_size\(t\."stateChangeLog"\) >= \$2/g),
    ).toHaveLength(2);
    expect(sql).toContain(
      `UPDATE "AlertStateTimeline" t SET "stateChangeLog" = r."log"`,
    );
    expect(sql).toContain(
      `RETURNING t."_id"::text AS "id", pg_column_size(t."stateChangeLog") AS "storedBytes"`,
    );
    // Only that column: never updatedAt or version.
    expect(sql).not.toContain("updatedAt");
    expect(sql).not.toContain(`"version"`);
  });

  test("never hands the check to Node: nothing of it is selected or returned", () => {
    for (const table of OVERSIZED_CHECK_TABLES) {
      const column: string = STORED_LOG_COLUMNS[table];
      const sql: string = words(
        buildTrimStatement({ table, id: rowId(table, 1) }).sql,
      );
      const returning: string = sql.slice(sql.indexOf("RETURNING"));

      expect(returning).not.toContain(`t."${column}" AS`);
      expect(returning).not.toContain('::text AS "log"');
      expect(sql).not.toMatch(/^SELECT/);
      expect(sql).toMatch(/^WITH "target" AS/);
    }
  });

  test("finds the row's series: the record's own, its alert's or its incident's, none for a status change", () => {
    const alert: string = words(
      buildTrimStatement({
        table: StoredLogTable.Alert,
        id: rowId(StoredLogTable.Alert, 1),
      }).sql,
    );
    expect(alert).toContain(`t."seriesFingerprint"`);
    expect(alert).not.toContain("LEFT JOIN");

    const alertState: string = words(
      buildTrimStatement({
        table: StoredLogTable.AlertStateTimeline,
        id: rowId(StoredLogTable.AlertStateTimeline, 1),
      }).sql,
    );
    expect(alertState).toContain(
      `LEFT JOIN "Alert" r ON r."_id" = t."alertId"`,
    );
    expect(alertState).toContain(`r."seriesFingerprint"`);

    const incidentState: string = words(
      buildTrimStatement({
        table: StoredLogTable.IncidentStateTimeline,
        id: rowId(StoredLogTable.IncidentStateTimeline, 1),
      }).sql,
    );
    expect(incidentState).toContain(
      `LEFT JOIN "Incident" r ON r."_id" = t."incidentId"`,
    );

    const status: string = words(
      buildTrimStatement({
        table: StoredLogTable.MonitorStatusTimeline,
        id: rowId(StoredLogTable.MonitorStatusTimeline, 1),
      }).sql,
    );
    expect(status).not.toContain(`."seriesFingerprint"`);
    expect(status).toContain(`NULL::text AS "fingerprint"`);
    // No parameter it does not use: Postgres could not type it.
    expect(
      buildTrimStatement({
        table: StoredLogTable.MonitorStatusTimeline,
        id: rowId(StoredLogTable.MonitorStatusTimeline, 1),
      }).params,
    ).toHaveLength(5);

    expect(
      SERIES_FINGERPRINT_SOURCES[StoredLogTable.MonitorStatusTimeline],
    ).toBe(null);
  });

  test("keeps the series' entry by its fingerprint, passed as a jsonpath variable, never spliced into the path", () => {
    const sql: string = words(
      buildTrimStatement({
        table: StoredLogTable.Alert,
        id: rowId(StoredLogTable.Alert, 1),
      }).sql,
    );

    expect(sql).toContain(
      `jsonb_path_query_first(g."log" -> l."name", '$[*] ? (@."fingerprint" == $fingerprint)', jsonb_build_object('fingerprint', g."fingerprint"))`,
    );
    // A whole-monitor record is about no series.
    expect(sql).toContain(`= $6::text THEN NULL`);
  });

  test("takes out the series lists and the points, keeps the record's own, and marks the result", () => {
    const sql: string = words(
      buildTrimStatement({
        table: StoredLogTable.Incident,
        id: rowId(StoredLogTable.Incident, 1),
      }).sql,
    );

    expect(sql).toContain(
      `g."log" - ARRAY['seriesBreakdown', 'groupBreakdown', 'resolvedGroups', 'metricResult', 'metricResultArrivals']::text[] AS "rest"`,
    );
    expect(sql).toContain(`x."entry" -> 'aggregatedResults'`);
    expect(sql).toContain(`x."entry" -> 'arrivals'`);
    expect(sql).toContain(
      `'${EVIDENCE_SCOPE_FIELD}', jsonb_build_object( 'seriesFingerprint', g."fingerprint", 'seriesInEvaluation'`,
    );
    expect(sql).toContain(
      `jsonb_build_object('${EVIDENCE_TRUNCATED_FIELD}', true, '${TRIMMED_BY_CLEANUP_FIELD}', jsonb_build_object('note', $5::text, 'trimmedFields',`,
    );
  });

  test("never writes past the limit: the series, else the small fields, else the markers alone", () => {
    const sql: string = words(
      buildTrimStatement({
        table: StoredLogTable.Alert,
        id: rowId(StoredLogTable.Alert, 1),
      }).sql,
    );

    expect(sql).toContain(
      `CASE WHEN octet_length(m."withSeries"::text) <= $3 THEN m."withSeries"`,
    );
    expect(sql).toContain(`WHERE octet_length(e."value"::text) <= $4`);
    expect(sql).toContain(
      `CASE WHEN octet_length(f."log"::text) <= $3 THEN f."log"`,
    );
  });

  test("its sizes are whole positive numbers, whatever it is handed", () => {
    expect(
      buildTrimStatement({
        table: StoredLogTable.Alert,
        id: rowId(StoredLogTable.Alert, 1),
        minStoredBytes: 0,
        maxJsonBytes: 1000.7,
        smallFieldMaxBytes: -5,
      }).params.slice(1, 4),
    ).toEqual([1, 1000, 1]);
  });

  test("the row's id is a parameter, never part of the statement", () => {
    const hostile: string = `'; DROP TABLE "Alert"; --`;
    const statement: StoredLogScreenshotsStatement = buildTrimStatement({
      table: StoredLogTable.Alert,
      id: hostile,
    });

    expect(statement.sql).not.toContain("DROP TABLE");
    expect(statement.params[0]).toBe(hostile);
  });
});

describe("buildMarkersOnlyStatement", () => {
  test("replaces a check by the markers alone, reading none of it", () => {
    for (const table of OVERSIZED_CHECK_TABLES) {
      const column: string = STORED_LOG_COLUMNS[table];
      const id: string = rowId(table, 3);
      const statement: StoredLogScreenshotsStatement =
        buildMarkersOnlyStatement({ table, id });
      const sql: string = words(statement.sql);

      expect(statement.params).toEqual([
        id,
        CANDIDATE_MIN_STORED_BYTES,
        TRIMMED_BY_CLEANUP_NOTE,
      ]);
      expect(sql).toBe(
        `UPDATE "${table}" t SET "${column}" = jsonb_build_object('isEvidenceTruncated', true, 'evidenceTrimmedByCleanup', jsonb_build_object('note', $3::text, 'trimmedFields', '"all"'::jsonb)) WHERE t."_id" = $1::uuid AND pg_column_size(t."${column}") >= $2 RETURNING t."_id"::text AS "id", pg_column_size(t."${column}") AS "storedBytes"`,
      );
    }
  });
});

describe("isTooBigToTrim", () => {
  test("a statement timeout or the backend's memory: replaced by the markers", () => {
    expect(TOO_BIG_TO_TRIM_ERROR_CODES).toEqual(["57014", "53200", "54000"]);

    for (const code of TOO_BIG_TO_TRIM_ERROR_CODES) {
      expect(isTooBigToTrim({ code })).toBe(true);
      // As TypeORM's QueryFailedError carries it.
      expect(isTooBigToTrim({ driverError: { code } })).toBe(true);
    }
  });

  test("a lock waited for too long, a lost connection, anything else: tried again next run", () => {
    expect(isTooBigToTrim({ code: "55P03" })).toBe(false);
    expect(isTooBigToTrim(new Error("Connection terminated"))).toBe(false);
    expect(isTooBigToTrim(null)).toBe(false);
    expect(isTooBigToTrim(undefined)).toBe(false);
  });
});

describe("readReturnedRows", () => {
  test("reads an UPDATE ... RETURNING as a query runner returns it, or as rows", () => {
    const rows: Array<Record<string, unknown>> = [{ id: "a", storedBytes: 3 }];

    expect(OversizedStoredChecks.readReturnedRows([rows, 1])).toEqual(rows);
    expect(OversizedStoredChecks.readReturnedRows([[], 0])).toEqual([]);
    expect(OversizedStoredChecks.readReturnedRows(rows)).toEqual(rows);
    expect(OversizedStoredChecks.readReturnedRows(undefined)).toEqual([]);
  });
});

/*
 * A stand-in for Postgres: each table's rows, in id order, with the size
 * each check is stored at; trims answer by what `answer` says.
 */
interface FakeRow {
  id: string;
  storedBytes: number;
}

type TrimAnswer =
  | { kind: "trimmed"; storedBytesAfter: number }
  | { kind: "gone" }
  | { kind: "error"; error: unknown };

class FakeDatabase {
  public rows: Map<StoredLogTable, Array<FakeRow>> = new Map();
  public done: Set<string> = new Set<string>();
  public cursors: Map<StoredLogTable, string> = new Map();
  public statements: Array<{
    sql: string;
    params: Array<unknown>;
    statementTimeoutMs?: number;
    lockTimeoutMs?: number;
  }> = [];
  public answers: Map<string, Array<TrimAnswer>> = new Map();

  public add(table: StoredLogTable, rows: Array<FakeRow>): void {
    this.rows.set(table, [...(this.rows.get(table) || []), ...rows]);
  }

  public query(
    sql: string,
    params: Array<unknown>,
  ): Array<Record<string, unknown>> {
    this.statements.push({ sql, params });

    if (sql.includes(`FROM "DataMigrations"`)) {
      return (params[0] as Array<string>)
        .filter((name: string): boolean => {
          return this.done.has(name);
        })
        .map((name: string): Record<string, unknown> => {
          return { name };
        });
    }

    const table: StoredLogTable = OVERSIZED_CHECK_TABLES.find(
      (candidate: StoredLogTable): boolean => {
        return sql.includes(`FROM "${candidate}" t`);
      },
    )!;
    const rows: Array<FakeRow> = this.rows.get(table) || [];

    if (sql.includes("OFFSET")) {
      const after: string | undefined = sql.includes(`"_id" >`)
        ? (params[0] as string)
        : undefined;
      const offset: number = params[params.length - 1] as number;
      const left: Array<FakeRow> = rows.filter((row: FakeRow): boolean => {
        return !after || row.id > after;
      });
      const end: FakeRow | undefined = left[offset];

      return end ? [{ id: end.id }] : [];
    }

    // The candidates of a page.
    let index: number = 0;
    const after: string | undefined = sql.includes(`"_id" > $`)
      ? (params[index++] as string)
      : undefined;
    const through: string | undefined = sql.includes(`"_id" <= $`)
      ? (params[index++] as string)
      : undefined;
    const min: number = params[index] as number;

    return rows
      .filter((row: FakeRow): boolean => {
        return (
          (!after || row.id > after) &&
          (!through || row.id <= through) &&
          row.storedBytes >= min
        );
      })
      .map((row: FakeRow): Record<string, unknown> => {
        return { id: row.id, storedBytes: row.storedBytes };
      });
  }

  public statement(data: {
    sql: string;
    params: Array<unknown>;
    statementTimeoutMs: number;
    lockTimeoutMs: number;
  }): Array<Record<string, unknown>> {
    this.statements.push(data);

    const id: string = data.params[0] as string;
    const kind: string = data.sql.startsWith("WITH") ? "trim" : "markers";
    const queued: Array<TrimAnswer> = this.answers.get(`${kind}:${id}`) || [];
    const answer: TrimAnswer = queued.shift() || {
      kind: "trimmed",
      storedBytesAfter: kind === "trim" ? 4000 : 200,
    };

    if (answer.kind === "error") {
      throw answer.error;
    }

    if (answer.kind === "gone") {
      return [];
    }

    for (const rows of this.rows.values()) {
      const row: FakeRow | undefined = rows.find((candidate: FakeRow) => {
        return candidate.id === id;
      });

      if (row) {
        row.storedBytes = answer.storedBytesAfter;
      }
    }

    return [{ id, storedBytes: answer.storedBytesAfter }];
  }

  public trims(): Array<{
    sql: string;
    params: Array<unknown>;
    statementTimeoutMs?: number;
    lockTimeoutMs?: number;
  }> {
    return this.statements.filter((statement: { sql: string }): boolean => {
      return statement.sql.includes("UPDATE");
    });
  }
}

describe("OversizedStoredChecks - a run, over a stand-in database", () => {
  let database: FakeDatabase;
  let yields: number;
  const originals: Partial<typeof OversizedStoredChecks> = {};

  beforeEach(() => {
    database = new FakeDatabase();
    yields = 0;

    Object.assign(originals, {
      runQuery: OversizedStoredChecks.runQuery,
      runStatement: OversizedStoredChecks.runStatement,
      readCursor: OversizedStoredChecks.readCursor,
      saveCursor: OversizedStoredChecks.saveCursor,
      forgetCursor: OversizedStoredChecks.forgetCursor,
      markTableDone: OversizedStoredChecks.markTableDone,
      now: OversizedStoredChecks.now,
    });

    OversizedStoredChecks.runQuery = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      return database.query(sql, params);
    };
    OversizedStoredChecks.runStatement = async (data: {
      sql: string;
      params: Array<unknown>;
      statementTimeoutMs: number;
      lockTimeoutMs: number;
    }): Promise<Array<Record<string, unknown>>> => {
      return database.statement(data);
    };
    OversizedStoredChecks.readCursor = async (
      table: StoredLogTable,
    ): Promise<string | undefined> => {
      return database.cursors.get(table);
    };
    OversizedStoredChecks.saveCursor = async (
      table: StoredLogTable,
      id: string,
    ): Promise<void> => {
      database.cursors.set(table, id);
    };
    OversizedStoredChecks.forgetCursor = async (
      table: StoredLogTable,
    ): Promise<void> => {
      database.cursors.delete(table);
    };
    OversizedStoredChecks.markTableDone = async (
      table: StoredLogTable,
    ): Promise<void> => {
      database.done.add(getDoneMarkerName(table));
    };

    jest.spyOn(EventLoop, "yieldToEventLoop").mockImplementation(async () => {
      yields += 1;
    });
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    Object.assign(OversizedStoredChecks, originals);
    jest.restoreAllMocks();
  });

  function fleet(table: StoredLogTable, sizes: Array<number>): Array<string> {
    const rows: Array<FakeRow> = sizes.map(
      (storedBytes: number, n: number): FakeRow => {
        return { id: rowId(table, n + 1), storedBytes };
      },
    );
    database.add(table, rows);
    return rows.map((row: FakeRow): string => {
      return row.id;
    });
  }

  const BIG: number = 12 * 1024 * 1024;
  const SMALL: number = 3 * 1024;

  test("trims each oversized row by one statement of its own, with its timeouts, yielding between rows; leaves the rest; marks every table done", async () => {
    const alerts: Array<string> = fleet(StoredLogTable.Alert, [
      BIG,
      SMALL,
      BIG,
      CANDIDATE_MIN_STORED_BYTES - 1,
      CANDIDATE_MIN_STORED_BYTES,
    ]);

    const summary: OversizedStoredChecksSummary =
      await OversizedStoredChecks.run({
        limits: { ...DEFAULT_LIMITS, scanPageSize: 2 },
      });

    const trims: Array<{
      params: Array<unknown>;
      statementTimeoutMs?: number;
      lockTimeoutMs?: number;
    }> = database.trims();

    expect(
      trims.map((trim: { params: Array<unknown> }): unknown => {
        return trim.params[0];
      }),
    ).toEqual([alerts[0], alerts[2], alerts[4]]);

    for (const trim of trims) {
      expect(trim.statementTimeoutMs).toBe(TRIM_STATEMENT_TIMEOUT_MS);
      expect(trim.lockTimeoutMs).toBe(TRIM_LOCK_TIMEOUT_MS);
    }

    expect(yields).toBe(3);
    expect(summary).toEqual({
      rowsTrimmed: 3,
      rowsReplacedByMarkers: 0,
      storedBytesBefore: BIG * 2 + CANDIDATE_MIN_STORED_BYTES,
      storedBytesAfter: 3 * 4000,
      failedRows: 0,
      failedTables: 0,
      finishedTables: [...OVERSIZED_CHECK_TABLES],
      isCutShort: false,
      isEveryTableDone: false,
    });
    expect(database.cursors.size).toBe(0);
  });

  test("once every table is done, a run is one read", async () => {
    for (const table of OVERSIZED_CHECK_TABLES) {
      database.done.add(getDoneMarkerName(table));
    }
    fleet(StoredLogTable.Alert, [BIG]);

    const summary: OversizedStoredChecksSummary =
      await OversizedStoredChecks.run();

    expect(summary.isEveryTableDone).toBe(true);
    expect(database.statements).toHaveLength(1);
  });

  test("a table done is skipped; the others are walked", async () => {
    database.done.add(getDoneMarkerName(StoredLogTable.AlertStateTimeline));
    fleet(StoredLogTable.AlertStateTimeline, [BIG]);
    const alerts: Array<string> = fleet(StoredLogTable.Alert, [BIG]);

    await OversizedStoredChecks.run();

    expect(
      database.trims().map((trim: { params: Array<unknown> }): unknown => {
        return trim.params[0];
      }),
    ).toEqual([alerts[0]]);
  });

  test("a row trimmed or deleted since its page was read is skipped, and the walk goes on", async () => {
    const alerts: Array<string> = fleet(StoredLogTable.Alert, [BIG, BIG]);
    database.answers.set(`trim:${alerts[0]}`, [{ kind: "gone" }]);

    const result: OversizedChecksTableResult =
      await OversizedStoredChecks.trimTable({ table: StoredLogTable.Alert });

    expect(result.rowsTrimmed).toBe(1);
    expect(result.failedRows).toBe(0);
    expect(result.isFinished).toBe(true);
  });

  test("a row Postgres cannot trim within its limits is replaced by the markers alone", async () => {
    const alerts: Array<string> = fleet(StoredLogTable.Alert, [BIG, BIG]);
    database.answers.set(`trim:${alerts[0]}`, [
      {
        kind: "error",
        error: {
          driverError: { code: "57014" },
          message: "canceling statement due to statement timeout",
        },
      },
    ]);

    const result: OversizedChecksTableResult =
      await OversizedStoredChecks.trimTable({ table: StoredLogTable.Alert });

    expect(result).toMatchObject({
      rowsTrimmed: 1,
      rowsReplacedByMarkers: 1,
      failedRows: 0,
      isFinished: true,
    });
    expect(
      database
        .trims()
        .map((trim: { sql: string; params: Array<unknown> }): string => {
          return `${trim.sql.startsWith("WITH") ? "trim" : "markers"}:${String(trim.params[0])}`;
        }),
    ).toEqual([
      `trim:${alerts[0]}`,
      `markers:${alerts[0]}`,
      `trim:${alerts[1]}`,
    ]);
  });

  test("a row that fails otherwise stops the walk there: the cursor stays on the row before, the table is not done, and the next run starts at it", async () => {
    const alerts: Array<string> = fleet(StoredLogTable.Alert, [BIG, BIG, BIG]);
    database.answers.set(`trim:${alerts[1]}`, [
      { kind: "error", error: { code: "55P03", message: "lock timeout" } },
    ]);

    const first: OversizedChecksTableResult =
      await OversizedStoredChecks.trimTable({ table: StoredLogTable.Alert });

    expect(first).toMatchObject({
      rowsTrimmed: 1,
      failedRows: 1,
      isFinished: false,
      isCutShort: false,
    });
    expect(database.cursors.get(StoredLogTable.Alert)).toBe(alerts[0]);
    expect(database.done.has(getDoneMarkerName(StoredLogTable.Alert))).toBe(
      false,
    );
    // The row after the failed one was not touched.
    expect(database.trims()).toHaveLength(2);

    database.statements = [];
    const second: OversizedChecksTableResult =
      await OversizedStoredChecks.trimTable({ table: StoredLogTable.Alert });

    expect(second).toMatchObject({ rowsTrimmed: 2, isFinished: true });
    expect(
      database.trims().map((trim: { params: Array<unknown> }): unknown => {
        return trim.params[0];
      }),
    ).toEqual([alerts[1], alerts[2]]);
  });

  test("a row whose markers cannot be written either fails, and is tried again next run", async () => {
    const alerts: Array<string> = fleet(StoredLogTable.Alert, [BIG]);
    database.answers.set(`trim:${alerts[0]}`, [
      { kind: "error", error: { code: "53200" } },
    ]);
    database.answers.set(`markers:${alerts[0]}`, [
      { kind: "error", error: new Error("Connection terminated") },
    ]);

    const result: OversizedChecksTableResult =
      await OversizedStoredChecks.trimTable({ table: StoredLogTable.Alert });

    expect(result).toMatchObject({
      rowsTrimmed: 0,
      rowsReplacedByMarkers: 0,
      failedRows: 1,
      isFinished: false,
    });
    expect(database.cursors.has(StoredLogTable.Alert)).toBe(false);
  });

  test("the time budget stops a run between rows, keeping where it got to", async () => {
    const alerts: Array<string> = fleet(StoredLogTable.AlertStateTimeline, [
      BIG,
      BIG,
      BIG,
    ]);
    let clock: number = 0;
    OversizedStoredChecks.now = (): Date => {
      return new Date(clock);
    };
    OversizedStoredChecks.runStatement = async (data: {
      sql: string;
      params: Array<unknown>;
      statementTimeoutMs: number;
      lockTimeoutMs: number;
    }): Promise<Array<Record<string, unknown>>> => {
      clock += 1000;
      return database.statement(data);
    };

    const summary: OversizedStoredChecksSummary =
      await OversizedStoredChecks.run({ timeBudgetMs: 2000 });

    expect(summary.rowsTrimmed).toBe(2);
    expect(summary.isCutShort).toBe(true);
    expect(summary.finishedTables).toEqual([]);
    expect(database.cursors.get(StoredLogTable.AlertStateTimeline)).toBe(
      alerts[1],
    );
  });

  test("the job's deadline stops a run too", async () => {
    fleet(StoredLogTable.AlertStateTimeline, [BIG]);
    const deadline: JobDeadline = new JobDeadline({});
    deadline.end(new Error("lock lost"));

    const summary: OversizedStoredChecksSummary =
      await OversizedStoredChecks.run({ deadline });

    expect(summary.isCutShort).toBe(true);
    expect(database.trims()).toHaveLength(0);
  });

  test("one table's failure is logged and the others go on", async () => {
    const alerts: Array<string> = fleet(StoredLogTable.Alert, [BIG]);
    const runQuery: typeof OversizedStoredChecks.runQuery =
      OversizedStoredChecks.runQuery;
    OversizedStoredChecks.runQuery = async (
      sql: string,
      params: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      if (sql.includes(`FROM "AlertStateTimeline" t`)) {
        throw new Error("relation is being rewritten");
      }
      return runQuery(sql, params);
    };

    const summary: OversizedStoredChecksSummary =
      await OversizedStoredChecks.run();

    expect(summary.failedTables).toBe(1);
    expect(summary.finishedTables).not.toContain(
      StoredLogTable.AlertStateTimeline,
    );
    expect(summary.finishedTables).toContain(StoredLogTable.Alert);
    expect(
      database.trims().map((trim: { params: Array<unknown> }): unknown => {
        return trim.params[0];
      }),
    ).toEqual([alerts[0]]);
  });
});

/*
 * What the dashboard reads of a trimmed check: View Logs says it was trimmed
 * (StoredCheckEvidence.isTrimmed, TrimmedLogNote), and an old record's
 * summary card is still built from it.
 */
describe("a check trimmed by the clean-up, as the dashboard reads it", () => {
  const trimmed: JSONObject = {
    monitorId: "6f000000-0000-4000-8000-000000000001",
    evaluationSummary: {
      criteriaResults: [{ criteriaName: "Restarted", isMet: true }],
    },
    seriesBreakdown: [{ fingerprint: "fp1", labels: { host: "a" } }],
    metricResult: [],
    [EVIDENCE_SCOPE_FIELD]: {
      seriesFingerprint: "fp1",
      seriesInEvaluation: 16158,
    },
    [EVIDENCE_TRUNCATED_FIELD]: true,
    [TRIMMED_BY_CLEANUP_FIELD]: {
      note: TRIMMED_BY_CLEANUP_NOTE,
      trimmedFields: ["metricResult", "seriesBreakdown"],
    },
  };

  const markersOnly: JSONObject = {
    [EVIDENCE_TRUNCATED_FIELD]: true,
    [TRIMMED_BY_CLEANUP_FIELD]: {
      note: TRIMMED_BY_CLEANUP_NOTE,
      trimmedFields: "all",
    },
  };

  test("View Logs says it was trimmed, read as JSON or as text", () => {
    for (const log of [trimmed, markersOnly]) {
      expect(StoredCheckEvidence.isTrimmed(log)).toBe(true);
      expect(StoredCheckEvidence.isTrimmed(JSON.stringify(log))).toBe(true);
    }
  });

  test("an old Metrics alert's summary card is still built from it, with its evaluation", () => {
    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: trimmed,
        monitorType: MonitorType.Metrics,
        capturedAt: new Date("2026-11-01T10:00:00.000Z"),
      });

    expect(snapshot?.evaluationSummary).toEqual(trimmed["evaluationSummary"]);
  });

  test("one replaced by the markers alone builds no card, and breaks nothing", () => {
    expect(() => {
      MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog({
        createdStateLog: markersOnly,
        monitorType: MonitorType.Metrics,
        capturedAt: new Date("2026-11-01T10:00:00.000Z"),
      });
    }).not.toThrow();
  });
});
