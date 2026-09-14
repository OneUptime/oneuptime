import RunCron from "../../Utils/Cron";
import { buildSessionDeleteStatement } from "./ProcessSessionErasureRequests";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import RumSessionPinService from "Common/Server/Services/RumSessionPinService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { isSessionErased } from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import RumSessionPin from "Common/Models/DatabaseModels/RumSessionPin";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE, EVERY_HOUR } from "Common/Utils/CronTime";

/*
 * ------------------------------------------------------------------
 * Rum:MaterializePinnedSessions
 *
 * The worker that makes a pin actually protect a recording — and the
 * worker that takes that protection away again when the pin ends.
 *
 * Both replay tables TTL-drop whole partitions on retentionDate, and a
 * MergeTree row cannot be UPDATEd in place — so "keep this recording"
 * cannot be a flag on the existing rows. Instead (design doc §8 item 7)
 * the pinned session's chunks and header are RE-INSERTED with a
 * far-future retentionDate and an isPinnedCopy marker: the chunk copies
 * land in their own retention partition and survive while the original
 * partition is dropped, and the header copy shares the session's
 * ReplacingMergeTree replace key, so it simply supersedes the original
 * at merge. The copies keep the same sessionId, so a single
 * `sessionId IN (...)` erasure mutation still catches them — erasure
 * always outranks a pin.
 *
 * Until materializedAt is stamped, a pin protects NOTHING. That is why
 * this worker exists, why it runs frequently, and why the pin service
 * documents getUnmaterializedPins as "the honest answer to: is this
 * recording safe?".
 *
 * The copy happens entirely inside ClickHouse (INSERT ... SELECT), so
 * recording payloads never travel through the worker process.
 *
 * Two jobs live in this module because they are two halves of one
 * promise:
 *
 *   1. Rum:MaterializePinnedSessions (every 5 minutes) copies pinned
 *      recordings. A pin is only materialized once the session is
 *      FINALIZED: the most common moment to pin is during a live incident
 *      while the session is still recording, and a copy taken then would
 *      protect the first minutes only — chunks that arrive later are
 *      written by ingest under ordinary retention and nothing tops the
 *      copy up. Deferring costs at most the finalizer's idle window (ten
 *      minutes plus a cron tick); the pin stays visibly unmaterialized
 *      until then, which is the truth.
 *
 *   2. Rum:ReconcilePinnedCopies (hourly) removes the protection again.
 *      The pin row is hard-deleted by the Dashboard on unpin and the pin
 *      service has no delete hook, so nothing tells this worker a pin is
 *      gone; instead the far-future copies in ClickHouse are enumerated
 *      and checked against Postgres. A copy without a live pin (unpinned,
 *      or the pin's expiresAt passed) is reverted to ordinary retention
 *      with the same ALTER ... DELETE mechanism the erasure job uses.
 *      A copy WITH a live pin is topped up with any chunk that arrived
 *      after the copy was taken, so a session re-finalized after a late
 *      tab is protected in full.
 *
 * Header partition caveat (workers-lifecycle-12): RumSession partitions
 * by toYYYYMMDD(startTime) with ttl_only_drop_parts = 1, and startTime is
 * part of the replace key, so the pinned header copy cannot be moved to a
 * partition keyed on its own retention the way the chunk copy is. While a
 * pin lives, its whole start-day header partition stays on disk (rows
 * past retention are hidden by the read path's `retentionDate >= now()`
 * but not physically dropped). The reconcile above bounds the damage to
 * the pin's lifetime by ALTER-deleting the copy rows when the pin ends;
 * partitioning the header table by retentionDate (a table version bump)
 * is the real fix and belongs to the model.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Rum:MaterializePinnedSessions";
const RECONCILE_JOB_NAME: string = "Rum:ReconcilePinnedCopies";

export const MAX_PINS_PER_RUN: number = 100;

/*
 * Pinned sessions examined per reconcile run. Pins are a human action, so
 * the live set is small; the cap only bounds a pathological install.
 */
export const MAX_PINNED_SESSIONS_PER_RECONCILE: number = 500;

/*
 * Where a pin without an explicit expiry lands. Two years, far past every
 * ordinary retention tier; a pin that must outlive even this can set
 * expiresAt explicitly.
 */
export const PINNED_DEFAULT_RETENTION_DAYS: number = 730;

/*
 * After a revert the ALTER ... DELETE runs asynchronously, so the copies
 * stay visible to the next reconcile for as long as the mutation takes.
 * The marker stops that run from re-submitting the same mutation; its
 * TTL is generous because a stuck mutation queue is exactly when
 * piling more mutations on would hurt most.
 */
