import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import logger from "../Logger";
import { EntityManager } from "typeorm";

/*
 * MOVING AN EXCEPTION TO A PRIVATE FINGERPRINT ON ITS NEXT OCCURRENCE (#10619).
 *
 * An exception's fingerprint is an unkeyed SHA-256 of the text it is
 * grouped by (App's ExceptionUtil: grouping v1 and v2), and everyone who
 * can read the exception reads it. When a scrub rule hides part of that
 * text - a card's last digits, a Social Security number in the message of
 * an exception with no stack trace - whoever reads the redacted message and
 * the fingerprint can hash every guess at the hidden value and see which
 * one matches. Since #10434 a new exception is made under a keyed
 * fingerprint then (KeyedExceptionFingerprint), but one made before keeps
 * the fingerprint it was made under: it is its identity, on its row and on
 * every occurrence in ClickHouse.
 *
 * The next occurrence a rule changed knows both: that the fingerprint it
 * found its exception under hashes what the rule hid, and the keyed one of
 * the same text. It moves the exception there, here, in one transaction:
 *
 *   - the exception keeps its row - its id, state, assignee, history and
 *     counts - and takes the keyed fingerprint, so its own fingerprint, and
 *     every occurrence from now on, give nothing away;
 *   - its old fingerprint is kept by a row of its own, as a merged alias of
 *     the exception's group (formerFingerprintOfTelemetryExceptionId), the
 *     way an exception a person merged keeps its fingerprint: the
 *     occurrences recorded before the move keep the old fingerprint in
 *     ClickHouse, where a sort key is never rewritten, so the exception's
 *     page, its monitors, the session replays and security events that name
 *     the old fingerprint still find them, and an occurrence a process
 *     still groups under the old one is counted on the exception as well;
 *   - nothing is split or merged: the keyed fingerprint is of exactly the
 *     text the old one was of, so the same occurrences group the same way.
 *
 * Moved already (by another occurrence, in another process): the exception's
 * fingerprint now is the answer. The keyed fingerprint taken by another
 * exception - a stray one a failed lookup made - the exception is left as it
 * is: moving it there would merge the two, which only a person does.
 *
 * Never fails a batch: an exception that cannot be moved now keeps its old
 * fingerprint for this batch, and the next occurrence tries again.
 */

export enum ExceptionRekeyOutcome {
  // Moved now: the exception's fingerprint is the keyed one.
  Moved = "moved",
  // Another occurrence moved it already.
  AlreadyMoved = "already-moved",
  // Another exception has the keyed fingerprint: left as it is.
  TargetTaken = "target-taken",
  // No exception has the old fingerprint any more (deleted meanwhile).
  NotFound = "not-found",
  // The move failed; the old fingerprint stays for now.
  Failed = "failed",
}

export interface ExceptionRekeyResult {
  /*
   * The fingerprint the occurrence is grouped by: the exception's new one,
   * or the old one when it was not moved.
   */
  fingerprint: string;
  outcome: ExceptionRekeyOutcome;
}

interface RowToMove {
  id: string;
  mergedIntoId: string | null;
  formerFingerprintOfId: string | null;
  primaryEntityType: string | null;
  exceptionType: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstSeenInRelease: string | null;
  lastSeenInRelease: string | null;
}

// The exception a former fingerprint is kept for, and its fingerprint now.
export const FORMER_FINGERPRINT_OWNER_SQL: string = `SELECT o."fingerprint" AS "fingerprint" FROM "TelemetryException" a JOIN "TelemetryException" o ON o."_id" = a."formerFingerprintOfTelemetryExceptionId" AND o."deletedAt" IS NULL WHERE a."projectId" = $1 AND a."primaryEntityId" = $2 AND a."fingerprint" = $3 AND a."deletedAt" IS NULL LIMIT 1`;

