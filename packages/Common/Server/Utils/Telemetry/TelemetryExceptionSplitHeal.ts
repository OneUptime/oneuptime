import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import TelemetryExceptionActivityService from "../../Services/TelemetryExceptionActivityService";
import { TelemetryExceptionActivityType } from "../../../Models/DatabaseModels/TelemetryExceptionActivity";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import logger from "../Logger";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionMergeResult,
} from "./TelemetryExceptionMerge";

/*
 * AN EXCEPTION A FAILED LOOKUP SPLIT, MERGED BACK INTO THE ONE IT WAS SPLIT
 * FROM (#11027).
 *
 * Until #11027, when ingest could not read which of an occurrence's
 * fingerprints an exception exists under, it filed the occurrence under the
 * one grouping v1 gives it (App's ExceptionUtil, an occurrence's
 * `fingerprint`). For an exception made since grouping v2 - under v2, v3,
 * v4 or a keyed fingerprint - no exception exists under v1, so the upsert
 * made one: a duplicate, first seen then, and New Exception fired again for
 * an old error. And as every occurrence tries v1 first, every later one
 * found the duplicate: the exception it was split from never had another
 * occurrence.
 *
 * Such a duplicate is told apart by when it was made: an exception under an
 * occurrence's v1 fingerprint made after an exception under a fingerprint
 * the same occurrence tries later. Since grouping v2 nothing but that
 * failure makes an exception under v1 - a new exception is made under the
 * newest version's fingerprint, which is tried last - and every exception
 * made under v1 before grouping v2 is older than any made since. So an
 * exception of before is never taken for one, nor is a pair that only
 * shares a later fingerprint (an exception made before grouping v2, and
 * one made since under v2 for another line of the same code).
 *
 * It is merged into the one it was split from (TelemetryExceptionMerge
 * .merge), as OneUptime: the older one survives, its first seen as it was,
 * and takes in the duplicate's count and seen times; the duplicate leaves
 * the lists and every count, New Exception's among them, and its
 * occurrences show on the survivor's page; Unmerge undoes it, as any merge.
 * Nothing fires: a merge reopens nothing and moves no first seen into a
 * monitor's window. Merged into another one since, the one it was split
 * from stands for that one, as it does for Merge Exceptions (#10618).
 *
 * A person's call stands: a duplicate a person merged elsewhere, or took
 * out of a merge (an Unmerged entry on its timeline), is left as it is.
 *
 * Never throws: an occurrence's batch must not fail because the two could
 * not be merged now; the next occurrence tries again.
 */

export enum ExceptionSplitHealOutcome {
  // Merged now, into the one it was split from (or that one's survivor).
  Merged = "merged",
  // Merged into it already: by an earlier occurrence, or by a person.
  AlreadyMerged = "already-merged",
  /*
   * Not a duplicate a failed lookup made: made before the other, or a row
   * that only keeps a former fingerprint.
   */
  NotADuplicate = "not-a-duplicate",
  // A person merged it into another one, or took it out of a merge.
  LeftToAPerson = "left-to-a-person",
  // One of the two no longer exists.
  NotFound = "not-found",
  // The merge failed; the next occurrence tries again.
  Failed = "failed",
}

/*
 * The two exceptions of one project and resource, under each of the
 * fingerprints named: deleted ones left out.
 */
export const SPLIT_HEAL_ROWS_SQL: string = `SELECT "_id"::text AS "id", "fingerprint", "createdAt", "mergedIntoTelemetryExceptionId"::text AS "mergedIntoId", "formerFingerprintOfTelemetryExceptionId"::text AS "formerFingerprintOfId" FROM "TelemetryException" WHERE "projectId" = $1 AND "primaryEntityId" = $2 AND "fingerprint" = ANY($3::text[]) AND "deletedAt" IS NULL`;

/*
 * One exception, by its id: the one a row that only keeps a former
 * fingerprint is kept for, or the one an exception was merged into.
 */
export const SPLIT_HEAL_ROW_BY_ID_SQL: string = `SELECT "_id"::text AS "id", "fingerprint", "createdAt", "mergedIntoTelemetryExceptionId"::text AS "mergedIntoId", "formerFingerprintOfTelemetryExceptionId"::text AS "formerFingerprintOfId" FROM "TelemetryException" WHERE "_id" = $1 AND "projectId" = $2 AND "deletedAt" IS NULL`;

interface HealRow {
  id: string;
  fingerprint: string;
  createdAt: Date | string | null;
  mergedIntoId: string | null;
  formerFingerprintOfId: string | null;
}