export const REVERTED_PIN_MARKER_TTL_SECONDS: number = 24 * 60 * 60;

export function getRevertedPinMarkerKey(data: {
  projectId: string;
  sessionId: string;
}): string {
  return `replay:pin:reverted:${data.projectId}:${data.sessionId}`;
}

/* The columns the materializer overrides on every copied row. */
const OVERRIDDEN_COLUMNS: ReadonlyArray<string> = [
  "version",
  "retentionDate",
  "isPinnedCopy",
];

/*
 * The verbatim-carried column list, derived from the MODEL at runtime so
 * it can never drift from the physical schema: a hand-maintained list
 * missing one column would make every materialization fail (or worse,
 * silently default a column) the first time someone adds a field.
 */
export function getCopiedColumnList(model: {
  tableColumns: Array<AnalyticsTableColumn>;
}): Array<string> {
  return model.tableColumns
    .map((column: AnalyticsTableColumn): string => {
      return column.key;
    })
    .filter((key: string): boolean => {
      return !OVERRIDDEN_COLUMNS.includes(key);
    });
}

/*
 * A pin whose expiresAt has passed asked for LESS retention than it would
 * get by being materialized now: "keep for three days" reaching the worker
 * on day four must not become "keep for two years". Lapsed pins are never
 * materialized and, once materialized, are reverted by the reconcile.
 */
export function isPinLapsed(pin: RumSessionPin, now: Date): boolean {
  return Boolean(pin.expiresAt) && !OneUptimeDate.isAfter(pin.expiresAt!, now);
}

/*
 * Only ever called for a pin that is NOT lapsed (see isPinLapsed), so a
 * past expiresAt never reaches this function on the worker path; the
 * fallback exists for the no-expiry pin.
 */
export function resolvePinnedRetentionDate(
  pin: RumSessionPin,
  now: Date,
): Date {
  if (pin.expiresAt && OneUptimeDate.isAfter(pin.expiresAt, now)) {
    return pin.expiresAt;
  }

  return OneUptimeDate.addRemoveDays(now, PINNED_DEFAULT_RETENTION_DAYS);
}

interface SessionScope {
  databaseName: string;
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  sessionId: string;
}

function appendSessionScope(statement: Statement, data: SessionScope): void {
  statement.append(SQL`
    WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }}
      AND rumApplicationId = ${{
        type: TableColumnType.ObjectID,
        value: data.rumApplicationId,
      }}
      AND sessionId = ${{
        type: TableColumnType.Text,
        value: data.sessionId,
      }}`);
}

/*
 * Copy one session's chunk rows with pinned retention.
 *
 * LIMIT 1 BY (tabId, chunkIndex) after ORDER BY version DESC copies only
 * each chunk's winning version — copying every retried delivery would
 * multiply storage for nothing. The retention filter keeps the copy
 * honest: a chunk that already expired cannot be resurrected, only the
 * ones still present are preserved.
 *
 * The NOT IN anti-join skips chunks that already have a pinned copy, so
 * the statement is a TOP-UP as much as a first copy: a re-run after a
 * crash, or the hourly reconcile of a session that kept recording after
 * its pin, copies only what is new instead of doubling the pinned
 * partition until the next merge.
 */
export function buildChunkCopyStatement(
  data: SessionScope & {
    versionUnixMs: number;
    retentionDate: Date;
  },
): Statement {
  const columns: Array<string> = getCopiedColumnList(new RumSessionChunk());
  const columnList: string = columns.join(", ");

  const statement: Statement = SQL`
    INSERT INTO ${data.databaseName}.${AnalyticsTableName.RumSessionChunk} `;

  statement.append(`(${columnList}, version, retentionDate, isPinnedCopy)
    SELECT ${columnList}, `);

  statement.append(SQL`${{
    /*
     * UInt64, never Number: Number binds as an Int32 query parameter and
     * ClickHouse silently WRAPS an out-of-range value instead of
     * rejecting it — a unix-millisecond version (~1.8e12) would truncate
     * to a small number, lose the ReplacingMergeTree version race to the
     * original rows, and the pinned copies would protect nothing.
     */
    type: TableColumnType.UInt64,
    value: data.versionUnixMs,
  }} AS version, ${{
    type: TableColumnType.DateTime64,
    value: data.retentionDate,
  }} AS retentionDate, true AS isPinnedCopy
    FROM ${data.databaseName}.${AnalyticsTableName.RumSessionChunk}`);

  appendSessionScope(statement, data);

  statement.append(SQL`
      AND retentionDate >= now()
      AND isPinnedCopy = false
      AND (tabId, chunkIndex) NOT IN (
        SELECT tabId, chunkIndex
        FROM ${data.databaseName}.${AnalyticsTableName.RumSessionChunk}`);

  appendSessionScope(statement, data);

  statement.append(SQL`
          AND isPinnedCopy = true
      )
    ORDER BY tabId ASC, chunkIndex ASC, version DESC
    LIMIT 1 BY tabId, chunkIndex`);

  return statement;
}

