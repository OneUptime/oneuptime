import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Query from "../../Types/Database/Query";
import ObjectID from "../../../Types/ObjectID";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import ModelPermission from "../../Types/Database/Permissions/Index";
import { EntityManager } from "typeorm";

/*
 * MERGING EXCEPTIONS THAT ARE THE SAME BUG, AND UNDOING IT.
 *
 * One root cause can land in several exception groups (a value the
 * fingerprint's normalizer leaves in, a second code path, a rename between
 * releases). Merging one into another makes the merged exception's
 * fingerprint an alias of the one it is merged into, the survivor:
 *
 *   - the survivor's count, first and last seen and releases take in the
 *     merged one's, and from then on ingest counts every new occurrence of
 *     the merged fingerprint on both (ExceptionUtil, App/Telemetry);
 *   - the survivor's page shows the merged one's occurrences, which keep
 *     their own fingerprint in ClickHouse - nothing is rewritten there;
 *   - the merged exception leaves the lists and counts (TelemetryException
 *     Service hides merged rows from every read that does not name them),
 *     and keeps its own count and state, so unmerging gives it back as it
 *     would have been, its occurrences since included.
 *
 * The counts always add up: an exception that is not merged counts its own
 * occurrences and those of every exception merged into it; a merged one
 * counts its own only, and nothing is ever merged into a merged one -
 * merging an exception that others were merged into moves those to the new
 * survivor too. Unmerging takes exactly the merged one's count back off.
 * First and last seen stay on the survivor when one is unmerged: they cannot
 * be told apart from its own.
 *
 * Only exceptions of one service merge, so the survivor's page, which reads
 * its occurrences by service, shows them all. Both need permission to edit
 * exceptions, checked on each row as an edit of it would be. Merging again
 * what is already merged into the survivor, or unmerging what is not merged,
 * changes nothing.
 */

// The most exceptions one request merges.
export const MAX_EXCEPTIONS_MERGED_AT_ONCE: number = 20;

export enum ExceptionMergeOutcome {
  Merged = "merged",
  AlreadyMerged = "already-merged",
}

export interface ExceptionMergeResult {
  telemetryExceptionId: string;
  merged: Array<{ telemetryExceptionId: string; outcome: ExceptionMergeOutcome }>;
}

export enum ExceptionUnmergeOutcome {
  Unmerged = "unmerged",
  NotMerged = "not-merged",
}

export interface ExceptionUnmergeResult {
  telemetryExceptionId: string;
  // The exception it had been merged into; null when it was not merged.
  unmergedFromTelemetryExceptionId: string | null;
  outcome: ExceptionUnmergeOutcome;
}

interface LockedRow {
  id: string;
  projectId: string;
  primaryEntityId: string;
  fingerprint: string;
  mergedIntoId: string | null;
  occuranceCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstSeenInRelease: string | null;
  lastSeenInRelease: string | null;
  unhandled: boolean;
}