export default class TelemetryExceptionRekey {
  public static async rekey(data: {
    projectId: string;
    primaryEntityId: string;
    // The fingerprint the exception has: an unkeyed hash of what a rule hid.
    from: string;
    // The keyed fingerprint of the same text.
    to: string;
  }): Promise<ExceptionRekeyResult> {
    const unchanged: (
      outcome: ExceptionRekeyOutcome,
    ) => ExceptionRekeyResult = (
      outcome: ExceptionRekeyOutcome,
    ): ExceptionRekeyResult => {
      return { fingerprint: data.from, outcome };
    };

    if (
      !data.projectId ||
      !data.primaryEntityId ||
      !data.from ||
      !data.to ||
      data.from === data.to
    ) {
      return unchanged(ExceptionRekeyOutcome.NotFound);
    }

    let result: ExceptionRekeyResult;

    try {
      result = await TelemetryExceptionService.executeTransaction(
        async (manager: EntityManager): Promise<ExceptionRekeyResult> => {
          return await TelemetryExceptionRekey.moveInTransaction(manager, data);
        },
      );
    } catch (err) {
      logger.warn(
        `Could not move exception ${data.from} of project ${data.projectId} to its private fingerprint; it keeps its fingerprint for now: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return unchanged(ExceptionRekeyOutcome.Failed);
    }

    if (result.outcome === ExceptionRekeyOutcome.Moved) {
      /*
       * Its group gained a member and changed its own fingerprint: the reads
       * of its occurrences go by its group as it is now, in every process.
       */
      await TelemetryExceptionService.forgetGroupFingerprints([data.projectId]);
    }

    if (result.outcome === ExceptionRekeyOutcome.TargetTaken) {
      logger.warn(
        `Exception ${data.from} of project ${data.projectId} keeps its fingerprint: another exception of its service has the private fingerprint it would move to.`,
      );
    }

    return result;
  }

  // The move, in the transaction `manager` runs: see the header.
  public static async moveInTransaction(
    manager: EntityManager,
    data: {
      projectId: string;
      primaryEntityId: string;
      from: string;
      to: string;
    },
  ): Promise<ExceptionRekeyResult> {
    const rows: Array<RowToMove> =
      (await manager.query(
        `SELECT "_id"::text AS "id", "mergedIntoTelemetryExceptionId"::text AS "mergedIntoId", "formerFingerprintOfTelemetryExceptionId"::text AS "formerFingerprintOfId", "primaryEntityType", "exceptionType", "firstSeenAt", "lastSeenAt", "firstSeenInRelease", "lastSeenInRelease" FROM "TelemetryException" WHERE "projectId" = $1 AND "primaryEntityId" = $2 AND "fingerprint" = $3 AND "deletedAt" IS NULL FOR UPDATE`,
        [data.projectId, data.primaryEntityId, data.from],
      )) || [];

    const row: RowToMove | undefined = rows[0];

    /*
     * Not under the old fingerprint as an exception of its own: moved by
     * another occurrence meanwhile - its row keeps the old one now - or gone.
     */
    if (!row || row.formerFingerprintOfId) {
      const owners: Array<{ fingerprint: string }> =
        (await manager.query(FORMER_FINGERPRINT_OWNER_SQL, [
          data.projectId,
          data.primaryEntityId,
          data.from,
        ])) || [];
      const owner: string | undefined = owners[0]?.fingerprint;

      return owner
        ? { fingerprint: owner, outcome: ExceptionRekeyOutcome.AlreadyMoved }
        : { fingerprint: data.from, outcome: ExceptionRekeyOutcome.NotFound };
    }

    // Any row, deleted ones too: the unique index holds them all.
    const taken: Array<{ id: string }> =
      (await manager.query(
        `SELECT "_id"::text AS "id" FROM "TelemetryException" WHERE "projectId" = $1 AND "primaryEntityId" = $2 AND "fingerprint" = $3 LIMIT 1`,
        [data.projectId, data.primaryEntityId, data.to],
      )) || [];

    if (taken.length > 0) {
      return {
        fingerprint: data.from,
        outcome: ExceptionRekeyOutcome.TargetTaken,
      };
    }

    await manager.query(
      `UPDATE "TelemetryException" SET "fingerprint" = $1, "updatedAt" = now() WHERE "_id" = $2`,
      [data.to, row.id],
    );

    /*
     * The old fingerprint, kept as a member of the exception's group: merged
     * into it, or into the one it was merged into, as nothing is ever merged
     * into a merged exception. Its own count starts at none: every
     * occurrence it stands for is counted on the exception already. Its seen
     * times are those occurrences': the exception's until now.
     */
    await manager.query(
      `INSERT INTO "TelemetryException" ("projectId", "primaryEntityId", "primaryEntityType", "fingerprint", "exceptionType", "firstSeenAt", "lastSeenAt", "firstSeenInRelease", "lastSeenInRelease", "occuranceCount", "unhandled", "isResolved", "isArchived", "version", "mergedIntoTelemetryExceptionId", "mergedAt", "formerFingerprintOfTelemetryExceptionId") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, 0, false, false, false, 0, $10::uuid, now(), $11::uuid)`,
      [
        data.projectId,
        data.primaryEntityId,
        row.primaryEntityType,
        data.from,
        row.exceptionType,
        row.firstSeenAt,
        row.lastSeenAt,
        row.firstSeenInRelease,
        row.lastSeenInRelease,
        row.mergedIntoId || row.id,
        row.id,
      ],
    );

    return { fingerprint: data.to, outcome: ExceptionRekeyOutcome.Moved };
  }
}
