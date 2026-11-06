import type { QueryRunner } from "typeorm";
import type { TwinMerge, TwinToTakeIn } from "./DuplicateRowMerge";
import {
  ExceptionCounts,
  ExceptionTakeInStatement,
  NOTHING_TAKEN_IN,
  getTakeBackStatement,
  getTakeInStatement,
  takeIn,
} from "../../Utils/Telemetry/ExceptionTakeIn";

/*
 * TWO COPIES OF ONE EXCEPTION, WHEN THE TWO COPIES OF ITS RESOURCE MERGE.
 *
 * An exception group is one row per project, resource and fingerprint (the
 * unique index on "projectId", "primaryEntityId", "fingerprint"). When
 * DuplicateRowMerge merges the copies of one resource - two hosts a race
 * made of one, issue #5214 - an exception both copies had is two rows that
 * are one: the kept host's, which stays, and the duplicate's twin, which is
 * dropped. Before it is dropped, the kept one takes in what it knew, as an
 * exception a person merges into another is taken in (TelemetryException
 * Merge), so the exception reads as if every occurrence had landed on it:
 *
 *   - its count, its first and last seen with the release each was seen in,
 *     and whether any occurrence escaped uncaught - the same arithmetic
 *     (ExceptionTakeIn);
 *   - its triage: the resolution made last, by either copy, stands - unless
 *     either copy was seen after it, by the rule ingest reopens a resolved
 *     exception by (REOPENS_RESOLVED_EXCEPTION_SQL, App's Telemetry/Utils/
 *     Exception.ts): an occurrence after the resolve, from another release
 *     for one resolved in the next release. Seen after it, the exception is
 *     open again and reads Regressed. It stays archived only if both copies
 *     were - one left on the list keeps it there, as for the host itself -
 *     and its assignee, message and AI explanation are the kept copy's, or
 *     the twin's where the kept one has none (the rules of
 *     EXCEPTION_TWIN_MERGE, which DuplicateRowMerge applies). Its error
 *     class is the one from the stronger source - declared by the code,
 *     then a person's, then OneUptime AI's - the kept copy's on a tie, as
 *     every writer of it ranks them;
 *   - where exceptions were merged into others (a database with exception
 *     merges), the kept copy keeps its place: the exceptions merged into the
 *     twin follow it to the kept copy's survivor - the kept copy itself, or
 *     the exception it was merged into - counts and all, as merging an
 *     exception others were merged into moves them along; and a twin that was
 *     merged into another exception is first taken back off it, as an
 *     unmerge takes it back (its count; the survivor's seen times stay).
 *     So an exception that is not merged still counts its own occurrences
 *     and those of every exception merged into it, and a merged one its own.
 *
 * The twin is not kept as a merged alias of the kept one, as an exception a
 * person merges is: its fingerprint already is the kept one's, the resource
 * it names is gone and reports nothing again, so nothing would ever be
 * counted or read through it - and an Unmerge would bring back an exception
 * of a resource that no longer exists.
 *
 * Its occurrences keep the dropped copy's id in ClickHouse, where it is a
 * sort key and nothing rewrites it (Postgres migrations do not reach into
 * ClickHouse; see 1778100000000-DedupeServicesAndAddUniqueIndex): the kept
 * exception counts them, its page reads the kept copy's, and they age out
 * with the resource's retention.
 *
 * A column the table does not have is left alone: the host merge
 * (1806700000000) only ever meets the schema of its own time in production,
 * which has no Regressed time, no release to wait for and no exception
 * merges yet. Nor does it forget the groups the processes cached
 * (TelemetryExceptionService.forgetGroupFingerprints): a migration reaches
 * no cache, and they expire within a minute.
 */

const MERGED_INTO: string = "mergedIntoTelemetryExceptionId";

// Where an exception stands: resolved, by whom and when, and if it came back.
export interface ExceptionTriage {
  isResolved: boolean;
  markedAsResolvedAt: Date | null;
  markedAsResolvedByUserId: string | null;
  // Resolve in next release: the release it waits out.
  resolvedInReleaseAfter: string | null;
  // When it came back after it was resolved; it reads Regressed while open.
  regressedAt: Date | null;
}

