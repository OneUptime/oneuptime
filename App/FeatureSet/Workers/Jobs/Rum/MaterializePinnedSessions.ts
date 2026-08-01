import RunCron from "../../Utils/Cron";
import { buildSessionDeleteStatement } from "./ProcessSessionErasureRequests";
import RumSessionPinService from "Common/Server/Services/RumSessionPinService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { isSessionErased } from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import logger from "Common/Server/Utils/Logger";
import RumSessionPin from "Common/Models/DatabaseModels/RumSessionPin";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * ------------------------------------------------------------------
 * Rum:MaterializePinnedSessions
 *
 * The worker that makes a pin actually protect a recording.
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
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Rum:MaterializePinnedSessions";

export const MAX_PINS_PER_RUN: number = 100;

/*
 * Where a pin without an explicit expiry lands. Two years, far past every
 * ordinary retention tier; a pin that must outlive even this can set
 * expiresAt explicitly.
 */
export const PINNED_DEFAULT_RETENTION_DAYS: number = 730;

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

export function resolvePinnedRetentionDate(
  pin: RumSessionPin,
  now: Date,
): Date {
  if (pin.expiresAt && OneUptimeDate.isAfter(pin.expiresAt, now)) {
    return pin.expiresAt;
  }

  return OneUptimeDate.addRemoveDays(now, PINNED_DEFAULT_RETENTION_DAYS);
}

/*
 * Copy one session's chunk rows with pinned retention.
 *
 * LIMIT 1 BY (tabId, chunkIndex) after ORDER BY version DESC copies only
 * each chunk's winning version — copying every retried delivery would
 * multiply storage for nothing. The retention filter keeps the copy
 * honest: a chunk that already expired cannot be resurrected, only the
 * ones still present are preserved.
 */
export function buildChunkCopyStatement(data: {
  databaseName: string;
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  sessionId: string;
  versionUnixMs: number;
  retentionDate: Date;
}): Statement {
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
    FROM ${data.databaseName}.${AnalyticsTableName.RumSessionChunk}
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
      }}
      AND retentionDate >= now()
      AND isPinnedCopy = false
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
export function buildHeaderCopyStatement(data: {
  databaseName: string;
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  sessionId: string;
  versionUnixMs: number;
  retentionDate: Date;
}): Statement {
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
    FROM ${data.databaseName}.${AnalyticsTableName.RumSession}
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
      }}
      AND retentionDate >= now()
    ORDER BY version DESC
    LIMIT 1`);

  return statement;
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

export async function materializePinnedSessions(): Promise<{
  materialized: number;
  erasedPinsRemoved: number;
  failed: number;
}> {
  const databaseName: string = getDatabaseName();

  const pins: Array<RumSessionPin> =
    await RumSessionPinService.getUnmaterializedPins({
      limit: MAX_PINS_PER_RUN,
    });

  let materialized: number = 0;
  let erasedPinsRemoved: number = 0;
  let failed: number = 0;

  for (const pin of pins) {
    if (!pin.id || !pin.projectId || !pin.rumApplicationId || !pin.sessionId) {
      continue;
    }

    try {
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

        erasedPinsRemoved++;

        logger.info(
          `${JOB_NAME}: pin ${pin.id.toString()} targets erased session ${pin.sessionId}; pin removed, nothing materialized.`,
        );

        continue;
      }

      const now: Date = OneUptimeDate.getCurrentDate();
      const retentionDate: Date = resolvePinnedRetentionDate(pin, now);
      const versionUnixMs: number = now.getTime();

      /*
       * Chunks first, header second: the header copy is what makes the
       * session VISIBLE with pinned retention, so it must never exist
       * while the chunk copies do not. markMaterialized comes last — a
       * crash between any two steps leaves the pin unmaterialized and the
       * whole sequence re-runs, which is safe: the copies are re-inserted
       * with a newer version and the engine collapses them.
       */
      await RumSessionChunkService.execute(
        buildChunkCopyStatement({
          databaseName: databaseName,
          projectId: pin.projectId,
          rumApplicationId: pin.rumApplicationId,
          sessionId: pin.sessionId,
          versionUnixMs: versionUnixMs,
          retentionDate: retentionDate,
        }),
        MigrationExecuteOptions,
      );

      await RumSessionService.execute(
        buildHeaderCopyStatement({
          databaseName: databaseName,
          projectId: pin.projectId,
          rumApplicationId: pin.rumApplicationId,
          sessionId: pin.sessionId,
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

        erasedPinsRemoved++;

        logger.info(
          `${JOB_NAME}: session ${pin.sessionId} was erased while pin ${pin.id.toString()} materialized; copies deleted, pin removed.`,
        );

        continue;
      }

      await RumSessionPinService.markMaterialized({ pinId: pin.id });

      materialized++;

      logger.info(
        `${JOB_NAME}: materialized pin ${pin.id.toString()} for session ${pin.sessionId} with retention until ${OneUptimeDate.getDateAsLocalFormattedString(retentionDate)}.`,
      );
    } catch (error) {
      /*
       * The pin stays unmaterialized and is retried next run. Failing
       * loudly matters: every hour a pin spends unmaterialized is an hour
       * in which the recording it promises to protect can expire.
       */
      failed++;
      logger.error(
        `${JOB_NAME}: could not materialize pin ${pin.id.toString()} for session ${pin.sessionId}: ${getErrorMessage(error)}`,
      );
    }
  }

  if (pins.length > 0) {
    logger.info(
      `${JOB_NAME}: processed ${pins.length} pin(s); materialized ${materialized}, removed ${erasedPinsRemoved} for erased sessions, ${failed} failure(s).`,
    );
  }

  return {
    materialized: materialized,
    erasedPinsRemoved: erasedPinsRemoved,
    failed: failed,
  };
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