const ROW_COLUMNS: string = `"_id"::text AS "id", "projectId"::text AS "projectId",
  "primaryEntityId"::text AS "primaryEntityId", "fingerprint",
  "mergedIntoTelemetryExceptionId"::text AS "mergedIntoId",
  COALESCE("occuranceCount", 0)::int AS "occuranceCount",
  "firstSeenAt", "lastSeenAt", "firstSeenInRelease", "lastSeenInRelease",
  COALESCE("unhandled", false) AS "unhandled"`;

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a) && Boolean(b) && a!.toLowerCase() === b!.toLowerCase();
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export default class TelemetryExceptionMerge {
  /*
   * The rows of `ids` the caller may edit, read as root once the query is
   * narrowed exactly as an edit of them would be: the table's edit
   * permission, the project, the labels, and the resources whose exceptions
   * the caller may edit (TelemetryExceptionService.addExceptionScope). A
   * caller who may only read is refused here.
   */
  public static async readEditable(data: {
    ids: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<TelemetryException>> {
    if (!data.props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const query: Query<TelemetryException> = {
      projectId: data.props.tenantId,
      _id: QueryHelper.any(data.ids),
    } as Query<TelemetryException>;

    const updatable: Query<TelemetryException> =
      await ModelPermission.getUpdatableQuery(
        TelemetryException,
        query,
        data.props,
      );

    const scoped: Query<TelemetryException> =
      await TelemetryExceptionService.addExceptionScope(
        updatable,
        data.props,
        DatabaseRequestType.Update,
      );

    return TelemetryExceptionService.findBy({
      query: scoped,
      select: {
        _id: true,
        projectId: true,
        primaryEntityId: true,
        fingerprint: true,
        mergedIntoTelemetryExceptionId: true,
      },
      limit: data.ids.length,
      skip: 0,
      props: { isRoot: true },
    });
  }

  public static readIds(raw: unknown): Array<ObjectID> {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadDataException("Name the exceptions to merge");
    }

    if (raw.length > MAX_EXCEPTIONS_MERGED_AT_ONCE) {
      throw new BadDataException(
        `Merge at most ${MAX_EXCEPTIONS_MERGED_AT_ONCE} exceptions at once`,
      );
    }

    const seen: Set<string> = new Set<string>();
    const ids: Array<ObjectID> = [];

    for (const value of raw) {
      if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
        throw new BadDataException("Invalid Telemetry Exception ID");
      }

      if (!seen.has(value.toLowerCase())) {
        seen.add(value.toLowerCase());
        ids.push(new ObjectID(value));
      }
    }

    return ids;
  }

  // The rows, locked in the order the ingest upsert locks them.
  private static async lockRows(
    manager: EntityManager,
    where: string,
    params: Array<unknown>,
  ): Promise<Array<LockedRow>> {
    const rows: Array<LockedRow> = await manager.query(
      `SELECT ${ROW_COLUMNS} FROM "TelemetryException" WHERE ${where} AND "deletedAt" IS NULL ORDER BY "projectId", "primaryEntityId", "fingerprint" FOR UPDATE`,
      params,
    );

    return rows || [];
  }

  public static async merge(data: {
    telemetryExceptionId: ObjectID;
    mergedTelemetryExceptionIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<ExceptionMergeResult> {
    const survivorId: string = data.telemetryExceptionId.toString();
    const mergedIds: Array<string> = data.mergedTelemetryExceptionIds
      .map((id: ObjectID): string => {
        return id.toString();
      })
      .filter((id: string, index: number, all: Array<string>): boolean => {
        return (
          all.findIndex((other: string): boolean => {
            return sameId(other, id);
          }) === index
        );
      });

    if (mergedIds.length === 0) {
      throw new BadDataException("Name the exceptions to merge");
    }

    if (
      mergedIds.some((id: string): boolean => {
        return sameId(id, survivorId);
      })
    ) {
      throw new BadDataException("An exception cannot be merged into itself");
    }

    // Permission first: every one of them, as an edit of it would be checked.
    const editable: Array<TelemetryException> =
      await TelemetryExceptionMerge.readEditable({
        ids: [data.telemetryExceptionId, ...data.mergedTelemetryExceptionIds],
        props: data.props,
      });

    const editableIds: Array<string> = editable.map(
      (exception: TelemetryException): string => {
        return exception.id?.toString() || "";
      },
    );

    for (const id of [survivorId, ...mergedIds]) {
      if (
        !editableIds.some((editableId: string): boolean => {
          return sameId(editableId, id);
        })
      ) {
        throw new NotAuthorizedException(
          "You do not have permission to edit one of these exceptions, or it does not exist.",
        );
      }
    }

    const userId: string | null = data.props.userId?.toString() || null;

    return TelemetryExceptionService.executeTransaction(
      async (manager: EntityManager): Promise<ExceptionMergeResult> => {
        const rows: Array<LockedRow> = await TelemetryExceptionMerge.lockRows(
          manager,
          `("_id" = ANY($1::uuid[]) OR "mergedIntoTelemetryExceptionId" = ANY($2::uuid[]))`,
          [[survivorId, ...mergedIds], mergedIds],
        );

        const survivor: LockedRow | undefined = rows.find(
          (row: LockedRow): boolean => {
            return sameId(row.id, survivorId);
          },
        );

        if (!survivor) {
          throw new BadDataException("Exception not found");
        }

        if (survivor.mergedIntoId) {
          throw new BadDataException(
            "This exception was merged into another one. Merge into that one instead.",
          );
        }

        const result: ExceptionMergeResult = {
          telemetryExceptionId: survivor.id,
          merged: [],
        };

        let addedCount: number = 0;
        let firstSeenAt: Date | null = null;
        let lastSeenAt: Date | null = null;
        let firstSeenInRelease: string = "";
        let lastSeenInRelease: string = "";
        let unhandled: boolean = false;

        for (const mergedId of mergedIds) {
          const merged: LockedRow | undefined = rows.find(
            (row: LockedRow): boolean => {
              return sameId(row.id, mergedId);
            },
          );

          if (!merged) {
            throw new BadDataException("Exception not found");
          }

          if (sameId(merged.mergedIntoId, survivor.id)) {
            result.merged.push({
              telemetryExceptionId: merged.id,
              outcome: ExceptionMergeOutcome.AlreadyMerged,
            });
            continue;
          }

          if (merged.mergedIntoId) {
            throw new BadDataException(
              "One of these exceptions is already merged into another one. Unmerge it first.",
            );
          }

          if (
            merged.projectId.toLowerCase() !==
              survivor.projectId.toLowerCase() ||
            merged.primaryEntityId.toLowerCase() !==
              survivor.primaryEntityId.toLowerCase()
          ) {
            throw new BadDataException(
              "Only exceptions of the same service can be merged.",
            );
          }

          // The ones merged into it move to the survivor, counts and all.
          const members: Array<LockedRow> = rows.filter(
            (row: LockedRow): boolean => {
              return sameId(row.mergedIntoId, merged.id);
            },
          );
          const membersCount: number = members.reduce(
            (total: number, row: LockedRow): number => {
              return total + row.occuranceCount;
            },
            0,
          );

          addedCount += merged.occuranceCount;
          firstSeenAt = earliest(firstSeenAt, merged.firstSeenAt);

          if (
            merged.firstSeenInRelease &&
            sameDate(firstSeenAt, merged.firstSeenAt)
          ) {
            firstSeenInRelease = merged.firstSeenInRelease;
          }

          lastSeenAt = latest(lastSeenAt, merged.lastSeenAt);

          if (
            merged.lastSeenInRelease &&
            sameDate(lastSeenAt, merged.lastSeenAt)
          ) {
            lastSeenInRelease = merged.lastSeenInRelease;
          }

          unhandled = unhandled || merged.unhandled;

          await manager.query(
            `UPDATE "TelemetryException" SET "mergedIntoTelemetryExceptionId" = $1, "mergedAt" = now(), "mergedByUserId" = $2, "occuranceCount" = GREATEST(0, COALESCE("occuranceCount", 0) - $3), "updatedAt" = now() WHERE "_id" = $4`,
            [survivor.id, userId, membersCount, merged.id],
          );

          if (members.length > 0) {
            await manager.query(
              `UPDATE "TelemetryException" SET "mergedIntoTelemetryExceptionId" = $1, "updatedAt" = now() WHERE "mergedIntoTelemetryExceptionId" = $2`,
              [survivor.id, merged.id],
            );
          }

          result.merged.push({
            telemetryExceptionId: merged.id,
            outcome: ExceptionMergeOutcome.Merged,
          });
        }

        if (
          result.merged.some(
            (entry: { outcome: ExceptionMergeOutcome }): boolean => {
              return entry.outcome === ExceptionMergeOutcome.Merged;
            },
          )
        ) {
          await manager.query(
            `UPDATE "TelemetryException" SET
              "occuranceCount" = COALESCE("occuranceCount", 0) + $1,
              "firstSeenInRelease" = CASE
                WHEN $2::text <> '' AND ("firstSeenAt" IS NULL OR $3::timestamptz < "firstSeenAt") THEN $2::text
                ELSE "firstSeenInRelease" END,
              "lastSeenInRelease" = CASE
                WHEN $4::text <> '' AND ("lastSeenAt" IS NULL OR $5::timestamptz > "lastSeenAt") THEN $4::text
                ELSE "lastSeenInRelease" END,
              "firstSeenAt" = LEAST("firstSeenAt", $3::timestamptz),
              "lastSeenAt" = GREATEST("lastSeenAt", $5::timestamptz),
              "unhandled" = COALESCE("unhandled", false) OR $6::boolean,
              "updatedAt" = now()
            WHERE "_id" = $7`,
            [
              addedCount,
              firstSeenInRelease,
              firstSeenAt,
              lastSeenInRelease,
              lastSeenAt,
              unhandled,
              survivor.id,
            ],
          );
        }

        return result;
      },
    );
  }

  public static async unmerge(data: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ExceptionUnmergeResult> {
    const mergedId: string = data.telemetryExceptionId.toString();

    // Permission on the merged one first, then on the one it is merged into.
    const [merged] = await TelemetryExceptionMerge.readEditable({
      ids: [data.telemetryExceptionId],
      props: data.props,
    });

    if (!merged) {
      throw new NotAuthorizedException(
        "You do not have permission to edit this exception, or it does not exist.",
      );
    }

    const survivorId: ObjectID | undefined =
      merged.mergedIntoTelemetryExceptionId || undefined;

    if (!survivorId) {
      return {
        telemetryExceptionId: merged.id!.toString(),
        unmergedFromTelemetryExceptionId: null,
        outcome: ExceptionUnmergeOutcome.NotMerged,
      };
    }

    const [survivor] = await TelemetryExceptionMerge.readEditable({
      ids: [survivorId],
      props: data.props,
    });

    if (!survivor) {
      throw new NotAuthorizedException(
        "You do not have permission to edit the exception this one was merged into.",
      );
    }

    return TelemetryExceptionService.executeTransaction(
      async (manager: EntityManager): Promise<ExceptionUnmergeResult> => {
        const rows: Array<LockedRow> = await TelemetryExceptionMerge.lockRows(
          manager,
          `"_id" = ANY($1::uuid[])`,
          [[mergedId, survivorId.toString()]],
        );

        const lockedMerged: LockedRow | undefined = rows.find(
          (row: LockedRow): boolean => {
            return sameId(row.id, mergedId);
          },
        );

        // Unmerged by someone else meanwhile: nothing left to do.
        if (!lockedMerged || !lockedMerged.mergedIntoId) {
          return {
            telemetryExceptionId: mergedId,
            unmergedFromTelemetryExceptionId: null,
            outcome: ExceptionUnmergeOutcome.NotMerged,
          };
        }

        await manager.query(
          `UPDATE "TelemetryException" SET "occuranceCount" = GREATEST(0, COALESCE("occuranceCount", 0) - $1), "updatedAt" = now() WHERE "_id" = $2`,
          [lockedMerged.occuranceCount, lockedMerged.mergedIntoId],
        );

        await manager.query(
          `UPDATE "TelemetryException" SET "mergedIntoTelemetryExceptionId" = NULL, "mergedAt" = NULL, "mergedByUserId" = NULL, "updatedAt" = now() WHERE "_id" = $1`,
          [lockedMerged.id],
        );

        return {
          telemetryExceptionId: lockedMerged.id,
          unmergedFromTelemetryExceptionId: lockedMerged.mergedIntoId,
          outcome: ExceptionUnmergeOutcome.Unmerged,
        };
      },
    );
  }
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return Boolean(a) && Boolean(b) && new Date(a!).getTime() === new Date(b!).getTime();
}
