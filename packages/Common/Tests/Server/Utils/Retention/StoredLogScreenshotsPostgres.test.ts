import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import StoredLogScreenshots, {
  CANDIDATE_MIN_STORED_BYTES,
  DEFAULT_LIMITS,
  SCREENSHOTS_JSON_PATH,
  STORED_LOG_COLUMNS,
  STORED_LOG_TABLES,
  StoredLogScreenshotsSummary,
  StoredLogTable,
  buildPageCandidatesStatement,
  buildReadLogsStatement,
  getDoneMarkerName,
} from "../../../../Server/Utils/Retention/StoredLogScreenshots";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import StateChangeLogScreenshots, {
  SCREENSHOTS_OMITTED_FIELD,
} from "../../../../Utils/Monitor/StateChangeLogScreenshots";
import crypto from "crypto";
import timers from "timers";
import { DataSource } from "typeorm";

/*
 * CLEARING THE SCREENSHOTS STORED LOGS KEPT (issues #6903, #6942), against a
 * migrated Postgres: the real statements and the real DataMigrations rows,
 * over rows written as the product wrote them before - every table whose
 * rows keep a state change's check, with Synthetic screenshots of random
 * base64, which Postgres cannot compress, so each log is stored, TOASTed,
 * at the size a real one is. What is pinned is what a self-hosted
 * installation would see after the hourly job:
 *
 *   - a log with screenshots loses only them, and each run that had some
 *     says so; deleted rows are cleared too;
 *   - every other row is not written at all - not its log, not "updatedAt",
 *     not "version", not even a new row version (xmin): a log without
 *     screenshots, one under the 4 KB threshold, a Custom Code script's
 *     result with a key named screenshots, a row without a log;
 *   - a second walk writes nothing;
 *   - a run keeps to its limits - its pages, its read batches by count and
 *     by size, one row a write - and to its time budget, keeping where it
 *     got to for the next run;
 *   - a table whose walk reached its end gets its DataMigrations row and is
 *     never read again: once every table has one, a run is one read;
 *   - finding the rows to read reads no log: pg_column_size takes the size
 *     from the row, not from TOAST;
 *   - a log without screenshots never comes into this process (#9253): a
 *     grouped Metrics monitor's check from before #9189, tens of megabytes
 *     of JSON, is looked through by Postgres, within the read's statement
 *     timeout, and is neither returned nor written; the path Postgres looks
 *     with finds every log StateChangeLogScreenshots would clear;
 *   - a read Postgres cannot finish within its statement timeout is asked
 *     again a row at a time, and the row it still cannot is left as it is;
 *   - a log with screenshots stored too big to read has its top-level runs'
 *     screenshots cleared by Postgres, to what StateChangeLogScreenshots
 *     would leave; one that keeps them deeper is left as it is;
 *   - a log rewritten between its read and its write is not overwritten;
 *     a row whose lock is held is not waited on past the lock timeout, and
 *     the walk resumes there next run.
 *
 * Opt in with RUN_POSTGRES_STORED_LOG_SCREENSHOTS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_STORED_LOG_SCREENSHOTS_TESTS=true \
 *   STORED_LOG_SCREENSHOTS_TEST_DATABASE_HOST=127.0.0.1 \
 *   STORED_LOG_SCREENSHOTS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Retention/StoredLogScreenshotsPostgres.test.ts
 *
 * Every row is written under a project of the test's own, deleted
 * afterwards, with ids at the top of the id space so that each walk - which
 * starts where the test says, through the cursor seam - covers only the
 * test's rows. The DataMigrations rows the walks write are removed
 * afterwards, and any the database held before put back as they were.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_STORED_LOG_SCREENSHOTS_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_NAME: string = "Stored log screenshots test";

// This run's ids: ffffffff-<run>-4fff-8<test>-<n>, above any random id.
const RUN: string = crypto.randomBytes(2).toString("hex");

function rowId(test: number, n: number): string {
  return `ffffffff-${RUN}-4fff-8${test.toString(16).padStart(3, "0")}-${n.toString(16).padStart(12, "0")}`;
}

// Where a test's walks start: just before its rows.
function walkStart(test: number): string {
  return rowId(test, 0);
}

// Base64 of random bytes: what a PNG is to Postgres's compression.
function screenshot(bytes: number): string {
  return `iVBORw0KGgo${crypto.randomBytes(Math.ceil((bytes * 3) / 4)).toString("base64")}`.slice(
    0,
    bytes,
  );
}

function syntheticLog(screenshotBytes: number = 48 * 1024): JSONObject {
  return {
    monitorId: { _type: "ObjectID", value: ObjectID.generate().toString() },
    isOnline: false,
    failureCause: "The checkout page did not load.",
    monitoredAt: { _type: "DateTime", value: "2026-11-01T10:00:00.000Z" },
    syntheticMonitorResponse: [
      {
        browserType: "Chromium",
        screenSizeType: "Desktop",
        executionTimeInMS: 5120,
        logMessages: ["Opened https://shop.example.com", "Clicked Checkout"],
        scriptError: "Timeout 30000ms exceeded.",
        result: { step: "checkout", ok: false, total: 129.95 },
        capturedMetrics: [{ name: "checkout.load", value: 5120 }],
        screenshots: {
          "checkout-page": screenshot(screenshotBytes),
          "after-click": screenshot(screenshotBytes),
        },
      },
      {
        browserType: "Firefox",
        screenSizeType: "Mobile",
        executionTimeInMS: 4870,
        logMessages: ["Opened https://shop.example.com"],
        result: null,
        capturedMetrics: [],
      },
    ],
  };
}

// The logs a test writes, by what each is for.
enum Shape {
  Synthetic = "Synthetic",
  SyntheticDeleted = "SyntheticDeleted",
  BigWithoutScreenshots = "BigWithoutScreenshots",
  Small = "Small",
  NoLog = "NoLog",
  TinyScreenshot = "TinyScreenshot",
  CustomCodeScreenshots = "CustomCodeScreenshots",
}

function logOf(shape: Shape): JSONObject | null {
  switch (shape) {
    case Shape.Synthetic:
    case Shape.SyntheticDeleted:
      return syntheticLog();
    case Shape.BigWithoutScreenshots:
      return {
        responseCode: 500,
        responseTimeInMs: 912,
        responseBody: screenshot(24 * 1024),
        responseHeaders: { "content-type": "text/html" },
      };
    case Shape.Small:
      return { responseCode: 503, responseTimeInMs: 81 };
    case Shape.NoLog:
      return null;
    case Shape.TinyScreenshot:
      return syntheticLog(200);
    case Shape.CustomCodeScreenshots:
      return {
        customCodeMonitorResponse: {
          result: { screenshots: { home: screenshot(24 * 1024) } },
          logMessages: [],
          executionTimeInMS: 12,
        },
      };
  }
}

const WITH_SCREENSHOTS: ReadonlyArray<Shape> = [
  Shape.Synthetic,
  Shape.SyntheticDeleted,
];

interface RowState {
  id: string;
  xmin: string;
  updatedAt: string;
  version: number;
  log: string | null;
  storedBytes: number | null;
}

interface SeededRow {
  table: StoredLogTable;
  id: string;
  shape: Shape;
}

interface RecordedStatement {
  sql: string;
  params: Array<unknown>;
}

type StatementRunnerInput = Parameters<
  typeof StoredLogScreenshots.runStatement
>[0];

describePostgres(
  "clearing stored log screenshots against a migrated Postgres",
  () => {
    let database: DataSource;
    const projects: Array<string> = [];
    let projectId: string;
    let incidentStateId: string;
    let incidentSeverityId: string;
    let alertStateId: string;
    let alertSeverityId: string;
    let monitorStatusId: string;
    let incidentId: string;
    let alertId: string;
    let monitorId: string;
    // The DataMigrations rows of these names the database held before, put back afterwards.
    let markersBefore: Array<Record<string, unknown>> = [];

    const cursors: Map<StoredLogTable, string> = new Map<
      StoredLogTable,
      string
    >();
    const statements: Array<RecordedStatement> = [];
    const originalRunQuery: typeof StoredLogScreenshots.runQuery =
      StoredLogScreenshots.runQuery;
    const originalRunStatement: typeof StoredLogScreenshots.runStatement =
      StoredLogScreenshots.runStatement;
    // The rows each read returned to this process, and the timeouts each statement had.
    const returned: Array<Record<string, unknown>> = [];
    const timeouts: Array<{
      statementTimeoutMs: number;
      lockTimeoutMs: number;
    }> = [];
    // A read that asks about this row gets a 1 ms statement timeout.
    let forceReadTimeoutFor: string | undefined = undefined;
    // Runs after a read, before its writes.
    let afterRead: (() => Promise<void>) | undefined = undefined;
    const originalNow: typeof StoredLogScreenshots.now =
      StoredLogScreenshots.now;
    const originalReadCursor: typeof StoredLogScreenshots.readCursor =
      StoredLogScreenshots.readCursor;
    const originalSaveCursor: typeof StoredLogScreenshots.saveCursor =
      StoredLogScreenshots.saveCursor;
    const originalForgetCursor: typeof StoredLogScreenshots.forgetCursor =
      StoredLogScreenshots.forgetCursor;

    const markerNames: Array<string> = STORED_LOG_TABLES.map(getDoneMarkerName);

    const id: () => string = (): string => {
      return ObjectID.generate().toString();
    };

    function startWalksAt(test: number): void {
      for (const table of STORED_LOG_TABLES) {
        cursors.set(table, walkStart(test));
      }
    }

    async function deleteMarkers(
      names: Array<string> = markerNames,
    ): Promise<void> {
      await database.query(
        `DELETE FROM "DataMigrations" WHERE "name" = ANY($1)`,
        [names],
      );
    }

    async function markers(): Promise<
      Array<{ name: string; executed: boolean }>
    > {
      return await database.query(
        `SELECT "name", "executed" FROM "DataMigrations" WHERE "name" = ANY($1) ORDER BY "createdAt", "name"`,
        [markerNames],
      );
    }

    async function insertRow(
      table: StoredLogTable,
      rowIdText: string,
      log: JSONObject | null,
      isDeleted: boolean,
    ): Promise<void> {
      const logText: string | null = log === null ? null : JSON.stringify(log);
      const deletedAt: Date | null = isDeleted ? new Date() : null;

      if (table === StoredLogTable.IncidentStateTimeline) {
        await database.query(
          `INSERT INTO "IncidentStateTimeline" ("_id","projectId","incidentId","incidentStateId","version","startsAt","stateChangeLog","deletedAt") VALUES ($1,$2,$3,$4,1,now(),$5::jsonb,$6)`,
          [
            rowIdText,
            projectId,
            incidentId,
            incidentStateId,
            logText,
            deletedAt,
          ],
        );
        return;
      }

      if (table === StoredLogTable.AlertStateTimeline) {
        await database.query(
          `INSERT INTO "AlertStateTimeline" ("_id","projectId","alertId","alertStateId","version","startsAt","stateChangeLog","deletedAt") VALUES ($1,$2,$3,$4,1,now(),$5::jsonb,$6)`,
          [rowIdText, projectId, alertId, alertStateId, logText, deletedAt],
        );
        return;
      }

      if (table === StoredLogTable.Incident) {
        await database.query(
          `INSERT INTO "Incident" ("_id","projectId","title","slug","currentIncidentStateId","incidentSeverityId","version","createdStateLog","deletedAt") VALUES ($1,$2,'Checkout is down',$3,$4,$5,1,$6::jsonb,$7)`,
          [
            rowIdText,
            projectId,
            `incident-${rowIdText}`,
            incidentStateId,
            incidentSeverityId,
            logText,
            deletedAt,
          ],
        );
        return;
      }

      if (table === StoredLogTable.Alert) {
        await database.query(
          `INSERT INTO "Alert" ("_id","projectId","title","currentAlertStateId","alertSeverityId","version","createdStateLog","deletedAt") VALUES ($1,$2,'Checkout latency',$3,$4,1,$5::jsonb,$6)`,
          [
            rowIdText,
            projectId,
            alertStateId,
            alertSeverityId,
            logText,
            deletedAt,
          ],
        );
        return;
      }

      await database.query(
        `INSERT INTO "MonitorStatusTimeline" ("_id","projectId","monitorId","monitorStatusId","version","startsAt","statusChangeLog","deletedAt") VALUES ($1,$2,$3,$4,1,now(),$5::jsonb,$6)`,
        [rowIdText, projectId, monitorId, monitorStatusId, logText, deletedAt],
      );
    }

    // A test's rows: each shape in each table, numbered from 1 in that order.
    async function seed(
      test: number,
      shapes: ReadonlyArray<Shape>,
      tables: ReadonlyArray<StoredLogTable> = STORED_LOG_TABLES,
    ): Promise<Array<SeededRow>> {
      const rows: Array<SeededRow> = [];
      let n: number = 1;

      for (const table of tables) {
        for (const shape of shapes) {
          const seeded: SeededRow = {
            table: table,
            id: rowId(test, n++),
            shape,
          };
          await insertRow(
            table,
            seeded.id,
            logOf(shape),
            shape === Shape.SyntheticDeleted,
          );
          rows.push(seeded);
        }
      }

      return rows;
    }

    async function stateOf(
      rows: Array<SeededRow>,
    ): Promise<Map<string, RowState>> {
      const states: Map<string, RowState> = new Map<string, RowState>();

      for (const table of STORED_LOG_TABLES) {
        const ids: Array<string> = rows
          .filter((row: SeededRow): boolean => {
            return row.table === table;
          })
          .map((row: SeededRow): string => {
            return row.id;
          });

        if (ids.length === 0) {
          continue;
        }

        const column: string = STORED_LOG_COLUMNS[table];
        const found: Array<RowState> = await database.query(
          `SELECT "_id"::text AS "id", xmin::text AS "xmin", "updatedAt"::text AS "updatedAt", "version", "${column}"::text AS "log", pg_column_size("${column}") AS "storedBytes" FROM "${table}" WHERE "_id" = ANY($1::uuid[])`,
          [ids],
        );

        for (const state of found) {
          states.set(state.id, state);
        }
      }

      return states;
    }

    function parsed(state: RowState | undefined): JSONObject {
      return JSON.parse(state!.log!) as JSONObject;
    }

    function writesOf(kind: "UPDATE" | "read"): Array<RecordedStatement> {
      return statements.filter((statement: RecordedStatement): boolean => {
        return kind === "UPDATE"
          ? statement.sql.startsWith("UPDATE")
          : statement.sql.includes(`AS "log"`);
      });
    }

    beforeAll(async () => {
      /*
       * The walk yields after each log it read with setImmediate, which
       * Common's jsdom environment has not: the real Node one, for this
       * suite.
       */
      if (typeof globalThis.setImmediate !== "function") {
        globalThis.setImmediate =
          timers.setImmediate as typeof globalThis.setImmediate;
      }

      database = new DataSource({
        type: "postgres",
        host:
          process.env["STORED_LOG_SCREENSHOTS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["STORED_LOG_SCREENSHOTS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["STORED_LOG_SCREENSHOTS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
      });
      await database.initialize();

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Workflows run elsewhere.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      // What an earlier run of this suite left, if it was stopped half way.
      await database.query(`DELETE FROM "Project" WHERE "name" = $1`, [
        PROJECT_NAME,
      ]);

      markersBefore = await database.query(
        `SELECT * FROM "DataMigrations" WHERE "name" = ANY($1)`,
        [markerNames],
      );
      await deleteMarkers();

      projectId = id();
      projects.push(projectId);
      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,$2,$3,1)`,
        [projectId, PROJECT_NAME, `stored-log-screenshots-${projectId}`],
      );

      incidentStateId = id();
      incidentSeverityId = id();
      alertStateId = id();
      alertSeverityId = id();
      monitorStatusId = id();
      incidentId = id();
      alertId = id();
      monitorId = id();

      await database.query(
        `INSERT INTO "IncidentState" ("_id","projectId","name","slug","color","order","version","isCreatedState") VALUES ($1,$2,'Created',$3,'#000000',1,1,true)`,
        [incidentStateId, projectId, `created-${projectId}`],
      );
      await database.query(
        `INSERT INTO "IncidentSeverity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'High',$3,'#ff0000',1,1)`,
        [incidentSeverityId, projectId, `high-${projectId}`],
      );
      await database.query(
        `INSERT INTO "AlertState" ("_id","projectId","name","color","order","version","isCreatedState") VALUES ($1,$2,'Created','#000000',1,1,true)`,
        [alertStateId, projectId],
      );
      await database.query(
        `INSERT INTO "AlertSeverity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'High',$3,'#ff0000',1,1)`,
        [alertSeverityId, projectId, `high-${projectId}`],
      );
      await database.query(
        `INSERT INTO "MonitorStatus" ("_id","projectId","name","slug","color","priority","version","isOfflineState") VALUES ($1,$2,'Offline',$3,'#ff0000',2,1,true)`,
        [monitorStatusId, projectId, `offline-${projectId}`],
      );

      // The records the state changes belong to, with no log of their own.
      await database.query(
        `INSERT INTO "Incident" ("_id","projectId","title","slug","currentIncidentStateId","incidentSeverityId","version") VALUES ($1,$2,'Checkout is down',$3,$4,$5,1)`,
        [
          incidentId,
          projectId,
          `incident-${incidentId}`,
          incidentStateId,
          incidentSeverityId,
        ],
      );
      await database.query(
        `INSERT INTO "Alert" ("_id","projectId","title","currentAlertStateId","alertSeverityId","version") VALUES ($1,$2,'Checkout latency',$3,$4,1)`,
        [alertId, projectId, alertStateId, alertSeverityId],
      );
      await database.query(
        `INSERT INTO "Monitor" ("_id","projectId","name","slug","monitorType","currentMonitorStatusId","version") VALUES ($1,$2,'Checkout journey',$3,'Synthetic Monitor',$4,1)`,
        [monitorId, projectId, `monitor-${monitorId}`, monitorStatusId],
      );

      // Where each walk starts, as the test says; every statement recorded.
      StoredLogScreenshots.readCursor = async (
        table: StoredLogTable,
      ): Promise<string | undefined> => {
        return cursors.get(table);
      };
      StoredLogScreenshots.saveCursor = async (
        table: StoredLogTable,
        cursor: string,
      ): Promise<void> => {
        cursors.set(table, cursor);
      };
      StoredLogScreenshots.forgetCursor = async (
        table: StoredLogTable,
      ): Promise<void> => {
        cursors.delete(table);
      };
      StoredLogScreenshots.runQuery = async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        statements.push({ sql, params });
        return await originalRunQuery(sql, params);
      };
      StoredLogScreenshots.runStatement = async (
        data: StatementRunnerInput,
      ): Promise<Array<Record<string, unknown>>> => {
        statements.push({ sql: data.sql, params: data.params });
        timeouts.push({
          statementTimeoutMs: data.statementTimeoutMs,
          lockTimeoutMs: data.lockTimeoutMs,
        });

        const isRead: boolean = data.sql.includes(`AS "log"`);
        const rows: Array<Record<string, unknown>> = await originalRunStatement(
          {
            ...data,
            statementTimeoutMs:
              isRead &&
              forceReadTimeoutFor !== undefined &&
              (data.params[0] as Array<string>).includes(forceReadTimeoutFor)
                ? 1
                : data.statementTimeoutMs,
          },
        );

        if (isRead) {
          returned.push(...rows);
          await afterRead?.();
        }

        return rows;
      };
    });

    beforeEach(() => {
      statements.length = 0;
      returned.length = 0;
      timeouts.length = 0;
      forceReadTimeoutFor = undefined;
      afterRead = undefined;
      StoredLogScreenshots.now = originalNow;
    });

    afterAll(async () => {
      StoredLogScreenshots.runQuery = originalRunQuery;
      StoredLogScreenshots.runStatement = originalRunStatement;
      StoredLogScreenshots.now = originalNow;
      StoredLogScreenshots.readCursor = originalReadCursor;
      StoredLogScreenshots.saveCursor = originalSaveCursor;
      StoredLogScreenshots.forgetCursor = originalForgetCursor;
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await deleteMarkers();

        for (const row of markersBefore) {
          const columns: Array<string> = Object.keys(row);
          await database.query(
            `INSERT INTO "DataMigrations" (${columns
              .map((column: string): string => {
                return `"${column}"`;
              })
              .join(",")}) VALUES (${columns
              .map((_column: string, index: number): string => {
                return `$${index + 1}`;
              })
              .join(",")})`,
            columns.map((column: string): unknown => {
              return row[column];
            }),
          );
        }

        if (projects.length > 0) {
          await database.query(`DELETE FROM "Project" WHERE "_id" = ANY($1)`, [
            projects,
          ]);
        }
        await database.destroy();
      }
    });

    let firstRows: Array<SeededRow> = [];
    let afterFirstRun: Map<string, RowState> = new Map<string, RowState>();

    test("a log with screenshots loses only them, in every table, deleted rows too; every other row is not written at all", async () => {
      firstRows = await seed(1, Object.values(Shape) as Array<Shape>);
      const before: Map<string, RowState> = await stateOf(firstRows);
      startWalksAt(1);

      const summary: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run();

      afterFirstRun = await stateOf(firstRows);

      for (const row of firstRows) {
        const was: RowState = before.get(row.id)!;
        const is: RowState = afterFirstRun.get(row.id)!;

        // No change anyone made: the same "updatedAt" and "version" on every row.
        expect({
          id: row.id,
          updatedAt: is.updatedAt,
          version: is.version,
        }).toEqual({
          id: row.id,
          updatedAt: was.updatedAt,
          version: was.version,
        });

        if (WITH_SCREENSHOTS.includes(row.shape)) {
          const cleared: JSONObject = parsed(is);
          const runs: Array<JSONObject> = cleared[
            "syntheticMonitorResponse"
          ] as Array<JSONObject>;

          expect(cleared).toEqual(
            StateChangeLogScreenshots.leaveOut(parsed(was)),
          );
          expect(runs[0]).not.toHaveProperty("screenshots");
          expect(runs[0]![SCREENSHOTS_OMITTED_FIELD]).toBe(true);
          expect(runs[0]!["logMessages"]).toEqual([
            "Opened https://shop.example.com",
            "Clicked Checkout",
          ]);
          expect(runs[0]!["result"]).toEqual({
            step: "checkout",
            ok: false,
            total: 129.95,
          });
          expect(runs[1]).not.toHaveProperty(SCREENSHOTS_OMITTED_FIELD);
          expect(cleared["monitorId"]).toEqual(parsed(was)["monitorId"]);
          // Stored at a few hundred bytes now, from about a hundred kilobytes.
          expect(was.storedBytes!).toBeGreaterThan(90 * 1024);
          expect(is.storedBytes!).toBeLessThan(CANDIDATE_MIN_STORED_BYTES);
          expect(is.xmin).not.toBe(was.xmin);
        } else {
          // Not written: not even a new row version.
          expect({
            id: row.id,
            shape: row.shape,
            xmin: is.xmin,
            log: is.log,
          }).toEqual({
            id: row.id,
            shape: row.shape,
            xmin: was.xmin,
            log: was.log,
          });
        }
      }

      expect(summary.rowsCleared).toBe(2 * STORED_LOG_TABLES.length);
      // Read into this process: only the logs with screenshots - not a big body, not a script's result.
      expect(summary.rowsRead).toBe(2 * STORED_LOG_TABLES.length);
      expect(summary.rowsTooBigToRead).toBe(0);
      expect(
        returned.map((row: Record<string, unknown>): unknown => {
          return row["id"];
        }),
      ).toEqual(
        firstRows
          .filter((row: SeededRow): boolean => {
            return WITH_SCREENSHOTS.includes(row.shape);
          })
          .map((row: SeededRow): string => {
            return row.id;
          }),
      );
      expect(summary.failedRows).toBe(0);
      expect(summary.failedTables).toBe(0);
      expect(summary.isCutShort).toBe(false);
      expect(summary.finishedTables).toEqual(STORED_LOG_TABLES);

      // The tiny screenshot, under the threshold, is kept as it was.
      const tiny: SeededRow = firstRows.find((row: SeededRow): boolean => {
        return row.shape === Shape.TinyScreenshot;
      })!;
      expect(before.get(tiny.id)!.storedBytes!).toBeLessThan(
        CANDIDATE_MIN_STORED_BYTES,
      );
      expect(afterFirstRun.get(tiny.id)!.log).toContain("iVBORw0KGgo");

      // Each table is done, as a DataMigrations row, and its cursor forgotten.
      expect(await markers()).toEqual(
        markerNames.map((name: string) => {
          return { name: name, executed: true };
        }),
      );
      expect(cursors.size).toBe(0);

      // Every write was one row's log, by its id and the size it was read at.
      for (const write of writesOf("UPDATE")) {
        expect(write.sql).not.toContain("updatedAt");
        expect(write.params).toHaveLength(3);
      }

      // Every read and write had its own timeouts.
      expect(timeouts.length).toBeGreaterThan(0);
      for (const timeout of timeouts) {
        expect(timeout).toEqual({
          statementTimeoutMs: DEFAULT_LIMITS.statementTimeoutMs,
          lockTimeoutMs: DEFAULT_LIMITS.lockTimeoutMs,
        });
      }
      expect(writesOf("UPDATE")).toHaveLength(2 * STORED_LOG_TABLES.length);
    });

    test("a second walk writes nothing", async () => {
      // The walks asked for again: their DataMigrations rows removed.
      await deleteMarkers();
      startWalksAt(1);

      const summary: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run();
      const after: Map<string, RowState> = await stateOf(firstRows);

      expect(writesOf("UPDATE")).toEqual([]);
      expect(summary.rowsCleared).toBe(0);
      // The logs still big - a body, a script's result - are asked about, and none is read.
      expect(writesOf("read").length).toBeGreaterThan(0);
      expect(summary.rowsRead).toBe(0);
      expect(returned).toEqual([]);
      expect(summary.finishedTables).toEqual(STORED_LOG_TABLES);

      for (const row of firstRows) {
        expect({ id: row.id, xmin: after.get(row.id)!.xmin }).toEqual({
          id: row.id,
          xmin: afterFirstRun.get(row.id)!.xmin,
        });
      }
    });

    test("keeps to its limits: pages of scanPageSize rows, reads of readBatchSize logs, one row a write", async () => {
      await deleteMarkers();
      const s: Shape = Shape.Synthetic;
      const rows: Array<SeededRow> = await seed(
        3,
        [s, s, s, s, s, Shape.Small, s, Shape.Small, s, s],
        [StoredLogTable.IncidentStateTimeline],
      );
      const idOf: (n: number) => string = (n: number): string => {
        return rows[n - 1]!.id;
      };
      startWalksAt(3);

      const summary: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run({
          limits: { ...DEFAULT_LIMITS, scanPageSize: 4, readBatchSize: 2 },
        });

      const pageEnds: Array<RecordedStatement> = statements.filter(
        (statement: RecordedStatement): boolean => {
          return (
            statement.sql.includes("OFFSET") &&
            statement.sql.includes(`"IncidentStateTimeline"`)
          );
        },
      );
      // The candidates of each page: its rows' logs by stored size.
      const pages: Array<RecordedStatement> = statements.filter(
        (statement: RecordedStatement): boolean => {
          return (
            statement.sql.includes(`"stateChangeLog") >= $`) &&
            statement.sql.includes(`"IncidentStateTimeline"`)
          );
        },
      );

      /*
       * Ten rows, four a page: two pages that end at their fourth row, and the
       * last, which runs to the table's end.
       */
      expect(
        pageEnds.map((pageEnd: RecordedStatement): Array<unknown> => {
          return pageEnd.params;
        }),
      ).toEqual([
        [walkStart(3), 3],
        [idOf(4), 3],
        [idOf(8), 3],
      ]);

      // Every page covers at most four rows.
      expect(pages).toHaveLength(3);

      for (const page of pages) {
        const bounds: Array<unknown> = page.params.slice(0, -1);
        const inPage: Array<{ count: number }> = await database.query(
          `SELECT count(*)::int AS "count" FROM "IncidentStateTimeline" WHERE "_id" > $1::uuid${bounds.length > 1 ? ` AND "_id" <= $2::uuid` : ""}`,
          bounds,
        );

        expect(inPage[0]!.count).toBeLessThanOrEqual(4);
      }

      // Two logs a read, in id order: the first page's four in two reads.
      expect(
        writesOf("read").map((read: RecordedStatement): unknown => {
          return read.params[0];
        }),
      ).toEqual([
        [idOf(1), idOf(2)],
        [idOf(3), idOf(4)],
        [idOf(5), idOf(7)],
        [idOf(9), idOf(10)],
      ]);

      const writes: Array<RecordedStatement> = writesOf("UPDATE");

      expect(
        writes.map((write: RecordedStatement): unknown => {
          return write.params[0];
        }),
      ).toEqual([1, 2, 3, 4, 5, 7, 9, 10].map(idOf));
      expect(summary.rowsCleared).toBe(8);
      expect(summary.finishedTables).toEqual(STORED_LOG_TABLES);

      const after: Map<string, RowState> = await stateOf(rows);

      for (const row of rows) {
        expect(after.get(row.id)!.log).not.toContain("iVBORw0KGgo");
      }
    });

    test("reads no more than readBatchMaxStoredBytes of logs at a time, as Postgres stores them: a bigger one alone", async () => {
      await deleteMarkers();
      const rows: Array<SeededRow> = await seed(
        4,
        [Shape.Synthetic, Shape.Synthetic, Shape.Synthetic],
        [StoredLogTable.Alert],
      );
      startWalksAt(4);

      // Each log is stored at about 96 KB: two would pass 150 KB.
      await StoredLogScreenshots.run({
        limits: {
          ...DEFAULT_LIMITS,
          readBatchSize: 10,
          readBatchMaxStoredBytes: 150 * 1024,
        },
      });

      expect(
        writesOf("read").map((read: RecordedStatement): unknown => {
          return read.params[0];
        }),
      ).toEqual(
        rows.map((row: SeededRow): Array<string> => {
          return [row.id];
        }),
      );
      expect(writesOf("UPDATE")).toHaveLength(3);
    });

    test("stops at its time budget, keeps where it got to, and the next run carries on and finishes", async () => {
      await deleteMarkers();
      const table: StoredLogTable = StoredLogTable.MonitorStatusTimeline;
      const rows: Array<SeededRow> = await seed(
        5,
        [
          Shape.Synthetic,
          Shape.Synthetic,
          Shape.Synthetic,
          Shape.Synthetic,
          Shape.Synthetic,
          Shape.Synthetic,
        ],
        [table],
      );
      const before: Map<string, RowState> = await stateOf(rows);
      startWalksAt(5);

      // Only this table walked: the others are done.
      for (const other of STORED_LOG_TABLES) {
        if (other !== table) {
          await StoredLogScreenshots.markTableDone(other);
        }
      }

      // A second a statement, on the run's clock.
      let clock: number = Date.now();
      StoredLogScreenshots.now = (): Date => {
        return new Date(clock);
      };
      const runQuery: typeof StoredLogScreenshots.runQuery =
        StoredLogScreenshots.runQuery;
      const runStatement: typeof StoredLogScreenshots.runStatement =
        StoredLogScreenshots.runStatement;
      StoredLogScreenshots.runQuery = async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        clock += 1000;
        return await runQuery(sql, params);
      };
      StoredLogScreenshots.runStatement = async (
        data: StatementRunnerInput,
      ): Promise<Array<Record<string, unknown>>> => {
        clock += 1000;
        return await runStatement(data);
      };

      let summary: StoredLogScreenshotsSummary;

      try {
        /*
         * The markers' read; a first page of two - its end, its candidates,
         * a read and a write each - then the second page's end, its
         * candidates, and one row of it, before the next row starts past the
         * budget.
         */
        summary = await StoredLogScreenshots.run({
          timeBudgetMs: 9500,
          limits: { ...DEFAULT_LIMITS, scanPageSize: 2, readBatchSize: 1 },
        });
      } finally {
        StoredLogScreenshots.runQuery = runQuery;
        StoredLogScreenshots.runStatement = runStatement;
        StoredLogScreenshots.now = originalNow;
      }

      let after: Map<string, RowState> = await stateOf(rows);
      const clearedFirst: Array<string> = rows
        .filter((row: SeededRow): boolean => {
          return after.get(row.id)!.xmin !== before.get(row.id)!.xmin;
        })
        .map((row: SeededRow): string => {
          return row.id;
        });

      expect(summary.isCutShort).toBe(true);
      expect(summary.finishedTables).toEqual([]);
      expect(clearedFirst).toEqual([rows[0]!.id, rows[1]!.id, rows[2]!.id]);
      expect(cursors.get(table)).toBe(rows[2]!.id);
      expect(
        (await markers()).map((marker: { name: string }): string => {
          return marker.name;
        }),
      ).not.toContain(getDoneMarkerName(table));

      statements.length = 0;
      const next: StoredLogScreenshotsSummary = await StoredLogScreenshots.run({
        limits: { ...DEFAULT_LIMITS, scanPageSize: 2, readBatchSize: 1 },
      });

      expect(statements[1]!.params[0]).toBe(rows[2]!.id);
      expect(next.rowsCleared).toBe(3);
      expect(next.finishedTables).toEqual([table]);

      after = await stateOf(rows);

      for (const row of rows) {
        expect(after.get(row.id)!.log).not.toContain("iVBORw0KGgo");
      }
    });

    test("once every table is done, a run is one read; a table whose DataMigrations row is gone is walked again, alone", async () => {
      expect(
        (await markers()).map((marker: { name: string }): string => {
          return marker.name;
        }),
      ).toEqual(markerNames);

      const summary: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run();

      expect(summary.isEveryTableDone).toBe(true);
      expect(statements).toHaveLength(1);
      expect(statements[0]!.sql).toContain(`FROM "DataMigrations" m`);

      await deleteMarkers([getDoneMarkerName(StoredLogTable.Alert)]);
      startWalksAt(6);
      statements.length = 0;

      const again: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run();

      expect(again.finishedTables).toEqual([StoredLogTable.Alert]);
      expect(
        statements.slice(1).every((statement: RecordedStatement): boolean => {
          return statement.sql.includes(`"Alert"`);
        }),
      ).toBe(true);
      expect(
        (await markers()).map((marker: { name: string }): string => {
          return marker.name;
        }),
      ).toContain(getDoneMarkerName(StoredLogTable.Alert));
    });

    test("finding the rows to read reads no log: pg_column_size takes the size from the row, not from TOAST", async () => {
      const rows: Array<SeededRow> = await seed(
        7,
        [Shape.Synthetic],
        [StoredLogTable.Incident],
      );
      const big: JSONObject = syntheticLog(1024 * 1024);
      await database.query(
        `UPDATE "Incident" SET "createdStateLog" = $2::jsonb WHERE "_id" = $1::uuid`,
        [rows[0]!.id, JSON.stringify(big)],
      );

      const buffersOf: (
        sql: string,
        params: Array<unknown>,
      ) => Promise<number> = async (
        sql: string,
        params: Array<unknown>,
      ): Promise<number> => {
        const plan: Array<{ "QUERY PLAN": string }> = await database.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
          params,
        );
        const top: string =
          plan.find((line: { "QUERY PLAN": string }): boolean => {
            return line["QUERY PLAN"].includes("Buffers:");
          })?.["QUERY PLAN"] || "";
        const hit: number = Number(top.match(/hit=(\d+)/)?.[1] || 0);
        const read: number = Number(top.match(/read=(\d+)/)?.[1] || 0);

        return hit + read;
      };

      const candidates: { sql: string; params: Array<unknown> } =
        buildPageCandidatesStatement({
          table: StoredLogTable.Incident,
          afterId: walkStart(7),
          throughId: rows[0]!.id,
          minStoredBytes: CANDIDATE_MIN_STORED_BYTES,
        });
      const read: { sql: string; params: Array<unknown> } =
        buildReadLogsStatement({
          table: StoredLogTable.Incident,
          ids: [rows[0]!.id],
        });

      const found: Array<{ id: string; storedBytes: number }> =
        await database.query(candidates.sql, candidates.params);

      expect(found).toEqual([
        {
          id: rows[0]!.id,
          storedBytes: expect.any(Number) as unknown as number,
        },
      ]);
      // The log is two megabytes of screenshots, stored as such.
      expect(found[0]!.storedBytes).toBeGreaterThan(2 * 1024 * 1024);

      const findingBuffers: number = await buffersOf(
        candidates.sql,
        candidates.params,
      );
      const readingBuffers: number = await buffersOf(read.sql, read.params);

      // Two megabytes are some 256 pages of TOAST; finding the row reads a handful.
      expect(findingBuffers).toBeLessThan(20);
      expect(readingBuffers).toBeGreaterThan(200);
    });

    /*
     * A grouped Metrics monitor's check as kept before #9189: every series
     * of five queries, built by Postgres, never in Node - tens of megabytes
     * of JSON, and no screenshots.
     */
    async function insertFleetAlert(
      rowIdText: string,
      seriesCount: number,
    ): Promise<{ storedBytes: number; jsonBytes: number }> {
      await database.query(
        `INSERT INTO "Alert" ("_id","projectId","title","currentAlertStateId","alertSeverityId","version","createdStateLog")
        SELECT $1::uuid, $2::uuid, 'Container restarted', $3::uuid, $4::uuid, 1,
          jsonb_build_object(
            'isOnline', false,
            'evaluationSummary', jsonb_build_object('criteriaResults', jsonb_build_array(jsonb_build_object('criteriaName', 'Restarted', 'isMet', true))),
            'seriesBreakdown', (SELECT jsonb_agg(jsonb_build_object('fingerprint', md5(i::text), 'labels', jsonb_build_object('resource.host.name', 'host-' || (i / 36), 'resource.container.name', 'container-' || md5(i::text)),
              'aggregatedResults', (SELECT jsonb_agg(jsonb_build_object('query', q, 'data', jsonb_build_array(jsonb_build_object('value', round((random() * 100)::numeric, 3), 'timestamp', '2026-11-01T10:00:00.000Z', 'attributes', jsonb_build_object('resource.host.name', 'host-' || (i / 36), 'resource.container.name', 'container-' || md5(i::text)))))) FROM generate_series(1, 5) q))) FROM generate_series(1, $5::int) i),
            'metricResult', (SELECT jsonb_agg(jsonb_build_object('query', q, 'data', (SELECT jsonb_agg(jsonb_build_object('value', round((random() * 100)::numeric, 3), 'timestamp', '2026-11-01T10:00:00.000Z', 'attributes', jsonb_build_object('resource.host.name', 'host-' || (i / 36), 'resource.container.name', 'container-' || md5(i::text)))) FROM generate_series(1, $5::int) i))) FROM generate_series(1, 5) q)
          )`,
        [rowIdText, projectId, alertStateId, alertSeverityId, seriesCount],
      );

      const sizes: Array<{ storedBytes: number; jsonBytes: string }> =
        await database.query(
          `SELECT pg_column_size("createdStateLog") AS "storedBytes", octet_length("createdStateLog"::text)::text AS "jsonBytes" FROM "Alert" WHERE "_id" = $1::uuid`,
          [rowIdText],
        );

      return {
        storedBytes: sizes[0]!.storedBytes,
        jsonBytes: Number(sizes[0]!.jsonBytes),
      };
    }

    test("a grouped Metrics monitor's check from before #9189 - 16,158 series, tens of megabytes of JSON - is looked through by Postgres and never comes into this process (#9253)", async () => {
      await deleteMarkers();
      const fleetId: string = rowId(8, 1);
      const size: { storedBytes: number; jsonBytes: number } =
        await insertFleetAlert(fleetId, 16158);
      const synthetic: string = rowId(8, 2);
      await insertRow(StoredLogTable.Alert, synthetic, syntheticLog(), false);
      const rows: Array<SeededRow> = [
        { table: StoredLogTable.Alert, id: fleetId, shape: Shape.Small },
        {
          table: StoredLogTable.Alert,
          id: synthetic,
          shape: Shape.Synthetic,
        },
      ];
      const before: Map<string, RowState> = await stateOf(rows);
      expect(size.jsonBytes).toBeGreaterThan(30 * 1024 * 1024);
      expect(size.storedBytes).toBeGreaterThan(CANDIDATE_MIN_STORED_BYTES);
      startWalksAt(8);

      // Each JSON text this process parses during the run.
      const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");
      let summary: StoredLogScreenshotsSummary;
      const startedAt: number = Date.now();

      try {
        summary = await StoredLogScreenshots.run();
      } finally {
        parse.mockRestore();
      }

      const tookMs: number = Date.now() - startedAt;
      const after: Map<string, RowState> = await stateOf(rows);

      // Asked about, by id - and only the Synthetic log came back.
      expect(
        writesOf("read").some((read: RecordedStatement): boolean => {
          return (read.params[0] as Array<string>).includes(fleetId);
        }),
      ).toBe(true);
      expect(
        returned.map((row: Record<string, unknown>): unknown => {
          return row["id"];
        }),
      ).toEqual([synthetic]);
      for (const call of parse.mock.calls) {
        expect(String(call[0])).not.toContain("seriesBreakdown");
      }

      // The fleet's check is not written; the Synthetic log lost its screenshots.
      expect(after.get(fleetId)!.xmin).toBe(before.get(fleetId)!.xmin);
      expect(after.get(synthetic)!.log).not.toContain("iVBORw0KGgo");
      expect(summary.rowsRead).toBe(1);
      expect(summary.rowsCleared).toBe(1);
      expect(summary.rowsTooBigToRead).toBe(0);
      expect(summary.failedRows).toBe(0);
      expect(summary.finishedTables).toEqual(STORED_LOG_TABLES);
      // Far within one read's statement timeout, the walk of every table included.
      expect(tookMs).toBeLessThan(DEFAULT_LIMITS.statementTimeoutMs / 3);
    }, 300000);

    test("a read Postgres cannot finish within its statement timeout is asked again a row at a time; the row it still cannot is left as it is, and the walk finishes", async () => {
      await deleteMarkers();
      const first: string = rowId(9, 1);
      const fleetId: string = rowId(9, 2);
      const last: string = rowId(9, 3);
      await insertRow(StoredLogTable.Alert, first, syntheticLog(), false);
      await insertFleetAlert(fleetId, 4000);
      await insertRow(StoredLogTable.Alert, last, syntheticLog(), false);
      const rows: Array<SeededRow> = [first, fleetId, last].map(
        (each: string): SeededRow => {
          return { table: StoredLogTable.Alert, id: each, shape: Shape.Small };
        },
      );
      const before: Map<string, RowState> = await stateOf(rows);
      startWalksAt(9);
      forceReadTimeoutFor = fleetId;

      const summary: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run();
      const after: Map<string, RowState> = await stateOf(rows);

      expect(
        writesOf("read")
          .filter((read: RecordedStatement): boolean => {
            return read.sql.includes(`FROM "Alert" t`);
          })
          .map((read: RecordedStatement): unknown => {
            return read.params[0];
          }),
      ).toEqual([[first, fleetId, last], [first], [fleetId], [last]]);
      expect(summary.rowsTooBigToRead).toBe(1);
      expect(summary.rowsCleared).toBe(2);
      expect(summary.failedRows).toBe(0);
      expect(summary.finishedTables).toEqual(STORED_LOG_TABLES);
      expect(after.get(fleetId)!.xmin).toBe(before.get(fleetId)!.xmin);
      expect(after.get(first)!.log).not.toContain("iVBORw0KGgo");
      expect(after.get(last)!.log).not.toContain("iVBORw0KGgo");
    }, 300000);

    test("a log rewritten between its read and its write - trimmed by another job, say - is not overwritten with the copy read before", async () => {
      await deleteMarkers();
      const raced: string = rowId(10, 1);
      await insertRow(StoredLogTable.Incident, raced, syntheticLog(), false);
      const rewritten: JSONObject = {
        isEvidenceTruncated: true,
        note: "rewritten by someone else",
      };
      startWalksAt(10);
      afterRead = async (): Promise<void> => {
        await database.query(
          `UPDATE "Incident" SET "createdStateLog" = $2::jsonb WHERE "_id" = $1::uuid`,
          [raced, JSON.stringify(rewritten)],
        );
      };

      const summary: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run();
      const after: Map<string, RowState> = await stateOf([
        { table: StoredLogTable.Incident, id: raced, shape: Shape.Synthetic },
      ]);

      expect(writesOf("UPDATE")).toHaveLength(1);
      expect(parsed(after.get(raced))).toEqual(rewritten);
      expect(summary.rowsRead).toBe(1);
      expect(summary.rowsCleared).toBe(0);
      expect(summary.failedRows).toBe(0);
      expect(summary.finishedTables).toEqual(STORED_LOG_TABLES);
    });

    test("a row whose lock is held is not waited on for longer than the lock timeout: the walk stops there and resumes next run", async () => {
      await deleteMarkers();
      const first: string = rowId(11, 1);
      const locked: string = rowId(11, 2);
      await insertRow(
        StoredLogTable.MonitorStatusTimeline,
        first,
        syntheticLog(),
        false,
      );
      await insertRow(
        StoredLogTable.MonitorStatusTimeline,
        locked,
        syntheticLog(),
        false,
      );
      const rows: Array<SeededRow> = [first, locked].map(
        (each: string): SeededRow => {
          return {
            table: StoredLogTable.MonitorStatusTimeline,
            id: each,
            shape: Shape.Synthetic,
          };
        },
      );

      const holder: ReturnType<DataSource["createQueryRunner"]> =
        database.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(
        `SELECT 1 FROM "MonitorStatusTimeline" WHERE "_id" = $1::uuid FOR UPDATE`,
        [locked],
      );

      try {
        startWalksAt(11);
        const startedAt: number = Date.now();
        const summary: StoredLogScreenshotsSummary =
          await StoredLogScreenshots.run({
            limits: { ...DEFAULT_LIMITS, lockTimeoutMs: 200 },
          });

        expect(Date.now() - startedAt).toBeLessThan(
          DEFAULT_LIMITS.statementTimeoutMs,
        );
        expect(summary.rowsCleared).toBe(1);
        expect(summary.failedRows).toBe(1);
        expect(summary.finishedTables).not.toContain(
          StoredLogTable.MonitorStatusTimeline,
        );
        // Where it got to: the row before the one it could not write.
        expect(cursors.get(StoredLogTable.MonitorStatusTimeline)).toBe(first);
      } finally {
        await holder.rollbackTransaction();
        await holder.release();
      }

      const resumed: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run();
      const after: Map<string, RowState> = await stateOf(rows);

      expect(resumed.rowsCleared).toBe(1);
      expect(resumed.failedRows).toBe(0);
      expect(resumed.finishedTables).toEqual([
        StoredLogTable.MonitorStatusTimeline,
      ]);
      expect(after.get(locked)!.log).not.toContain("iVBORw0KGgo");
    });

    test("a log with screenshots stored too big to read has its runs' screenshots cleared by Postgres, to what StateChangeLogScreenshots would leave; one keeping them deeper is left as it is", async () => {
      await deleteMarkers();
      const top: string = rowId(12, 1);
      const deep: string = rowId(12, 2);
      await insertRow(StoredLogTable.Incident, top, syntheticLog(), false);
      await insertRow(
        StoredLogTable.Incident,
        deep,
        { steps: [syntheticLog()] },
        false,
      );
      const rows: Array<SeededRow> = [top, deep].map(
        (each: string): SeededRow => {
          return {
            table: StoredLogTable.Incident,
            id: each,
            shape: Shape.Synthetic,
          };
        },
      );
      const before: Map<string, RowState> = await stateOf(rows);
      startWalksAt(12);

      // Both are stored at about 96 KB: above 64 KB, too big to read here.
      const summary: StoredLogScreenshotsSummary =
        await StoredLogScreenshots.run({
          limits: { ...DEFAULT_LIMITS, readMaxStoredBytes: 64 * 1024 },
        });
      const after: Map<string, RowState> = await stateOf(rows);

      // Neither log's text came to this process.
      expect(
        returned.map((row: Record<string, unknown>): unknown => {
          return row["log"];
        }),
      ).toEqual([null, null]);
      expect(parsed(after.get(top))).toEqual(
        StateChangeLogScreenshots.leaveOut(parsed(before.get(top))),
      );
      expect(after.get(top)!.storedBytes!).toBeLessThan(
        CANDIDATE_MIN_STORED_BYTES,
      );
      expect(after.get(top)!.updatedAt).toBe(before.get(top)!.updatedAt);
      expect(after.get(top)!.version).toBe(before.get(top)!.version);
      expect(after.get(deep)!.xmin).toBe(before.get(deep)!.xmin);
      expect(summary.rowsRead).toBe(0);
      expect(summary.rowsCleared).toBe(1);
      expect(summary.rowsTooBigToRead).toBe(1);
      expect(summary.failedRows).toBe(0);
      expect(summary.finishedTables).toEqual(STORED_LOG_TABLES);
    });

    test("the path Postgres looks with finds every log StateChangeLogScreenshots would clear, and leaves out a script's own screenshots", async () => {
      const run: (screenshots: unknown) => JSONObject = (
        screenshots: unknown,
      ): JSONObject => {
        return { browserType: "Chromium", screenshots } as JSONObject;
      };
      const cases: Array<{ log: unknown; isFound: boolean }> = [
        { log: syntheticLog(1024), isFound: true },
        { log: { syntheticMonitorResponse: [run({ a: "x" })] }, isFound: true },
        // Deeper, and in a list: StateChangeLogScreenshots walks there too.
        {
          log: {
            steps: [{ check: { syntheticMonitorResponse: [run({ a: "x" })] } }],
          },
          isFound: true,
        },
        {
          log: { syntheticMonitorResponse: [1, "text", run({ a: "x" })] },
          isFound: true,
        },
        // Wider than the rule, which these pass: read, and left as they are.
        { log: { syntheticMonitorResponse: run({ a: "x" }) }, isFound: true },
        {
          log: [{ syntheticMonitorResponse: [run({ a: "x" })] }],
          isFound: true,
        },
        // Nothing to clear.
        { log: { syntheticMonitorResponse: [run({})] }, isFound: false },
        { log: { syntheticMonitorResponse: [run(null)] }, isFound: false },
        { log: { syntheticMonitorResponse: [run("text")] }, isFound: false },
        { log: { syntheticMonitorResponse: [] }, isFound: false },
        {
          log: {
            customCodeMonitorResponse: { result: { screenshots: { a: "x" } } },
          },
          isFound: false,
        },
        { log: { screenshots: { a: "x" } }, isFound: false },
        { log: "a log kept as text", isFound: false },
        { log: { responseCode: 500 }, isFound: false },
      ];

      for (const each of cases) {
        const found: Array<{ isFound: boolean }> = await database.query(
          `SELECT jsonb_path_exists($1::jsonb, $2::jsonpath, '{}'::jsonb, true) AS "isFound"`,
          [JSON.stringify(each.log), SCREENSHOTS_JSON_PATH],
        );

        expect({ log: each.log, isFound: found[0]!.isFound }).toEqual(each);

        // Never narrower than the rule: what it would clear, Postgres finds.
        if (
          typeof each.log === "object" &&
          each.log !== null &&
          !Array.isArray(each.log) &&
          StateChangeLogScreenshots.leaveOut(each.log as JSONObject) !==
            each.log
        ) {
          expect({ log: each.log, isFound: found[0]!.isFound }).toEqual({
            log: each.log,
            isFound: true,
          });
        }
      }
    });
  },
);