/*
 * Copy the session header with pinned retention. Same replace key, newer
 * version — so once merges run, THIS row (far-future retentionDate) is
 * the session's one visible header, and later re-finalizations carry the
 * pinned retentionDate forward because they read it back off this row.
 */
export function buildHeaderCopyStatement(
  data: SessionScope & {
    versionUnixMs: number;
    retentionDate: Date;
  },
): Statement {
  const columns: Array<string> = getCopiedColumnList(new RumSession());
  const columnList: string = columns.join(", ");

  const statement: Statement = SQL`
    INSERT INTO ${data.databaseName}.${AnalyticsTableName.RumSession} `;

  statement.append(`(${columnList}, version, retentionDate, isPinnedCopy)
    SELECT ${columnList}, `);

  statement.append(SQL`${{
    /*
     * UInt64, never Number: Number binds as an Int32 query parameter and
     * ClickHouse silently WRAPS an out-of-range value instead of
     * rejecting it — a unix-millisecond version (~1.8e12) would truncate
     * to a small number, lose the ReplacingMergeTree version race to the
     * original rows, and the pinned copies would protect nothing.
     */
    type: TableColumnType.UInt64,
    value: data.versionUnixMs,
  }} AS version, ${{
    type: TableColumnType.DateTime64,
    value: data.retentionDate,
  }} AS retentionDate, true AS isPinnedCopy
    FROM ${data.databaseName}.${AnalyticsTableName.RumSession}`);

  appendSessionScope(statement, data);

  statement.append(SQL`
      AND retentionDate >= now()
    ORDER BY version DESC
    LIMIT 1`);

  return statement;
}

/*
 * The winning header's finalization state, or no row at all when the
 * session has no live header (expired, or a sessionId nothing ever
 * recorded under).
 */
export function buildHeaderStateStatement(data: SessionScope): Statement {
  const statement: Statement = SQL`
    SELECT toUInt8(isFinalized) AS isFinalized
    FROM ${data.databaseName}.${AnalyticsTableName.RumSession}`;

  appendSessionScope(statement, data);

  statement.append(SQL`
      AND retentionDate >= now()
    ORDER BY version DESC
    LIMIT 1`);

  return statement;
}

/*
 * How many chunk rows (original OR already-copied) the session still has.
 * Counted BEFORE the copy rather than read back afterwards: on a cluster
 * the INSERT goes through the Distributed table asynchronously, so a
 * count taken straight after the copy could read zero for a copy that is
 * merely in flight. The predicate mirrors the copy statement's, so a
 * non-zero answer here means the copy has rows to take.
 */
export function buildRetainedChunkCountStatement(
  data: SessionScope,
): Statement {
  const statement: Statement = SQL`
    SELECT count() AS chunkCount
    FROM ${data.databaseName}.${AnalyticsTableName.RumSessionChunk}`;

  appendSessionScope(statement, data);

  statement.append(SQL`
      AND retentionDate >= now()`);

  return statement;
}

/*
 * The retention the session would have had without its pin: the
 * ORIGINAL chunk rows still carry it. No original rows means ordinary
 * retention has already passed and the session should be gone.
 */
export function buildOrdinaryRetentionStatement(data: SessionScope): Statement {
  const statement: Statement = SQL`
    SELECT count() AS chunkCount, toString(max(retentionDate)) AS retentionDate
    FROM ${data.databaseName}.${AnalyticsTableName.RumSessionChunk}`;

  appendSessionScope(statement, data);

  statement.append(SQL`
      AND retentionDate >= now()
      AND isPinnedCopy = false`);

  return statement;
}

/*
 * Write a header version that puts the session back on ordinary
 * retention. Deleting the pinned header copy alone is not enough: a
 * re-finalization after the pin read the far-future retentionDate off
 * the copy and carried it forward into an ordinary (isPinnedCopy = false)
 * row, and nothing else would ever lower it again. A newer version with
 * the ordinary date wins the ReplacingMergeTree race over both.
 *
 * The winning header is copied regardless of its own retention so an
 * expired session can be handed a past date rather than left with the
 * far-future one.
 */