// A copy's triage, with when and in which release it was seen last.
export interface ExceptionCopyTriage extends ExceptionTriage {
  lastSeenAt: Date | null;
  lastSeenInRelease: string | null;
}

// A copy's last occurrence: what can reopen a resolution.
export type ExceptionLastSeen = Pick<
  ExceptionCopyTriage,
  "lastSeenAt" | "lastSeenInRelease"
>;

// An exception's error class, and where it came from.
export interface ExceptionErrorClass {
  errorClass: string | null;
  errorClassSource: string | null;
}

// One row as the merge reads it.
interface ExceptionRow
  extends ExceptionCounts,
    ExceptionCopyTriage,
    ExceptionErrorClass {
  id: string;
  mergedIntoId: string | null;
}

/*
 * How strong a source of an error class is, as every writer of it ranks
 * them (InsightTriageRunner): declared by the throwing code, then a
 * person's, then OneUptime AI's; 'default' - nobody classified it - and
 * anything else, none.
 */
const ERROR_CLASS_SOURCE_RANK: ReadonlyMap<string, number> = new Map<
  string,
  number
>([
  ["declared", 3],
  ["manual", 2],
  ["ai", 1],
]);

function rankOfErrorClassSource(source: string | null): number {
  return ERROR_CLASS_SOURCE_RANK.get(source || "") || 0;
}

/*
 * The kept copy's error class once the twin's is taken in: the one from
 * the stronger source, the kept copy's on a tie. Pure.
 */
export function foldTwinErrorClass(
  kept: ExceptionErrorClass,
  twin: ExceptionErrorClass,
): ExceptionErrorClass {
  return rankOfErrorClassSource(twin.errorClassSource) >
    rankOfErrorClassSource(kept.errorClassSource)
    ? { errorClass: twin.errorClass, errorClassSource: twin.errorClassSource }
    : { errorClass: kept.errorClass, errorClassSource: kept.errorClassSource };
}

function timeOf(value: Date | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const millis: number = new Date(value).getTime();

  return Number.isNaN(millis) ? null : millis;
}

function latestOf(a: Date | null, b: Date | null): Date | null {
  const aTime: number | null = timeOf(a);
  const bTime: number | null = timeOf(b);

  if (aTime === null) {
    return bTime === null ? null : b;
  }

  if (bTime === null) {
    return a;
  }

  return aTime >= bTime ? a : b;
}

function sameId(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return Boolean(a) && Boolean(b) && a!.toLowerCase() === b!.toLowerCase();
}

/*
 * When a resolved copy was resolved: when it was marked - or, where that is
 * not known, no earlier than its own last occurrence, since it is resolved
 * still and an occurrence after the resolve would have reopened it.
 */
function resolvedTimeOf(copy: ExceptionCopyTriage): number | null {
  return timeOf(copy.markedAsResolvedAt) ?? timeOf(copy.lastSeenAt);
}

/*
 * Whether `seen`'s last occurrence reopens `resolved`, by the rule ingest
 * reopens a resolved exception by (REOPENS_RESOLVED_EXCEPTION_SQL): it
 * happened after the resolve, and - for one resolved in the next release -
 * in a release it names that is not the one it was resolved after. A copy
 * never seen reopens nothing.
 */
export function reopensResolution(
  resolved: ExceptionCopyTriage,
  seen: ExceptionLastSeen,
): boolean {
  const seenAt: number | null = timeOf(seen.lastSeenAt);

  if (seenAt === null) {
    return false;
  }

  const resolvedAt: number | null = resolvedTimeOf(resolved);

  if (resolvedAt !== null && seenAt <= resolvedAt) {
    return false;
  }

  const releaseAfter: string = resolved.resolvedInReleaseAfter || "";

  if (releaseAfter === "") {
    return true;
  }

  const release: string = seen.lastSeenInRelease || "";

  return release !== "" && release !== releaseAfter;
}

/*
 * When it is known to have come back after `resolved`: the earliest of the
 * copies that reopen it - each one's own Regressed time where that is after
 * the resolve, else its last occurrence. Never the time of the merge, which
 * would read as a regression that just happened.
 */