function timeOf(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

function sameId(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return Boolean(a) && Boolean(b) && a!.toLowerCase() === b!.toLowerCase();
}

export default class TelemetryExceptionSplitHeal {
  public static async heal(data: {
    projectId: string;
    primaryEntityId: string;
    // The fingerprint the duplicate was made under: the occurrence's v1.
    duplicate: string;
    /*
     * The fingerprint the exception it was split from is found under: the
     * first the occurrence tries after v1 that an exception exists under.
     */
    original: string;
  }): Promise<ExceptionSplitHealOutcome> {
    if (
      !data.projectId ||
      !data.primaryEntityId ||
      !data.duplicate ||
      !data.original ||
      data.duplicate === data.original
    ) {
      return ExceptionSplitHealOutcome.NotFound;
    }

    try {
      return await TelemetryExceptionSplitHeal.healOrThrow(data);
    } catch (err) {
      logger.warn(
        `Could not merge exception ${data.duplicate} of project ${data.projectId}, which a failed lookup split from exception ${data.original}, back into it; the next occurrence tries again: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      return ExceptionSplitHealOutcome.Failed;
    }
  }

  private static async healOrThrow(data: {
    projectId: string;
    primaryEntityId: string;
    duplicate: string;
    original: string;
  }): Promise<ExceptionSplitHealOutcome> {
    const rows: Array<HealRow> =
      (await TelemetryExceptionService.getRepository().manager.query(
        SPLIT_HEAL_ROWS_SQL,
        [data.projectId, data.primaryEntityId, [data.duplicate, data.original]],
      )) || [];

    const duplicate: HealRow | undefined = rows.find((row: HealRow) => {
      return row.fingerprint === data.duplicate;
    });
    let original: HealRow | undefined = rows.find((row: HealRow) => {
      return row.fingerprint === data.original;
    });

    if (!duplicate || !original) {
      return ExceptionSplitHealOutcome.NotFound;
    }

    // A row that only keeps a former fingerprint is no duplicate (#10619).
    if (duplicate.formerFingerprintOfId) {
      return ExceptionSplitHealOutcome.NotADuplicate;
    }

    // The one it was split from was moved to a private fingerprint since: that one.
    if (original.formerFingerprintOfId) {
      original = await TelemetryExceptionSplitHeal.readById(
        data.projectId,
        original.formerFingerprintOfId,
      );

      if (!original) {
        return ExceptionSplitHealOutcome.NotFound;
      }
    }

    const duplicateMadeAt: number | null = timeOf(duplicate.createdAt);
    const originalMadeAt: number | null = timeOf(original.createdAt);

    // Made before the other, or when either was made is not known: not one.
    if (
      duplicateMadeAt === null ||
      originalMadeAt === null ||
      duplicateMadeAt <= originalMadeAt
    ) {
      return ExceptionSplitHealOutcome.NotADuplicate;
    }

    // Merged into another one since: that one stands for it.
    let survivor: HealRow = original;

    if (original.mergedIntoId) {
      const mergedInto: HealRow | undefined =
        await TelemetryExceptionSplitHeal.readById(
          data.projectId,
          original.mergedIntoId,
        );

      if (!mergedInto) {
        return ExceptionSplitHealOutcome.NotFound;
      }

      survivor = mergedInto;
    }

    // Already one exception, whichever way they were merged.
    if (
      sameId(duplicate.mergedIntoId, survivor.id) ||
      sameId(survivor.id, duplicate.id)
    ) {
      return ExceptionSplitHealOutcome.AlreadyMerged;
    }

    // Merged into another one by a person: their call stands.
    if (duplicate.mergedIntoId) {
      return ExceptionSplitHealOutcome.LeftToAPerson;
    }

    // Taken out of a merge by a person: their call stands.
    if (
      await TelemetryExceptionSplitHeal.wasUnmerged(
        data.projectId,
        duplicate.id,
      )
    ) {
      return ExceptionSplitHealOutcome.LeftToAPerson;
    }

    const result: ExceptionMergeResult = await TelemetryExceptionMerge.merge({
      telemetryExceptionId: new ObjectID(survivor.id),
      mergedTelemetryExceptionIds: [new ObjectID(duplicate.id)],
      // As OneUptime: no person asked, and none is named on the timeline.
      props: { isRoot: true, tenantId: new ObjectID(data.projectId) },
    });

    const outcome: ExceptionMergeOutcome | undefined = result.merged.find(
      (entry: { telemetryExceptionId: string }): boolean => {
        return sameId(entry.telemetryExceptionId, duplicate.id);
      },
    )?.outcome;

    if (outcome === ExceptionMergeOutcome.Merged) {
      logger.info(
        `Merged exception ${duplicate.id} of project ${data.projectId}, which a failed lookup split from exception ${survivor.id}, back into it.`,
      );

      return ExceptionSplitHealOutcome.Merged;
    }

    return ExceptionSplitHealOutcome.AlreadyMerged;
  }

  private static async readById(
    projectId: string,
    id: string,
  ): Promise<HealRow | undefined> {
    const rows: Array<HealRow> =
      (await TelemetryExceptionService.getRepository().manager.query(
        SPLIT_HEAL_ROW_BY_ID_SQL,
        [id, projectId],
      )) || [];

    return rows[0];
  }

  // Whether a person ever took the exception out of a merge.
  private static async wasUnmerged(
    projectId: string,
    exceptionId: string,
  ): Promise<boolean> {
    const count: PositiveNumber =
      await TelemetryExceptionActivityService.countBy({
        query: {
          projectId: new ObjectID(projectId),
          telemetryExceptionId: new ObjectID(exceptionId),
          activityType: TelemetryExceptionActivityType.UnmergedFrom,
        },
        props: { isRoot: true },
      });

    return count.toNumber() > 0;
  }
}
