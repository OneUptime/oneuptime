import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import OversizedStoredChecks, {
  CANDIDATE_MIN_STORED_BYTES,
  DEFAULT_LIMITS,
  OVERSIZED_CHECK_TABLES,
  OversizedStoredChecksSummary,
  TRIMMED_BY_CLEANUP_FIELD,
  TRIMMED_BY_CLEANUP_NOTE,
  TRIMMED_MAX_JSON_BYTES,
  getDoneMarkerName,
} from "../../../../Server/Utils/Retention/OversizedStoredChecks";
import {
  STORED_LOG_COLUMNS,
  StoredLogTable,
} from "../../../../Server/Utils/Retention/StoredLogScreenshots";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import StoredCheckEvidence from "../../../../Utils/Monitor/StoredCheckEvidence";
import crypto from "crypto";
import timers from "timers";
import { DataSource } from "typeorm";

/*
 * TRIMMING THE OVERSIZED CHECKS STORED BEFORE #9189, against a migrated
 * Postgres (issue #9232): the real statements and the real DataMigrations
 * rows, over rows written as the product wrote them before - a grouped
 * Metrics monitor's whole evaluation, every series with its own points, of
 * random values Postgres cannot compress much, so each check is stored,
 * TOASTed, past the threshold. Pinned:
 *
 *   - an alert, an incident and their state timeline rows keep their own
 *     series - its breakdown entry, its points, its arrivals - the
 *     evaluation's small fields, and say they were trimmed and by what;
 *   - a monitor status change keeps no series, a record whose series the
 *     evaluation did not have keeps empty lists;
 *   - a check still past the limit without its series keeps its small
 *     fields only, and every trimmed check is within the limit;
 *   - a check Postgres cannot trim within its statement timeout is replaced
 *     by the markers alone, with the real timeout error;
 *   - rows under the threshold, and rows without a check, are not written
 *     at all - not even a new row version (xmin) - nor are "updatedAt" and
 *     "version" of the rows trimmed;
 *   - a second walk writes nothing; a table walked to its end gets its
 *     DataMigrations row; once every table has one, a run is one read;
 *   - the trim runs in a transaction with its own statement and lock
 *     timeouts.
 *
 * Opt in with RUN_POSTGRES_OVERSIZED_STORED_CHECKS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_OVERSIZED_STORED_CHECKS_TESTS=true \
 *   OVERSIZED_STORED_CHECKS_TEST_DATABASE_HOST=127.0.0.1 \
 *   OVERSIZED_STORED_CHECKS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Retention/OversizedStoredChecksPostgres.test.ts
 *
 * Every row is written under a project of the test's own, deleted
 * afterwards, with ids at the top of the id space so that each walk - which
 * starts where the test says, through the cursor seam - covers only the
 * test's rows. The DataMigrations rows the walks write are removed
 * afterwards, and any the database held before put back as they were.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_OVERSIZED_STORED_CHECKS_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_NAME: string = "Oversized stored checks test";

// This run's ids: ffffffff-<run>-4fff-8<test>-<n>, above any random id.
const RUN: string = crypto.randomBytes(2).toString("hex");

function rowId(test: number, n: number): string {
  return `ffffffff-${RUN}-4fff-8${test.toString(16).padStart(3, "0")}-${n.toString(16).padStart(12, "0")}`;
}

function walkStart(test: number): string {
  return rowId(test, 0);
}

function random(bytes: number): string {
  return crypto
    .randomBytes(Math.ceil(bytes / 2))
    .toString("hex")
    .slice(0, bytes);
}

const SERIES_COUNT: number = 1500;
const QUERY_COUNT: number = 3;

function fingerprintOf(n: number): string {
  return `fp${n.toString(16).padStart(14, "0")}`;
}

// What each series' points are, query by query: its aggregatedResults.
function pointsOf(n: number): Array<JSONObject> {
  const points: Array<JSONObject> = [];

  for (let q: number = 0; q < QUERY_COUNT; q++) {
    points.push({
      data: [
        {
          value: n * 10 + q,
          timestamp: "2026-11-01T10:00:00.000Z",
          attributes: {
            "resource.host.name": `host-${n}`,
            "resource.container.name": `container-${random(48)}`,
          },
        },
      ],
    });
  }

  return points;
}

// A grouped Metrics monitor's whole evaluation, as it was kept before #9189.
function fleetCheck(): JSONObject {
  const breakdown: Array<JSONObject> = [];
  const metricResult: Array<JSONObject> = [];

  for (let q: number = 0; q < QUERY_COUNT; q++) {
    metricResult.push({ data: [] });
  }

  for (let n: number = 0; n < SERIES_COUNT; n++) {
    const points: Array<JSONObject> = pointsOf(n);

    breakdown.push({
      fingerprint: fingerprintOf(n),
      labels: { "resource.host.name": `host-${n}` },
      aggregatedResults: points,
      arrivals: [{ at: `2026-11-01T10:00:0${n % 10}.000Z` }],
    });

    for (let q: number = 0; q < QUERY_COUNT; q++) {
      (metricResult[q]!["data"] as Array<JSONObject>).push(
        ...(points[q]!["data"] as Array<JSONObject>),
      );
    }
  }

  return {
    monitorId: { _type: "ObjectID", value: ObjectID.generate().toString() },
    evaluationSummary: {
      criteriaResults: [{ criteriaName: "Restarted", isMet: true }],
    },
    metricViewConfig: { queryConfigs: [{ name: "container.restarts" }] },
    monitoredAt: { _type: "DateTime", value: "2026-11-01T10:00:00.000Z" },
    seriesBreakdown: breakdown,
    metricResult: metricResult,
    metricResultArrivals: breakdown.map((entry: JSONObject): unknown => {
      return entry["arrivals"];
    }),
  };
}

// A check past the limit that is not a fleet: a huge response body.
function hugeBodyCheck(): JSONObject {
  return {
    responseCode: 500,
    responseTimeInMs: 912,
    responseBody: random(1024 * 1024),
    responseHeaders: { "content-type": "text/html" },
  };
}

const OWN_SERIES: number = 417;

interface RowState {
  id: string;
  xmin: string;
  updatedAt: string;
  version: number;
  log: string | null;
  storedBytes: number | null;
}

describePostgres(
  "trimming oversized stored checks against a migrated Postgres",
  () => {
    let database: DataSource;
    let projectId: string;
    let incidentStateId: string;
    let incidentSeverityId: string;
    let alertStateId: string;
    let alertSeverityId: string;
    let monitorStatusId: string;
    let monitorId: string;
    let markersBefore: Array<Record<string, unknown>> = [];

    const cursors: Map<StoredLogTable, string> = new Map<
      StoredLogTable,
      string
    >();
    const statements: Array<{ sql: string; params: Array<unknown> }> = [];
    const timeouts: Array<{ statementTimeoutMs: number }> = [];
    let forceTrimTimeoutMs: number | undefined = undefined;

    const originals: {
      runQuery: typeof OversizedStoredChecks.runQuery;
      runStatement: typeof OversizedStoredChecks.runStatement;
      readCursor: typeof OversizedStoredChecks.readCursor;
      saveCursor: typeof OversizedStoredChecks.saveCursor;
      forgetCursor: typeof OversizedStoredChecks.forgetCursor;
    } = {
      runQuery: OversizedStoredChecks.runQuery,
      runStatement: OversizedStoredChecks.runStatement,
      readCursor: OversizedStoredChecks.readCursor,
      saveCursor: OversizedStoredChecks.saveCursor,
      forgetCursor: OversizedStoredChecks.forgetCursor,
    };

    const markerNames: Array<string> =
      OVERSIZED_CHECK_TABLES.map(getDoneMarkerName);

    const id: () => string = (): string => {
      return ObjectID.generate().toString();
    };

    function startWalksAt(test: number): void {
      for (const table of OVERSIZED_CHECK_TABLES) {
        cursors.set(table, walkStart(test));
      }
    }

    async function deleteMarkers(): Promise<void> {
      await database.query(
        `DELETE FROM "DataMigrations" WHERE "name" = ANY($1)`,
        [markerNames],
      );
    }

    async function insertAlert(
      rowIdText: string,
      log: JSONObject | null,
      fingerprint: string | null,
    ): Promise<void> {
      await database.query(
        `INSERT INTO "Alert" ("_id","projectId","title","currentAlertStateId","alertSeverityId","version","createdStateLog","seriesFingerprint") VALUES ($1,$2,'Container restarted',$3,$4,1,$5::jsonb,$6)`,
        [
          rowIdText,
          projectId,
          alertStateId,
          alertSeverityId,
          log === null ? null : JSON.stringify(log),
          fingerprint,
        ],
      );
    }

    async function insertIncident(
      rowIdText: string,
      log: JSONObject | null,
      fingerprint: string | null,
    ): Promise<void> {
      await database.query(
        `INSERT INTO "Incident" ("_id","projectId","title","slug","currentIncidentStateId","incidentSeverityId","version","createdStateLog","seriesFingerprint") VALUES ($1,$2,'Container restarted',$3,$4,$5,1,$6::jsonb,$7)`,
        [
          rowIdText,
          projectId,
          `incident-${rowIdText}`,
          incidentStateId,
          incidentSeverityId,
          log === null ? null : JSON.stringify(log),
          fingerprint,
        ],
      );
    }

    async function insertAlertState(
      rowIdText: string,
      alertId: string,
      log: JSONObject | null,
    ): Promise<void> {
      await database.query(
        `INSERT INTO "AlertStateTimeline" ("_id","projectId","alertId","alertStateId","version","startsAt","stateChangeLog") VALUES ($1,$2,$3,$4,1,now(),$5::jsonb)`,
        [
          rowIdText,
          projectId,
          alertId,
          alertStateId,
          log === null ? null : JSON.stringify(log),
        ],
      );
    }

    async function insertIncidentState(
      rowIdText: string,
      incidentId: string,
      log: JSONObject | null,
    ): Promise<void> {
      await database.query(
        `INSERT INTO "IncidentStateTimeline" ("_id","projectId","incidentId","incidentStateId","version","startsAt","stateChangeLog") VALUES ($1,$2,$3,$4,1,now(),$5::jsonb)`,
        [
          rowIdText,
          projectId,
          incidentId,
          incidentStateId,
          log === null ? null : JSON.stringify(log),
        ],
      );
    }

    async function insertMonitorStatus(
      rowIdText: string,
      log: JSONObject | null,
    ): Promise<void> {
      await database.query(
        `INSERT INTO "MonitorStatusTimeline" ("_id","projectId","monitorId","monitorStatusId","version","startsAt","statusChangeLog") VALUES ($1,$2,$3,$4,1,now(),$5::jsonb)`,
        [
          rowIdText,
          projectId,
          monitorId,
          monitorStatusId,
          log === null ? null : JSON.stringify(log),
        ],
      );
    }

    async function stateOf(
      table: StoredLogTable,
      rowIdText: string,
    ): Promise<RowState> {
      const column: string = STORED_LOG_COLUMNS[table];
      const rows: Array<RowState> = await database.query(
        `SELECT "_id"::text AS "id", xmin::text AS "xmin", "updatedAt"::text AS "updatedAt", "version", "${column}"::text AS "log", pg_column_size("${column}") AS "storedBytes" FROM "${table}" WHERE "_id" = $1::uuid`,
        [rowIdText],
      );

      return rows[0]!;
    }

    function parsed(state: RowState): JSONObject {
      return JSON.parse(state.log!) as JSONObject;
    }

    function trimWrites(): Array<{ sql: string }> {
      return statements.filter((statement: { sql: string }): boolean => {
        return statement.sql.includes("UPDATE");
      });
    }

    function expectOwnSeries(log: JSONObject): void {
      const own: JSONObject = (
        fleetCheckShape.seriesBreakdown as Array<JSONObject>
      )[OWN_SERIES]!;

      expect(log["seriesBreakdown"]).toEqual([own]);
      expect(log["metricResult"]).toEqual(own["aggregatedResults"]);
      expect(log["metricResultArrivals"]).toEqual(own["arrivals"]);
      expect(log["evidenceScope"]).toEqual({
        seriesFingerprint: fingerprintOf(OWN_SERIES),
        seriesInEvaluation: SERIES_COUNT,
      });
      expectSmallFieldsAndMarkers(log);
      expect(
        (log[TRIMMED_BY_CLEANUP_FIELD] as JSONObject)["trimmedFields"],
      ).toEqual(["metricResult", "metricResultArrivals", "seriesBreakdown"]);
    }

    function expectSmallFieldsAndMarkers(log: JSONObject): void {
      expect(log["evaluationSummary"]).toEqual(
        fleetCheckShape.evaluationSummary,
      );
      expect(log["metricViewConfig"]).toEqual(fleetCheckShape.metricViewConfig);
      expect(log["monitoredAt"]).toEqual(fleetCheckShape.monitoredAt);
      expect(log["monitorId"]).toEqual(fleetCheckShape.monitorId);
      expect(log["isEvidenceTruncated"]).toBe(true);
      expect(StoredCheckEvidence.isTrimmed(log)).toBe(true);
      expect((log[TRIMMED_BY_CLEANUP_FIELD] as JSONObject)["note"]).toBe(
        TRIMMED_BY_CLEANUP_NOTE,
      );
      expect(
        Buffer.byteLength(JSON.stringify(log), "utf8"),
      ).toBeLessThanOrEqual(TRIMMED_MAX_JSON_BYTES);
    }

    let fleetCheckShape: {
      seriesBreakdown: Array<JSONObject>;
      evaluationSummary: JSONObject;
      metricViewConfig: JSONObject;
      monitoredAt: JSONObject;
      monitorId: JSONObject;
    };
    let fleet: JSONObject;

    beforeAll(async () => {
      /*
       * The walk yields between rows with setImmediate, which Common's jsdom
       * environment has not: the real Node one, for this suite.
       */
      if (typeof globalThis.setImmediate !== "function") {
        globalThis.setImmediate =
          timers.setImmediate as typeof globalThis.setImmediate;
      }

      database = new DataSource({
        type: "postgres",
        host:
          process.env["OVERSIZED_STORED_CHECKS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["OVERSIZED_STORED_CHECKS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["OVERSIZED_STORED_CHECKS_TEST_DATABASE_NAME"] ||
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
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      await database.query(`DELETE FROM "Project" WHERE "name" = $1`, [
        PROJECT_NAME,
      ]);

      markersBefore = await database.query(
        `SELECT * FROM "DataMigrations" WHERE "name" = ANY($1)`,
        [markerNames],
      );
      await deleteMarkers();

      projectId = id();
      await database.query(
        `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,$2,$3,1)`,
        [projectId, PROJECT_NAME, `oversized-stored-checks-${projectId}`],
      );

      incidentStateId = id();
      incidentSeverityId = id();
      alertStateId = id();
      alertSeverityId = id();
      monitorStatusId = id();
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
      await database.query(
        `INSERT INTO "Monitor" ("_id","projectId","name","slug","monitorType","currentMonitorStatusId","version") VALUES ($1,$2,'Container restarts',$3,'Metrics',$4,1)`,
        [monitorId, projectId, `monitor-${monitorId}`, monitorStatusId],
      );

      fleet = fleetCheck();
      fleetCheckShape = fleet as unknown as typeof fleetCheckShape;

      OversizedStoredChecks.readCursor = async (
        table: StoredLogTable,
      ): Promise<string | undefined> => {
        return cursors.get(table);
      };
      OversizedStoredChecks.saveCursor = async (
        table: StoredLogTable,
        cursor: string,
      ): Promise<void> => {
        cursors.set(table, cursor);
      };
      OversizedStoredChecks.forgetCursor = async (
        table: StoredLogTable,
      ): Promise<void> => {
        cursors.delete(table);
      };
      OversizedStoredChecks.runQuery = async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        statements.push({ sql, params });
        return await originals.runQuery(sql, params);
      };
      OversizedStoredChecks.runStatement = async (data: {
        sql: string;
        params: Array<unknown>;
        statementTimeoutMs: number;
        lockTimeoutMs: number;
      }): Promise<Array<Record<string, unknown>>> => {
        statements.push({ sql: data.sql, params: data.params });
        timeouts.push({ statementTimeoutMs: data.statementTimeoutMs });

        return await originals.runStatement({
          ...data,
          statementTimeoutMs:
            forceTrimTimeoutMs !== undefined && data.sql.startsWith("WITH")
              ? forceTrimTimeoutMs
              : data.statementTimeoutMs,
        });
      };
    }, 120000);

    beforeEach(() => {
      statements.length = 0;
      timeouts.length = 0;
      forceTrimTimeoutMs = undefined;
    });

    afterAll(async () => {
      Object.assign(OversizedStoredChecks, originals);

      if (!database?.isInitialized) {
        return;
      }

      await deleteMarkers();

      for (const marker of markersBefore) {
        await database.query(
          `INSERT INTO "DataMigrations" ("_id","name","executed","executedAt","createdAt","updatedAt","version") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            marker["_id"],
            marker["name"],
            marker["executed"],
            marker["executedAt"],
            marker["createdAt"],
            marker["updatedAt"],
            marker["version"],
          ],
        );
      }

      for (const table of [
        "AlertStateTimeline",
        "IncidentStateTimeline",
        "MonitorStatusTimeline",
        "Alert",
        "Incident",
        "Monitor",
      ]) {
        await database.query(`DELETE FROM "${table}" WHERE "projectId" = $1`, [
          projectId,
        ]);
      }

      await database.query(`DELETE FROM "Project" WHERE "_id" = $1`, [
        projectId,
      ]);
      await database.destroy();
      jest.restoreAllMocks();
    }, 120000);

    test("the fleet check is stored past the threshold, TOASTed", async () => {
      const probe: string = rowId(1, 1);
      await insertMonitorStatus(probe, fleet);
      const state: RowState = await stateOf(
        StoredLogTable.MonitorStatusTimeline,
        probe,
      );

      expect(state.storedBytes).toBeGreaterThanOrEqual(
        CANDIDATE_MIN_STORED_BYTES,
      );
      expect(Buffer.byteLength(state.log!, "utf8")).toBeGreaterThan(
        state.storedBytes!,
      );
      await database.query(
        `DELETE FROM "MonitorStatusTimeline" WHERE "_id" = $1::uuid`,
        [probe],
      );
    }, 120000);

    test("each record keeps its own series and small fields; other rows are never written; a second walk writes nothing; tables are marked done", async () => {
      const test: number = 2;
      const alertId: string = rowId(test, 1);
      const alertWithMissingSeries: string = rowId(test, 2);
      const alertSmall: string = rowId(test, 3);
      const alertNoLog: string = rowId(test, 4);
      const alertIdentified: string = rowId(test, 5);
      const alertResolved: string = rowId(test, 6);
      const incidentId: string = rowId(test, 7);
      const incidentIdentified: string = rowId(test, 8);
      const statusChange: string = rowId(test, 9);
      const hugeBody: string = rowId(test, 10);
      const wholeMonitorAlert: string = rowId(test, 11);

      await insertAlert(alertId, fleet, fingerprintOf(OWN_SERIES));
      await insertAlert(alertWithMissingSeries, fleet, "fpnotinthefleet");
      await insertAlert(alertSmall, { responseCode: 503 }, null);
      await insertAlert(alertNoLog, null, fingerprintOf(1));
      await insertAlert(wholeMonitorAlert, fleet, "__all__");
      await insertAlertState(alertIdentified, alertId, fleet);
      await insertAlertState(alertResolved, alertId, fleet);
      await insertIncident(incidentId, fleet, fingerprintOf(OWN_SERIES));
      await insertIncidentState(incidentIdentified, incidentId, fleet);
      await insertMonitorStatus(statusChange, fleet);
      await insertMonitorStatus(hugeBody, hugeBodyCheck());

      const before: Map<string, RowState> = new Map<string, RowState>();
      const rows: Array<[StoredLogTable, string]> = [
        [StoredLogTable.Alert, alertId],
        [StoredLogTable.Alert, alertWithMissingSeries],
        [StoredLogTable.Alert, alertSmall],
        [StoredLogTable.Alert, alertNoLog],
        [StoredLogTable.Alert, wholeMonitorAlert],
        [StoredLogTable.AlertStateTimeline, alertIdentified],
        [StoredLogTable.AlertStateTimeline, alertResolved],
        [StoredLogTable.Incident, incidentId],
        [StoredLogTable.IncidentStateTimeline, incidentIdentified],
        [StoredLogTable.MonitorStatusTimeline, statusChange],
        [StoredLogTable.MonitorStatusTimeline, hugeBody],
      ];

      for (const [table, rowIdText] of rows) {
        before.set(rowIdText, await stateOf(table, rowIdText));
      }

      startWalksAt(test);
      const summary: OversizedStoredChecksSummary =
        await OversizedStoredChecks.run({
          limits: { ...DEFAULT_LIMITS, scanPageSize: 3 },
        });

      expect(summary.rowsTrimmed).toBe(9);
      expect(summary.rowsReplacedByMarkers).toBe(0);
      expect(summary.failedRows).toBe(0);
      expect(summary.failedTables).toBe(0);
      expect(summary.finishedTables).toEqual(OVERSIZED_CHECK_TABLES);
      expect(summary.storedBytesAfter).toBeLessThan(
        summary.storedBytesBefore / 10,
      );

      // Each trim in a transaction with its own statement timeout.
      expect(timeouts).toHaveLength(9);
      for (const timeout of timeouts) {
        expect(timeout.statementTimeoutMs).toBe(
          DEFAULT_LIMITS.statementTimeoutMs,
        );
      }

      for (const [table, rowIdText] of [
        [StoredLogTable.Alert, alertId],
        [StoredLogTable.AlertStateTimeline, alertIdentified],
        [StoredLogTable.AlertStateTimeline, alertResolved],
        [StoredLogTable.Incident, incidentId],
        [StoredLogTable.IncidentStateTimeline, incidentIdentified],
      ] as Array<[StoredLogTable, string]>) {
        const after: RowState = await stateOf(table, rowIdText);
        expectOwnSeries(parsed(after));
        // Storage, not a change anyone made.
        expect(after.updatedAt).toBe(before.get(rowIdText)!.updatedAt);
        expect(after.version).toBe(before.get(rowIdText)!.version);
        expect(after.storedBytes!).toBeLessThan(CANDIDATE_MIN_STORED_BYTES);
      }

      // A series the evaluation did not have: empty lists, as rows written now.
      const missing: JSONObject = parsed(
        await stateOf(StoredLogTable.Alert, alertWithMissingSeries),
      );
      expect(missing["seriesBreakdown"]).toEqual([]);
      expect(missing["metricResult"]).toEqual([]);
      expect(missing["metricResultArrivals"]).toBeUndefined();
      expect(missing["evidenceScope"]).toEqual({
        seriesFingerprint: "fpnotinthefleet",
        seriesInEvaluation: SERIES_COUNT,
      });
      expectSmallFieldsAndMarkers(missing);

      // About the whole monitor, or a status change: no series at all.
      for (const [table, rowIdText] of [
        [StoredLogTable.Alert, wholeMonitorAlert],
        [StoredLogTable.MonitorStatusTimeline, statusChange],
      ] as Array<[StoredLogTable, string]>) {
        const log: JSONObject = parsed(await stateOf(table, rowIdText));
        expect(log["seriesBreakdown"]).toBeUndefined();
        expect(log["metricResult"]).toBeUndefined();
        expect(log["metricResultArrivals"]).toBeUndefined();
        expect(log["evidenceScope"]).toBeUndefined();
        expectSmallFieldsAndMarkers(log);
      }

      // Past the limit without any series: its small fields only.
      const body: JSONObject = parsed(
        await stateOf(StoredLogTable.MonitorStatusTimeline, hugeBody),
      );
      expect(body["responseBody"]).toBeUndefined();
      expect(body["responseCode"]).toBe(500);
      expect(body["responseHeaders"]).toEqual({ "content-type": "text/html" });
      expect(body["isEvidenceTruncated"]).toBe(true);
      expect(
        (body[TRIMMED_BY_CLEANUP_FIELD] as JSONObject)["trimmedFields"],
      ).toEqual(["responseBody"]);

      // Not written at all: not even a new row version.
      for (const rowIdText of [alertSmall, alertNoLog]) {
        const after: RowState = await stateOf(StoredLogTable.Alert, rowIdText);
        expect(after.xmin).toBe(before.get(rowIdText)!.xmin);
        expect(after.log).toBe(before.get(rowIdText)!.log);
      }

      const markers: Array<{ name: string }> = await database.query(
        `SELECT "name" FROM "DataMigrations" WHERE "name" = ANY($1) AND "executed" = true`,
        [markerNames],
      );
      expect(
        markers
          .map((marker: { name: string }): string => {
            return marker.name;
          })
          .sort(),
      ).toEqual([...markerNames].sort());

      // A walk asked for again writes nothing: every trimmed row is under the threshold.
      await deleteMarkers();
      startWalksAt(test);
      statements.length = 0;
      const again: OversizedStoredChecksSummary =
        await OversizedStoredChecks.run({
          limits: { ...DEFAULT_LIMITS, scanPageSize: 3 },
        });
      expect(again.rowsTrimmed).toBe(0);
      expect(trimWrites()).toHaveLength(0);

      // Every table done: a run is one read.
      statements.length = 0;
      const done: OversizedStoredChecksSummary =
        await OversizedStoredChecks.run();
      expect(done.isEveryTableDone).toBe(true);
      expect(statements).toHaveLength(1);

      await deleteMarkers();
    }, 300000);

    test("a check Postgres cannot trim within its statement timeout keeps the markers alone", async () => {
      const test: number = 3;
      const alertId: string = rowId(test, 1);
      await insertAlert(alertId, fleet, fingerprintOf(OWN_SERIES));

      startWalksAt(test);
      forceTrimTimeoutMs = 1;
      const summary: OversizedStoredChecksSummary =
        await OversizedStoredChecks.run();

      expect(summary.rowsTrimmed).toBe(0);
      expect(summary.rowsReplacedByMarkers).toBe(1);
      expect(summary.failedRows).toBe(0);

      const log: JSONObject = parsed(
        await stateOf(StoredLogTable.Alert, alertId),
      );
      expect(log).toEqual({
        isEvidenceTruncated: true,
        [TRIMMED_BY_CLEANUP_FIELD]: {
          note: TRIMMED_BY_CLEANUP_NOTE,
          trimmedFields: "all",
        },
      });

      await deleteMarkers();
    }, 300000);

    test("a row whose lock is held is not waited on for longer than the lock timeout: the walk stops there and resumes next run", async () => {
      const test: number = 4;
      const first: string = rowId(test, 1);
      const locked: string = rowId(test, 2);
      await insertAlert(first, fleet, fingerprintOf(OWN_SERIES));
      await insertAlert(locked, fleet, fingerprintOf(OWN_SERIES));

      const holder: ReturnType<DataSource["createQueryRunner"]> =
        database.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(
        `SELECT 1 FROM "Alert" WHERE "_id" = $1::uuid FOR UPDATE`,
        [locked],
      );

      try {
        startWalksAt(test);
        const startedAt: number = Date.now();
        const summary: OversizedStoredChecksSummary =
          await OversizedStoredChecks.run({
            limits: { ...DEFAULT_LIMITS, lockTimeoutMs: 200 },
          });

        expect(Date.now() - startedAt).toBeLessThan(
          DEFAULT_LIMITS.statementTimeoutMs,
        );
        expect(summary.rowsTrimmed).toBe(1);
        expect(summary.failedRows).toBe(1);
        expect(summary.finishedTables).not.toContain(StoredLogTable.Alert);
        // Where it got to: the row before the one it could not trim.
        expect(cursors.get(StoredLogTable.Alert)).toBe(first);
      } finally {
        await holder.rollbackTransaction();
        await holder.release();
      }

      const resumed: OversizedStoredChecksSummary =
        await OversizedStoredChecks.run();
      expect(resumed.rowsTrimmed).toBe(1);
      expect(resumed.failedRows).toBe(0);
      expectOwnSeries(parsed(await stateOf(StoredLogTable.Alert, locked)));

      await deleteMarkers();
    }, 300000);

    test("a fleet-size check - 16,158 series, 35 MB of JSON and 5 MB stored - is trimmed in Postgres, by one statement, far within its timeout", async () => {
      const test: number = 5;
      const alertId: string = rowId(test, 1);
      const seriesCount: number = 16158;
      const ownSeries: number = 9001;

      /*
       * Built by Postgres, as the report of #9189 measured it: 5 queries,
       * every series with its points and arrivals, never in Node.
       */
      await database.query(
        `INSERT INTO "Alert" ("_id","projectId","title","currentAlertStateId","alertSeverityId","version","seriesFingerprint","createdStateLog")
        SELECT $1::uuid, $2::uuid, 'Container restarted', $3::uuid, $4::uuid, 1, md5($6::text),
          jsonb_build_object(
            'monitorId', jsonb_build_object('_type', 'ObjectID', 'value', $2::text),
            'evaluationSummary', jsonb_build_object('criteriaResults', jsonb_build_array(jsonb_build_object('criteriaName', 'Restarted', 'isMet', true))),
            'seriesBreakdown', (SELECT jsonb_agg(e ORDER BY i) FROM (
              SELECT i, jsonb_build_object('fingerprint', md5(i::text), 'labels', jsonb_build_object('resource.host.name', 'host-' || (i / 36)),
                'aggregatedResults', (SELECT jsonb_agg(jsonb_build_object('query', q, 'data', jsonb_build_array(jsonb_build_object('value', round((random() * 100)::numeric, 3), 'timestamp', '2026-11-01T10:00:00.000Z', 'attributes', jsonb_build_object('resource.host.name', 'host-' || (i / 36), 'resource.container.name', 'container-' || md5(i::text)))))) FROM generate_series(1, 5) q),
                'arrivals', jsonb_build_array(jsonb_build_object('at', '2026-11-01T10:00:00.000Z'))) AS e
              FROM generate_series(1, $5::int) i) s),
            'metricResult', (SELECT jsonb_agg(jsonb_build_object('query', q, 'data', (SELECT jsonb_agg(jsonb_build_object('query', q, 'value', round((random() * 100)::numeric, 3), 'timestamp', '2026-11-01T10:00:00.000Z', 'attributes', jsonb_build_object('resource.host.name', 'host-' || (i / 36), 'resource.container.name', 'container-' || md5(i::text)))) FROM generate_series(1, $5::int) i))) FROM generate_series(1, 5) q)
          )`,
        [
          alertId,
          projectId,
          alertStateId,
          alertSeverityId,
          seriesCount,
          ownSeries,
        ],
      );

      const sizes: Array<{ storedBytes: number; jsonBytes: string }> =
        await database.query(
          `SELECT pg_column_size("createdStateLog") AS "storedBytes", octet_length("createdStateLog"::text)::text AS "jsonBytes" FROM "Alert" WHERE "_id" = $1::uuid`,
          [alertId],
        );
      expect(Number(sizes[0]!.jsonBytes)).toBeGreaterThan(30 * 1024 * 1024);

      const startedAt: number = Date.now();
      const trim: { outcome: string; storedBytesAfter: number } =
        await OversizedStoredChecks.trimRow({
          table: StoredLogTable.Alert,
          candidate: { id: alertId, storedBytes: sizes[0]!.storedBytes },
        });
      const tookMs: number = Date.now() - startedAt;

      expect(trim.outcome).toBe("Trimmed");
      // Measured at 255 ms, the transaction included; the timeout is 30 s.
      expect(tookMs).toBeLessThan(DEFAULT_LIMITS.statementTimeoutMs / 3);

      const log: JSONObject = parsed(
        await stateOf(StoredLogTable.Alert, alertId),
      );
      const own: Array<JSONObject> = log[
        "seriesBreakdown"
      ] as Array<JSONObject>;
      expect(own).toHaveLength(1);
      expect(own[0]!["labels"]).toEqual({
        "resource.host.name": `host-${Math.floor(ownSeries / 36)}`,
      });
      expect(log["metricResult"]).toEqual(own[0]!["aggregatedResults"]);
      expect((log["evidenceScope"] as JSONObject)["seriesInEvaluation"]).toBe(
        seriesCount,
      );
      expect(log["isEvidenceTruncated"]).toBe(true);
      expect(trim.storedBytesAfter).toBeLessThan(16 * 1024);
    }, 300000);
  },
);