function cameBackAt(
  resolved: ExceptionCopyTriage,
  reopenedBy: Array<ExceptionCopyTriage | ExceptionLastSeen>,
): Date | null {
  const resolvedAt: number | null = resolvedTimeOf(resolved);
  let cameBack: Date | null = null;

  for (const copy of reopenedBy) {
    const regressedAt: Date | null =
      "regressedAt" in copy ? copy.regressedAt : null;
    const regressedTime: number | null = timeOf(regressedAt);
    const known: Date | null =
      regressedTime !== null &&
      (resolvedAt === null || regressedTime > resolvedAt)
        ? regressedAt
        : copy.lastSeenAt;

    const knownTime: number | null = timeOf(known);

    if (
      knownTime !== null &&
      (cameBack === null || knownTime < (timeOf(cameBack) as number))
    ) {
      cameBack = known;
    }
  }

  return cameBack;
}

function triageOf(copy: ExceptionCopyTriage): ExceptionTriage {
  return {
    isResolved: copy.isResolved,
    markedAsResolvedAt: copy.markedAsResolvedAt,
    markedAsResolvedByUserId: copy.markedAsResolvedByUserId,
    resolvedInReleaseAfter: copy.resolvedInReleaseAfter,
    regressedAt: copy.regressedAt,
  };
}

/*
 * The kept copy's triage, once the twin's is taken in. The resolution made
 * last, by either copy - one whose time is not known counts as the older,
 * and the kept copy's wins a tie - stands unless either copy was seen after
 * it (reopensResolution): then it is open again, its resolution cleared as
 * ingest clears it, and Regressed from when it is known to have come back.
 * Neither resolved: open, Regressed when either copy was, from the later
 * time. Pure.
 */
export function foldTwinTriage(
  kept: ExceptionCopyTriage,
  twin: ExceptionCopyTriage,
): ExceptionTriage {
  const copies: Array<ExceptionCopyTriage> = [kept, twin];
  const resolved: Array<ExceptionCopyTriage> = copies.filter(
    (copy: ExceptionCopyTriage): boolean => {
      return copy.isResolved;
    },
  );

  if (resolved.length === 0) {
    return {
      ...triageOf(kept),
      regressedAt: latestOf(kept.regressedAt, twin.regressedAt),
    };
  }

  let lastResolved: ExceptionCopyTriage = resolved[0]!;

  for (const copy of resolved.slice(1)) {
    const time: number = resolvedTimeOf(copy) ?? Number.NEGATIVE_INFINITY;
    const lastTime: number =
      resolvedTimeOf(lastResolved) ?? Number.NEGATIVE_INFINITY;

    if (time > lastTime) {
      lastResolved = copy;
    }
  }

  const reopenedBy: Array<ExceptionCopyTriage> = copies.filter(
    (copy: ExceptionCopyTriage): boolean => {
      return reopensResolution(lastResolved, copy);
    },
  );

  if (reopenedBy.length === 0) {
    return triageOf(lastResolved);
  }

  return {
    isResolved: false,
    markedAsResolvedAt: null,
    markedAsResolvedByUserId: null,
    resolvedInReleaseAfter: null,
    regressedAt: cameBackAt(lastResolved, reopenedBy),
  };
}

/*
 * The triage of the exception the kept copy was merged into, once the
 * twin's occurrences count there too: resolved, and the twin was seen after
 * it, it is open again and Regressed - as ingest reopens a survivor on an
 * occurrence of an exception merged into it. Null when it stays as it is.
 * The twin's own resolution is the kept copy's business, not the
 * survivor's. Pure.
 */
export function reopenedByTwin(
  survivor: ExceptionCopyTriage,
  twin: ExceptionLastSeen,
): ExceptionTriage | null {
  if (!survivor.isResolved || !reopensResolution(survivor, twin)) {
    return null;
  }

  return {
    isResolved: false,
    markedAsResolvedAt: null,
    markedAsResolvedByUserId: null,
    resolvedInReleaseAfter: null,
    regressedAt: cameBackAt(survivor, [twin]),
  };
}