export function buildHeaderRetentionRevertStatement(
  data: SessionScope & {
    versionUnixMs: number;
    retentionDateText: string;
  },
): Statement {
  const columns: Array<string> = getCopiedColumnList(new RumSession());
  const columnList: string = columns.join(", ");

  const statement: Statement = SQL`
    INSERT INTO ${data.databaseName}.${AnalyticsTableName.RumSession} `;

  statement.append(`(${columnList}, version, retentionDate, isPinnedCopy)
    SELECT ${columnList}, `);

  statement.append(SQL`${{
    type: TableColumnType.UInt64,
    value: data.versionUnixMs,
  }} AS version, toDate(${{
    type: TableColumnType.Text,
    value: data.retentionDateText,
  }}) AS retentionDate, false AS isPinnedCopy
    FROM ${data.databaseName}.${AnalyticsTableName.RumSession}`);

  appendSessionScope(statement, data);

  statement.append(SQL`
    ORDER BY version DESC
    LIMIT 1`);

  return statement;
}

/*
 * Every session that currently has a live pinned copy. This is the
 * reconcile's work list: the pin row is hard-deleted on unpin, so the
 * copies themselves are the only durable record that a pin once existed.
 */
export function buildPinnedSessionsStatement(data: {
  databaseName: string;
  limit: number;
}): Statement {
  return SQL`
    SELECT
      toString(projectId) AS projectId,
      toString(rumApplicationId) AS rumApplicationId,
      sessionId AS sessionId
    FROM ${data.databaseName}.${AnalyticsTableName.RumSession}
    WHERE isPinnedCopy = true
      AND retentionDate >= now()
    GROUP BY projectId, rumApplicationId, sessionId
    LIMIT ${{
      type: TableColumnType.Number,
      value: data.limit,
    }}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getDatabaseName(): string {
  const databaseName: string | undefined =
    RumSessionChunkService.database.getDatasourceOptions().database;

  if (!databaseName) {
    throw new Error("ClickHouse database name is not configured");
  }

  return databaseName;
}

/*
 * The @clickhouse/client types live in Common's node_modules and are not
 * resolvable from App, so result sets are typed structurally here — the
 * same shape the erasure job uses.
 */
interface ClickhouseJsonResultSet {
  json: () => Promise<{ data: Array<JSONObject> }>;
}

async function readRows(data: {
  service: { executeQuery: (statement: Statement) => Promise<unknown> };
  statement: Statement;
}): Promise<Array<JSONObject>> {
  const resultSet: ClickhouseJsonResultSet = (await data.service.executeQuery(
    data.statement,
  )) as unknown as ClickhouseJsonResultSet;

  const parsed: { data: Array<JSONObject> } = await resultSet.json();

  return parsed.data || [];
}

function toNumberValue(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

export type HeaderState = "missing" | "provisional" | "finalized";

export async function readHeaderState(
  data: SessionScope,
): Promise<HeaderState> {
  const rows: Array<JSONObject> = await readRows({
    service: RumSessionService,
    statement: buildHeaderStateStatement(data),
  });

  const row: JSONObject | undefined = rows[0];

  if (!row) {
    return "missing";
  }

  return toNumberValue(row["isFinalized"]) === 1 ? "finalized" : "provisional";
}

async function readRetainedChunkCount(data: SessionScope): Promise<number> {
  const rows: Array<JSONObject> = await readRows({
    service: RumSessionChunkService,
    statement: buildRetainedChunkCountStatement(data),
  });

  const row: JSONObject | undefined = rows[0];

  return row ? toNumberValue(row["chunkCount"]) : 0;
}

async function deletePinnedCopies(data: SessionScope): Promise<void> {
  for (const tableName of [
    AnalyticsTableName.RumSessionChunk,
    AnalyticsTableName.RumSession,
  ]) {
    await RumSessionChunkService.execute(
      buildSessionDeleteStatement({
        databaseName: data.databaseName,
        tableName: tableName,
        projectId: data.projectId,
        sessionIds: [data.sessionId],
        pinnedCopiesOnly: true,
      }),
      MigrationExecuteOptions,
    );
  }
}

/*
 * Best effort on both sides: the marker only saves a redundant mutation,
 * so a Redis blip must neither block the revert nor fail it.
 */
async function markSessionReverted(data: {
  projectId: string;
  sessionId: string;
}): Promise<void> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    return;
  }

  try {
    await client.set(
      getRevertedPinMarkerKey(data),
      "1",
      "EX",
      REVERTED_PIN_MARKER_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn(
      `${RECONCILE_JOB_NAME}: could not record the revert marker for session ${data.sessionId}: ${getErrorMessage(error)}`,
    );
  }
}

async function wasSessionRecentlyReverted(data: {
  projectId: string;
  sessionId: string;
}): Promise<boolean> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    return false;
  }

  try {
    return (await client.exists(getRevertedPinMarkerKey(data))) > 0;
  } catch {
    return false;
  }
}

export type RevertOutcome = "reverted" | "erased";

/*
 * Take a session back to the retention it would have had without its pin.
 *
 * Order matters. The header version with the ordinary date is written
 * FIRST so there is never a moment when the pinned copies are gone but
 * the far-future header is still the winner; then the copies are
 * ALTER-deleted with the erasure job's own statement. An erased session
 * is left entirely alone: its mutation is already in flight, and writing
 * a header version here would resurrect the subject's identifying
 * columns in a part that mutation will never see.
 */
export async function revertPinnedSession(
  data: SessionScope,
): Promise<RevertOutcome> {
  const erased: boolean = await isSessionErased({
    projectId: data.projectId.toString(),
    sessionId: data.sessionId,
  });

  if (erased) {
    return "erased";
  }

  const now: Date = OneUptimeDate.getCurrentDate();

  const ordinaryRows: Array<JSONObject> = await readRows({
    service: RumSessionChunkService,
    statement: buildOrdinaryRetentionStatement(data),
  });

  const ordinary: JSONObject | undefined = ordinaryRows[0];
  const originalChunkCount: number = ordinary
    ? toNumberValue(ordinary["chunkCount"])
    : 0;

  /*
   * No original chunk left means ordinary retention already passed: the
   * session would be gone by now, so its header gets a date that is
   * already in the past and the read path stops serving it at once.
   */
  const retentionDateText: string =
    originalChunkCount > 0 && ordinary
      ? toTextValue(ordinary["retentionDate"])
      : OneUptimeDate.toClickhouseDateTime(
          OneUptimeDate.addRemoveDays(now, -1),
        );

  await RumSessionService.execute(
    buildHeaderRetentionRevertStatement({
      ...data,
      versionUnixMs: now.getTime(),
      retentionDateText: retentionDateText,
    }),
    MigrationExecuteOptions,
  );

  await deletePinnedCopies(data);

  await markSessionReverted({
    projectId: data.projectId.toString(),
    sessionId: data.sessionId,
  });

  return "reverted";
}

export interface MaterializeRunSummary {
  materialized: number;
  deferred: number;
  erasedPinsRemoved: number;
  lapsedPinsRemoved: number;
  emptyPinsRemoved: number;
  failed: number;
}

export async function materializePinnedSessions(): Promise<MaterializeRunSummary> {
  const databaseName: string = getDatabaseName();

  const pins: Array<RumSessionPin> =
    await RumSessionPinService.getUnmaterializedPins({
      limit: MAX_PINS_PER_RUN,
    });

  const summary: MaterializeRunSummary = {
    materialized: 0,
    deferred: 0,
    erasedPinsRemoved: 0,
    lapsedPinsRemoved: 0,
    emptyPinsRemoved: 0,
    failed: 0,
  };

  for (const pin of pins) {
    if (!pin.id || !pin.projectId || !pin.rumApplicationId || !pin.sessionId) {
      continue;
    }

    const scope: SessionScope = {
      databaseName: databaseName,
      projectId: pin.projectId,
      rumApplicationId: pin.rumApplicationId,
      sessionId: pin.sessionId,
    };

    try {
      const now: Date = OneUptimeDate.getCurrentDate();

      if (isPinLapsed(pin, now)) {
        await RumSessionPinService.deleteOneById({
          id: pin.id,
          props: { isRoot: true },
        });

        summary.lapsedPinsRemoved++;

        logger.warn(
          `${JOB_NAME}: pin ${pin.id.toString()} for session ${pin.sessionId} expired at ${OneUptimeDate.getDateAsLocalFormattedString(pin.expiresAt!)} before it was materialized; pin removed, nothing copied.`,
        );

        continue;
      }

      /*
       * Erasure outranks pinning, checked per pin and fail-closed: a pin
       * created before (or during) an erasure must never re-insert the
       * erased subject's recording under a two-year retention. The pin
       * itself is deleted — there is nothing left to protect, and leaving
       * it unmaterialized would retry this decision forever.
       */
      const erased: boolean = await isSessionErased({
        projectId: pin.projectId.toString(),
        sessionId: pin.sessionId,
      });

      if (erased) {
        await RumSessionPinService.deleteOneById({
          id: pin.id,
          props: { isRoot: true },
        });

        summary.erasedPinsRemoved++;

        logger.info(
          `${JOB_NAME}: pin ${pin.id.toString()} targets erased session ${pin.sessionId}; pin removed, nothing materialized.`,
        );

        continue;
      }

      /*
       * A pin protects only what it copies, and the copy statements copy
       * only rows that still exist. Establishing that there IS a header
       * and at least one chunk before copying is what lets
       * markMaterialized below mean "the recording is safe" rather than
       * "two INSERT ... SELECTs ran". A session with nothing left to
       * protect (already expired, or an id nothing recorded under) gets
       * its pin removed, so the Dashboard shows the recording as
       * unprotected instead of falsely protected.
       */
      const headerState: HeaderState = await readHeaderState(scope);

      if (headerState === "missing") {
        await RumSessionPinService.deleteOneById({
          id: pin.id,
          props: { isRoot: true },
        });

        summary.emptyPinsRemoved++;

        logger.warn(
          `${JOB_NAME}: pin ${pin.id.toString()} targets session ${pin.sessionId}, which has no retained header (expired or never recorded); pin removed, nothing to protect.`,
        );

        continue;
      }

      if (headerState === "provisional") {
        summary.deferred++;

        logger.debug(
          `${JOB_NAME}: pin ${pin.id.toString()} for session ${pin.sessionId} waits for finalization so the copy is complete.`,
        );

        continue;
      }

      const retainedChunkCount: number = await readRetainedChunkCount(scope);

      if (retainedChunkCount === 0) {
        await RumSessionPinService.deleteOneById({
          id: pin.id,
          props: { isRoot: true },
        });

        summary.emptyPinsRemoved++;

        logger.warn(
          `${JOB_NAME}: pin ${pin.id.toString()} targets session ${pin.sessionId}, whose chunks have all expired; pin removed, nothing to protect.`,
        );

        continue;
      }

      const retentionDate: Date = resolvePinnedRetentionDate(pin, now);
      const versionUnixMs: number = now.getTime();

      /*
       * Chunks first, header second: the header copy is what makes the
       * session VISIBLE with pinned retention, so it must never exist
       * while the chunk copies do not. markMaterialized comes last — a
       * crash between any two steps leaves the pin unmaterialized and the
       * whole sequence re-runs, which is safe: the chunk copy skips what
       * already landed and the header copy is re-inserted with a newer
       * version that the engine collapses.
       */
      await RumSessionChunkService.execute(
        buildChunkCopyStatement({
          ...scope,
          versionUnixMs: versionUnixMs,
          retentionDate: retentionDate,
        }),
        MigrationExecuteOptions,
      );

      await RumSessionService.execute(
        buildHeaderCopyStatement({
          ...scope,
          versionUnixMs: versionUnixMs,
          retentionDate: retentionDate,
        }),
        MigrationExecuteOptions,
      );

      /*
       * Erasure re-check AFTER the copies. The erasure job writes its
       * tombstone BEFORE submitting mutations, and a ClickHouse mutation
       * only rewrites parts that existed at submission — so an erasure
       * that started between the pre-check above and our inserts would
       * never touch the copies, leaving the erased subject's recording
       * alive under two-year retention. Re-checking here closes exactly
       * that window: a tombstone seen now means our copies must go; a
       * tombstone written after this point belongs to an erasure whose
       * mutations were submitted after our inserts and therefore cover
       * them.
       */
      const erasedDuringCopy: boolean = await isSessionErased({
        projectId: pin.projectId.toString(),
        sessionId: pin.sessionId,
      });

      if (erasedDuringCopy) {
        for (const tableName of [
          AnalyticsTableName.RumSessionChunk,
          AnalyticsTableName.RumSession,
        ]) {
          await RumSessionChunkService.execute(
            buildSessionDeleteStatement({
              databaseName: databaseName,
              tableName: tableName,
              projectId: pin.projectId,
              sessionIds: [pin.sessionId],
            }),
            MigrationExecuteOptions,
          );
        }

        await RumSessionPinService.deleteOneById({
          id: pin.id,
          props: { isRoot: true },
        });

        summary.erasedPinsRemoved++;

        logger.info(
          `${JOB_NAME}: session ${pin.sessionId} was erased while pin ${pin.id.toString()} materialized; copies deleted, pin removed.`,
        );

        continue;
      }

      await RumSessionPinService.markMaterialized({ pinId: pin.id });

      summary.materialized++;

      logger.info(
        `${JOB_NAME}: materialized pin ${pin.id.toString()} for session ${pin.sessionId} (${retainedChunkCount} chunk row(s)) with retention until ${OneUptimeDate.getDateAsLocalFormattedString(retentionDate)}.`,
      );
    } catch (error) {
      /*
       * The pin stays unmaterialized and is retried next run. Failing
       * loudly matters: every hour a pin spends unmaterialized is an hour
       * in which the recording it promises to protect can expire.
       */
      summary.failed++;
      logger.error(
        `${JOB_NAME}: could not materialize pin ${pin.id.toString()} for session ${pin.sessionId}: ${getErrorMessage(error)}`,
      );
    }
  }

  if (pins.length > 0) {
    logger.info(
      `${JOB_NAME}: processed ${pins.length} pin(s); materialized ${summary.materialized}, deferred ${summary.deferred} until finalization, removed ${summary.erasedPinsRemoved} for erased sessions, ${summary.lapsedPinsRemoved} lapsed, ${summary.emptyPinsRemoved} with nothing to protect, ${summary.failed} failure(s).`,
    );
  }

  return summary;
}

export interface ReconcileRunSummary {
  unpinned: number;
  lapsed: number;
  toppedUp: number;
  skippedErased: number;
  failed: number;
}

const PIN_LOOKUP_SELECT: Select<RumSessionPin> = {
  _id: true,
  projectId: true,
  rumApplicationId: true,
  sessionId: true,
  expiresAt: true,
  materializedAt: true,
};

function pinKey(data: { projectId: string; sessionId: string }): string {
  return `${data.projectId}:${data.sessionId}`;
}

async function revertAndRemovePin(data: {
  scope: SessionScope;
  pin: RumSessionPin;
  summary: ReconcileRunSummary;
}): Promise<void> {
  const outcome: RevertOutcome = await revertPinnedSession(data.scope);

  if (data.pin.id) {
    await RumSessionPinService.deleteOneById({
      id: data.pin.id,
      props: { isRoot: true },
    });
  }

  if (outcome === "erased") {
    data.summary.skippedErased++;
    return;
  }

  data.summary.lapsed++;

  logger.info(
    `${RECONCILE_JOB_NAME}: pin for session ${data.scope.sessionId} expired at ${OneUptimeDate.getDateAsLocalFormattedString(data.pin.expiresAt!)}; copies reverted to ordinary retention, pin removed.`,
  );
}

/*
 * Pins whose expiresAt has passed. Their copies carry expiresAt as their
 * retentionDate, so the ClickHouse enumeration below no longer sees
 * them — Postgres is the only place a lapsed pin is still visible.
 */
async function reconcileLapsedPins(data: {
  databaseName: string;
  now: Date;
  summary: ReconcileRunSummary;
}): Promise<void> {
  const lapsedPins: Array<RumSessionPin> = await RumSessionPinService.findBy({
    query: {
      expiresAt: QueryHelper.lessThanEqualTo(data.now),
    },
    select: PIN_LOOKUP_SELECT,
    limit: MAX_PINNED_SESSIONS_PER_RECONCILE,
    skip: 0,
    props: { isRoot: true },
  });

  for (const pin of lapsedPins) {
    if (!pin.id || !pin.projectId || !pin.rumApplicationId || !pin.sessionId) {
      continue;
    }

    try {
      await revertAndRemovePin({
        scope: {
          databaseName: data.databaseName,
          projectId: pin.projectId,
          rumApplicationId: pin.rumApplicationId,
          sessionId: pin.sessionId,
        },
        pin: pin,
        summary: data.summary,
      });
    } catch (error) {
      data.summary.failed++;
      logger.error(
        `${RECONCILE_JOB_NAME}: could not revert lapsed pin ${pin.id.toString()} for session ${pin.sessionId}: ${getErrorMessage(error)}`,
      );
    }
  }
}

export async function reconcilePinnedCopies(): Promise<ReconcileRunSummary> {
  const databaseName: string = getDatabaseName();
  const now: Date = OneUptimeDate.getCurrentDate();

  const summary: ReconcileRunSummary = {
    unpinned: 0,
    lapsed: 0,
    toppedUp: 0,
    skippedErased: 0,
    failed: 0,
  };

  await reconcileLapsedPins({
    databaseName: databaseName,
    now: now,
    summary: summary,
  });

  const pinnedRows: Array<JSONObject> = await readRows({
    service: RumSessionService,
    statement: buildPinnedSessionsStatement({
      databaseName: databaseName,
      limit: MAX_PINNED_SESSIONS_PER_RECONCILE,
    }),
  });

  /* Grouped by project so the pin lookup is one Postgres query per project. */
  const sessionsByProject: Map<string, Array<JSONObject>> = new Map<
    string,
    Array<JSONObject>
  >();

  for (const row of pinnedRows) {
    const projectId: string = toTextValue(row["projectId"]);

    if (!projectId || !toTextValue(row["sessionId"])) {
      continue;
    }

    const existing: Array<JSONObject> | undefined =
      sessionsByProject.get(projectId);

    if (existing) {
      existing.push(row);
    } else {
      sessionsByProject.set(projectId, [row]);
    }
  }

  for (const [projectId, rows] of sessionsByProject.entries()) {
    let pins: Array<RumSessionPin>;

    try {
      pins = await RumSessionPinService.findBy({
        query: {
          projectId: new ObjectID(projectId),
          sessionId: QueryHelper.any(
            rows.map((row: JSONObject): string => {
              return toTextValue(row["sessionId"]);
            }),
          ),
        },
        select: PIN_LOOKUP_SELECT,
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      /*
       * Without the pin list every session in this project would look
       * unpinned, and reverting on that basis would strip protection
       * from recordings that are still pinned. Skip the project instead.
       */
      summary.failed += rows.length;
      logger.error(
        `${RECONCILE_JOB_NAME}: could not load pins for project ${projectId}; leaving its ${rows.length} pinned session(s) untouched: ${getErrorMessage(error)}`,
      );
      continue;
    }

    const pinsBySession: Map<string, RumSessionPin> = new Map<
      string,
      RumSessionPin
    >();

    for (const pin of pins) {
      if (pin.projectId && pin.sessionId) {
        pinsBySession.set(
          pinKey({
            projectId: pin.projectId.toString(),
            sessionId: pin.sessionId,
          }),
          pin,
        );
      }
    }

    for (const row of rows) {
      const sessionId: string = toTextValue(row["sessionId"]);
      const rumApplicationId: string = toTextValue(row["rumApplicationId"]);

      if (!rumApplicationId) {
        continue;
      }

      const scope: SessionScope = {
        databaseName: databaseName,
        projectId: new ObjectID(projectId),
        rumApplicationId: new ObjectID(rumApplicationId),
        sessionId: sessionId,
      };

      const pin: RumSessionPin | undefined = pinsBySession.get(
        pinKey({ projectId: projectId, sessionId: sessionId }),
      );

      try {
        if (!pin) {
          if (
            await wasSessionRecentlyReverted({
              projectId: projectId,
              sessionId: sessionId,
            })
          ) {
            continue;
          }

          const outcome: RevertOutcome = await revertPinnedSession(scope);

          if (outcome === "erased") {
            summary.skippedErased++;
            continue;
          }

          summary.unpinned++;

          logger.info(
            `${RECONCILE_JOB_NAME}: session ${sessionId} in project ${projectId} was unpinned; copies reverted to ordinary retention.`,
          );

          continue;
        }

        if (isPinLapsed(pin, now)) {
          await revertAndRemovePin({
            scope: scope,
            pin: pin,
            summary: summary,
          });
          continue;
        }

        /*
         * A live pin whose copy has not been marked yet is mid-flight in
         * the 5-minute job (or crashed between copy and mark, which that
         * job re-runs); touching it here would race that run.
         */
        if (!pin.materializedAt) {
          continue;
        }

        if (
          await isSessionErased({
            projectId: projectId,
            sessionId: sessionId,
          })
        ) {
          summary.skippedErased++;
          continue;
        }

        /*
         * Top-up: the copy statement's anti-join makes this copy only the
         * chunks that arrived after the pin was materialized, so a
         * session that kept recording after its pin is protected in full
         * rather than only up to the moment of the copy.
         */
        await RumSessionChunkService.execute(
          buildChunkCopyStatement({
            ...scope,
            versionUnixMs: now.getTime(),
            retentionDate: resolvePinnedRetentionDate(pin, now),
          }),
          MigrationExecuteOptions,
        );

        summary.toppedUp++;
      } catch (error) {
        summary.failed++;
        logger.error(
          `${RECONCILE_JOB_NAME}: could not reconcile pinned session ${sessionId} in project ${projectId}: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  if (pinnedRows.length > 0 || summary.lapsed > 0) {
    logger.info(
      `${RECONCILE_JOB_NAME}: examined ${pinnedRows.length} pinned session(s); reverted ${summary.unpinned} unpinned and ${summary.lapsed} lapsed, topped up ${summary.toppedUp}, skipped ${summary.skippedErased} erased, ${summary.failed} failure(s).`,
    );
  }

  return summary;
}

RunCron(
  JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(10),
  },
  async (): Promise<void> => {
    try {
      await materializePinnedSessions();
    } catch (error) {
      logger.error(`${JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);

/*
 * Hourly rather than every 5 minutes: the reconcile enumerates every
 * pinned session in ClickHouse and issues one top-up INSERT ... SELECT
 * per live pin, and an unpin becoming physical an hour later is an
 * acceptable lag for a retention change (the Dashboard already shows the
 * recording as unpinned the moment the pin row is gone).
 */
RunCron(
  RECONCILE_JOB_NAME,
  {
    schedule: EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  async (): Promise<void> => {
    try {
      await reconcilePinnedCopies();
    } catch (error) {
      logger.error(`${RECONCILE_JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);