function sameTriage(a: ExceptionTriage, b: ExceptionTriage): boolean {
  return (
    a.isResolved === b.isResolved &&
    timeOf(a.markedAsResolvedAt) === timeOf(b.markedAsResolvedAt) &&
    (a.markedAsResolvedByUserId || null) ===
      (b.markedAsResolvedByUserId || null) &&
    (a.resolvedInReleaseAfter || null) === (b.resolvedInReleaseAfter || null) &&
    timeOf(a.regressedAt) === timeOf(b.regressedAt)
  );
}

// What the merge reads of a row; a column the table lacks reads as empty.
function selectListFor(columns: ReadonlySet<string>): string {
  const read: (column: string, expression: string, empty: string) => string = (
    column: string,
    expression: string,
    empty: string,
  ): string => {
    return columns.has(column) ? expression : `${empty} AS "${column}"`;
  };

  return [
    `"_id"::text AS "id"`,
    `COALESCE("occuranceCount", 0)::int AS "occuranceCount"`,
    read("firstSeenAt", `"firstSeenAt"`, "NULL::timestamptz"),
    read("lastSeenAt", `"lastSeenAt"`, "NULL::timestamptz"),
    read("firstSeenInRelease", `"firstSeenInRelease"`, "NULL::text"),
    read("lastSeenInRelease", `"lastSeenInRelease"`, "NULL::text"),
    read("unhandled", `COALESCE("unhandled", false) AS "unhandled"`, "false"),
    read(
      "isResolved",
      `COALESCE("isResolved", false) AS "isResolved"`,
      "false",
    ),
    read("markedAsResolvedAt", `"markedAsResolvedAt"`, "NULL::timestamptz"),
    read(
      "markedAsResolvedByUserId",
      `"markedAsResolvedByUserId"::text AS "markedAsResolvedByUserId"`,
      "NULL::text",
    ),
    read("resolvedInReleaseAfter", `"resolvedInReleaseAfter"`, "NULL::text"),
    read("regressedAt", `"regressedAt"`, "NULL::timestamptz"),
    read("errorClass", `"errorClass"`, "NULL::text"),
    read("errorClassSource", `"errorClassSource"`, "NULL::text"),
    columns.has(MERGED_INTO)
      ? `"${MERGED_INTO}"::text AS "mergedIntoId"`
      : `NULL::text AS "mergedIntoId"`,
  ].join(", ");
}

/*
 * The two rows, and on a database with exception merges the exceptions
 * they were merged into and the ones merged into the twin, locked in the
 * order the ingest upsert locks them (project, resource, fingerprint).
 */
async function lockRows(
  queryRunner: QueryRunner,
  twin: TwinToTakeIn,
): Promise<Array<ExceptionRow>> {
  const hasMerges: boolean = twin.columns.has(MERGED_INTO);

  const rows: Array<ExceptionRow> = await queryRunner.query(
    `SELECT ${selectListFor(twin.columns)} FROM ${twin.table}
      WHERE "_id" = ANY($1::uuid[])${
        hasMerges
          ? ` OR "_id" IN (SELECT "${MERGED_INTO}" FROM ${twin.table} WHERE "_id" = ANY($1::uuid[])) OR "${MERGED_INTO}" = $2::uuid`
          : ""
      }
      ORDER BY "projectId", "primaryEntityId", "fingerprint"
      FOR UPDATE`,
    hasMerges
      ? [[twin.keptId, twin.twinId], twin.twinId]
      : [[twin.keptId, twin.twinId]],
  );

  return Array.isArray(rows) ? rows : [];
}

async function run(
  queryRunner: QueryRunner,
  statement: ExceptionTakeInStatement,
): Promise<void> {
  await queryRunner.query(statement.query, statement.parameters);
}

// Writes `triage` on a row, the columns the table has.
async function writeTriage(
  queryRunner: QueryRunner,
  twin: TwinToTakeIn,
  exceptionId: string,
  triage: ExceptionTriage,
): Promise<void> {
  const assignments: Array<string> = [];
  const parameters: Array<unknown> = [];

  const set: (column: string, value: unknown, cast: string) => void = (
    column: string,
    value: unknown,
    cast: string,
  ): void => {
    if (!twin.columns.has(column)) {
      return;
    }

    parameters.push(value);
    assignments.push(`"${column}" = $${parameters.length}::${cast}`);
  };

  set("isResolved", triage.isResolved, "boolean");
  set("markedAsResolvedAt", triage.markedAsResolvedAt, "timestamptz");
  set("markedAsResolvedByUserId", triage.markedAsResolvedByUserId, "uuid");
  set("resolvedInReleaseAfter", triage.resolvedInReleaseAfter, "text");
  set("regressedAt", triage.regressedAt, "timestamptz");

  if (assignments.length === 0) {
    return;
  }

  parameters.push(exceptionId);

  await queryRunner.query(
    `UPDATE ${twin.table} SET ${assignments.join(", ")}, "updatedAt" = now() WHERE "_id" = $${parameters.length}::uuid`,
    parameters,
  );
}

/*
 * The kept exception takes the twin in, before what refers to the twin
 * moves to it and the twin is dropped (DuplicateRowMerge.dropTwins). Runs
 * in the transaction of the group of rows being merged.
 */
export async function takeInExceptionTwin(
  queryRunner: QueryRunner,
  twin: TwinToTakeIn,
): Promise<void> {
  const rows: Array<ExceptionRow> = await lockRows(queryRunner, twin);

  const kept: ExceptionRow | undefined = rows.find(
    (row: ExceptionRow): boolean => {
      return sameId(row.id, twin.keptId);
    },
  );
  const dropped: ExceptionRow | undefined = rows.find(
    (row: ExceptionRow): boolean => {
      return sameId(row.id, twin.twinId);
    },
  );

  // Either is gone already: nothing to take in.
  if (!kept || !dropped) {
    return;
  }

  const hasMerges: boolean = twin.columns.has(MERGED_INTO);

  /*
   * The kept copy merged into the twin itself - not something a person can
   * do across two resources, but if it is so, it takes the twin's place: it
   * leaves the twin's group, and the twin's count no longer holds it.
   */
  const keptWasMergedIntoTwin: boolean =
    hasMerges && sameId(kept.mergedIntoId, dropped.id);

  // The exception the kept copy was merged into: its group takes the twin's.
  const survivor: ExceptionRow | undefined =
    hasMerges && kept.mergedIntoId && !keptWasMergedIntoTwin
      ? rows.find((row: ExceptionRow): boolean => {
          return sameId(row.id, kept.mergedIntoId);
        })
      : undefined;

  // The exception the twin was merged into: it gives the twin back.
  const twinSurvivor: ExceptionRow | undefined =
    hasMerges && dropped.mergedIntoId
      ? rows.find((row: ExceptionRow): boolean => {
          return sameId(row.id, dropped.mergedIntoId);
        })
      : undefined;

  // The exceptions merged into the twin: they follow it.
  const members: Array<ExceptionRow> = hasMerges
    ? rows.filter((row: ExceptionRow): boolean => {
        return sameId(row.mergedIntoId, dropped.id) && !sameId(row.id, kept.id);
      })
    : [];

  const membersCount: number = members.reduce(
    (total: number, row: ExceptionRow): number => {
      return total + row.occuranceCount;
    },
    0,
  );

  // What the twin counted of its own, and with those merged into it.
  const ownCount: number = Math.max(
    0,
    dropped.occuranceCount -
      membersCount -
      (keptWasMergedIntoTwin ? kept.occuranceCount : 0),
  );
  const groupCount: number = ownCount + membersCount;

  if (keptWasMergedIntoTwin) {
    await queryRunner.query(
      `UPDATE ${twin.table} SET "${MERGED_INTO}" = NULL${
        twin.columns.has("mergedAt") ? `, "mergedAt" = NULL` : ""
      }${
        twin.columns.has("mergedByUserId") ? `, "mergedByUserId" = NULL` : ""
      }, "updatedAt" = now() WHERE "_id" = $1::uuid`,
      [kept.id],
    );
  }

  // Taken back off the exception it was merged into, as an unmerge does.
  if (dropped.mergedIntoId) {
    if (twinSurvivor) {
      await run(
        queryRunner,
        getTakeBackStatement({
          table: twin.table,
          exceptionId: twinSurvivor.id,
          occuranceCount: dropped.occuranceCount,
        }),
      );
    }

    await queryRunner.query(
      `UPDATE ${twin.table} SET "${MERGED_INTO}" = NULL, "updatedAt" = now() WHERE "_id" = $1::uuid`,
      [dropped.id],
    );
  }

  /*
   * The kept copy counts the twin's own occurrences - and those of the ones
   * merged into the twin too, when they join its own group.
   */
  await run(
    queryRunner,
    getTakeInStatement({
      table: twin.table,
      exceptionId: kept.id,
      takenIn: takeIn(
        NOTHING_TAKEN_IN,
        dropped,
        survivor ? ownCount : groupCount,
      ),
    }),
  );

  if (survivor) {
    await run(
      queryRunner,
      getTakeInStatement({
        table: twin.table,
        exceptionId: survivor.id,
        takenIn: takeIn(NOTHING_TAKEN_IN, dropped, groupCount),
      }),
    );
  }

  if (members.length > 0) {
    await queryRunner.query(
      `UPDATE ${twin.table} SET "${MERGED_INTO}" = $1::uuid, "updatedAt" = now() WHERE "${MERGED_INTO}" = $2::uuid AND "_id" <> $3::uuid`,
      [(survivor || kept).id, dropped.id, kept.id],
    );
  }

  const keptTriage: ExceptionTriage = foldTwinTriage(kept, dropped);

  if (!sameTriage(keptTriage, triageOf(kept))) {
    await writeTriage(queryRunner, twin, kept.id, keptTriage);
  }

  if (survivor) {
    const survivorTriage: ExceptionTriage | null = reopenedByTwin(
      survivor,
      dropped,
    );

    if (survivorTriage) {
      await writeTriage(queryRunner, twin, survivor.id, survivorTriage);
    }
  }

  const errorClass: ExceptionErrorClass = foldTwinErrorClass(kept, dropped);

  if (
    twin.columns.has("errorClass") &&
    twin.columns.has("errorClassSource") &&
    (errorClass.errorClass !== kept.errorClass ||
      errorClass.errorClassSource !== kept.errorClassSource)
  ) {
    await queryRunner.query(
      `UPDATE ${twin.table} SET "errorClass" = $1::text, "errorClassSource" = $2::text, "updatedAt" = now() WHERE "_id" = $3::uuid`,
      [errorClass.errorClass, errorClass.errorClassSource, kept.id],
    );
  }
}

/*
 * How DuplicateRowMerge merges two copies of one exception: the columns a
 * person sets, by the rules the kept row of a group takes by - the kept
 * copy's own, else the twin's (the one seen last, when there are more) -
 * then the counts, the triage and the merges (takeInExceptionTwin).
 */
export const EXCEPTION_TWIN_MERGE: TwinMerge = {
  table: "TelemetryException",
  keptOrFirstOf: [
    "message",
    "stackTrace",
    "exceptionType",
    "environment",
    "primaryEntityType",
    "aiClassification",
    "aiFixDeclinedAt",
  ],
  takenTogether: [
    // Archived only if both copies were: one left on the list keeps it there.
    {
      columns: ["isArchived", "markedAsArchivedAt", "markedAsArchivedByUserId"],
      where: `member."isArchived" IS NOT TRUE`,
    },
    // One assignee, a person or a team: the kept copy's, else the twin's.
    {
      columns: ["assignToUserId", "assignToTeamId"],
      where: `member."assignToUserId" IS NOT NULL OR member."assignToTeamId" IS NOT NULL`,
    },
    // OneUptime AI's explanation with when it was written.
    {
      columns: ["aiExplanation", "aiExplanationGeneratedAt"],
      where: `member."aiExplanation" IS NOT NULL`,
    },
  ],
  latestBy: "lastSeenAt",
  takeIn: takeInExceptionTwin,
};
