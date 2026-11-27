import DataMigrationBase from "./DataMigrationBase";
import ExceptionUtil, {
  ExceptionGroupingContent,
  ExceptionSplitByFailedLookup,
  GROUP_FINGERPRINT_LOOKUP_SQL,
  GroupFingerprintCandidate,
  GroupLookupRow,
  KnownGroup,
  OccurrenceFingerprints,
  knownGroupsOfLookupRows,
} from "../../Telemetry/Utils/Exception";
import DataMigration from "Common/Models/DatabaseModels/DataMigration";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import {
  DbJSONResponse,
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import ExceptionInstanceService, {
  EXCEPTION_ORIGINALS_SQL,
} from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import PresentedKeysAtRest from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import TelemetryExceptionSplitHeal, {
  ExceptionSplitHealOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionSplitHeal";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE DUPLICATES A FAILED LOOKUP MADE BEFORE #11027, MERGED BACK WHEN THEIR
 * ERROR NEVER HAPPENS AGAIN (#11113).
 *
 * Until #11027, an occurrence whose project's exceptions could not be read
 * was filed under its grouping v1 fingerprint. An exception made since
 * grouping v2 (2026-10-30) has none there, so the upsert made a duplicate:
 * a second exception for an old error, New Exception fired for it, and as
 * every occurrence tries v1 first, the duplicate took every one after it.
 * #11089 stops that, and merges such a duplicate back into the exception it
 * was split from on its next occurrence (TelemetryExceptionSplitHeal). One
 * whose error never happens again kept two rows in the exceptions list, the
 * total split across them. This merges those back, once.
 *
 * WHAT PROVES A DUPLICATE. Only an occurrence carries the fingerprints it
 * tried, so the duplicate's are worked out from what it stored: its message,
 * stack trace and type.
 *
 *   - Its fingerprint must be grouping v1's of that text. Then the text is
 *     what the occurrence arrived with, as far as v1 reads it: no scrub rule
 *     changed it (a rule that did leaves a text whose v1 is another). A row
 *     whose fingerprint is anything else - a v2, v3 or v4 one, a keyed one,
 *     a v1 of text a rule has hidden part of since - proves nothing, and is
 *     left as it is.
 *   - Its text's fingerprints are then those an occurrence of it tries, in
 *     the order it tries them (ExceptionUtil.getOccurrenceFingerprints, the
 *     text as it arrived and as it was stored): v1, keyed v1, v2, keyed v2,
 *     v3, keyed v3, v4, keyed v4. Which of them an exception exists under is
 *     read as ingest reads it (GROUP_FINGERPRINT_LOOKUP_SQL), per project,
 *     a page at a time.
 *   - It is a duplicate exactly when ingest's own rule says so
 *     (ExceptionUtil.splitByFailedLookupOf): the first exception under a
 *     fingerprint tried after v1 was made before it. Since grouping v2
 *     nothing but that failure made an exception under v1, and every one
 *     made under v1 before grouping v2 is older than any made since.
 *   - And every occurrence of it ClickHouse still keeps says the same: its
 *     earliest and latest (OCCURRENCES_READ each), each of whose text is
 *     grouping v1's of its fingerprint, must lead to that same exception.
 *     One that leads elsewhere, or to none, means the two may not be one
 *     error, and they are left. So is a pair whose occurrences could not be
 *     read.
 *
 * Never merged on a guess: a pair it cannot prove is left as two, which is
 * what it was. A person merges such a pair from Similar exceptions.
 *
 * THE MERGE is the one the next occurrence would make
 * (TelemetryExceptionSplitHeal.heal, TelemetryExceptionMerge.merge, as
 * OneUptime): the older exception survives with its first seen, its state,
 * its assignment and its history, and takes in the duplicate's count and
 * seen times; the duplicate leaves the lists and every count; both
 * timelines say so; nothing alerts; Unmerge undoes it. The heal reads both
 * rows again and holds to its own rules: the duplicate made after the other,
 * and no person merged it elsewhere or took it out of a merge.
 *
 * BATCHED, RESUMABLE AND BOUNDED. The exceptions made since grouping v2 -
 * and before the sweep started, which nothing since can have split - are
 * read in pages of PAGE_SIZE by id, after the last id read (a keyset, so a
 * page costs the same at the end of the table as at its start). Where it is
 * is kept in Valkey after each page: a run cut short goes on where it
 * stopped. A page's texts are read only up to MAX_TEXT_BYTES an exception;
 * a longer one is left. ClickHouse is read for a pair only, twice, each
 * bounded by the duplicate's seen times, its fingerprint's index, a limit
 * and a time limit; the merge writes one audit entry, which ClickHouse
 * takes as an async insert.
 *
 * At the upgrade it runs for MIGRATION_TIME_BUDGET_MS at most, so it never
 * holds up the upgrade (with migrate.hook, Helm waits for data migrations).
 * What is left, the TelemetryException:MergeBackExceptionsSplitByFailedLookups
 * job goes on with every 15 minutes, from where it stopped, until every
 * exception is read; then it records SWEPT_MARKER_NAME and never sweeps
 * again. A read of Postgres that fails stops the run where it is, for the
 * next to go on from.
 *
 * IDEMPOTENT, AND SAFE TWICE AT ONCE. A merged duplicate leaves the rows it
 * reads; one left is decided the same way again. Two runs at once, or a
 * run beside the next occurrence's heal, merge a pair once: the merge locks
 * both rows and merges nothing merged already.
 */

export const MERGE_BACK_SPLITS_MIGRATION_NAME: string =
  "MergeBackExceptionsSplitByFailedLookups";

// Recorded in the DataMigrations table once every exception has been read.
export const SWEPT_MARKER_NAME: string = `${MERGE_BACK_SPLITS_MIGRATION_NAME}:Swept`;

// The job that goes on with the sweep after the upgrade.
export const MERGE_BACK_SPLITS_JOB_NAME: string =
  "TelemetryException:MergeBackExceptionsSplitByFailedLookups";

/*
 * When grouping v2 shipped (dc059b0b1ed, 2026-10-30 23:51 UTC), from the
 * start of that day: no failed lookup made a duplicate before it.
 */
export const GROUPING_V2_SINCE: Date = new Date("2026-10-30T00:00:00.000Z");

// Exceptions read at once.
export const PAGE_SIZE: number = 100;

// The most an exception's message, stack trace and type are read, in bytes.
export const MAX_TEXT_BYTES: number = 512 * 1024;

// A duplicate's earliest occurrences ClickHouse keeps that are read, and its latest.
export const OCCURRENCES_READ: number = 100;

// How long ClickHouse may take over each of those reads.
export const OCCURRENCE_READ_TIME_LIMIT_SECONDS: number = 20;

// Read before and after the duplicate's seen times, for a clock a little off.
export const OCCURRENCE_WINDOW_SLACK_MS: number = 60 * 1000;

// How long the upgrade's run goes on; the job does the rest.
export const MIGRATION_TIME_BUDGET_MS: number = 2 * 60 * 1000;

// Where the sweep is kept, and for how long after its last page.
export const SWEEP_PROGRESS_NAMESPACE: string = "data-migration-progress";
export const SWEEP_PROGRESS_TTL_SECONDS: number = 60 * 24 * 60 * 60;

// Below every id: the first page reads from the start.
export const FIRST_ID: string = "00000000-0000-0000-0000-000000000000";

/*
 * A page of the exceptions made since grouping v2 (at or after $2) and
 * before the sweep started (at or before $4), after the id $1, in id order,
 * $5 at most: not deleted, not merged, not a row that only keeps a former
 * fingerprint (#10619). An exception's message, stack trace and type are
 * read only when they come to at most $3 bytes; "textBytes" says how much
 * they come to (octet_length reads it from the stored value's header).
 */
export const SWEEP_PAGE_SQL: string = `SELECT "page"."id", "page"."projectId", "page"."primaryEntityId", "page"."fingerprint", "page"."createdAt", "page"."firstSeenAt", "page"."lastSeenAt", "page"."textBytes", CASE WHEN "page"."textBytes" <= $3 THEN "page"."message" END AS "message", CASE WHEN "page"."textBytes" <= $3 THEN "page"."stackTrace" END AS "stackTrace", CASE WHEN "page"."textBytes" <= $3 THEN "page"."exceptionType" END AS "exceptionType" FROM (SELECT "_id"::text AS "id", "projectId"::text AS "projectId", "primaryEntityId"::text AS "primaryEntityId", "fingerprint", "createdAt", "firstSeenAt", "lastSeenAt", "message", "stackTrace", "exceptionType", COALESCE(octet_length("message"), 0) + COALESCE(octet_length("stackTrace"), 0) + COALESCE(octet_length("exceptionType"), 0) AS "textBytes" FROM "TelemetryException" WHERE "_id" > $1::uuid AND "createdAt" >= $2 AND "createdAt" <= $4 AND "deletedAt" IS NULL AND "mergedIntoTelemetryExceptionId" IS NULL AND "formerFingerprintOfTelemetryExceptionId" IS NULL ORDER BY "_id" ASC LIMIT $5) AS "page" ORDER BY "page"."id" ASC`;

// One exception the sweep reads, as SWEEP_PAGE_SQL hands it back.
export interface SweptException {
  id: string;
  projectId: string;
  primaryEntityId: string | null;
  fingerprint: string;
  createdAt: Date | string;
  firstSeenAt: Date | string | null;
  lastSeenAt: Date | string | null;
  textBytes: number | string | null;
  // Null when it was not read: more than MAX_TEXT_BYTES, or none stored.
  message: string | null;
  stackTrace: string | null;
  exceptionType: string | null;
}

// Where the sweep is: when it started, and the last id it read.
export interface SweepProgress {
  cutoff: Date;
  after: string;
}

// What a pair's occurrences say of it (occurrencesAgree).
export enum OccurrenceVerdict {
  // Every one whose text proves anything leads to the same exception.
  Agree = "agree",
  // One leads to another exception, or to none: they may not be one error.
  Disagree = "disagree",
  // They could not be read.
  Unread = "unread",
}

/*
 * What a sweep reads and writes through: Postgres, ClickHouse, Valkey and
 * the merge. Tests hand in their own.
 */
export interface MergeBackSplitsEnvironment {
  now: () => Date;
  pageSize: number;
  readPage: (data: {
    after: string;
    since: Date;
    cutoff: Date;
    limit: number;
    maxTextBytes: number;
  }) => Promise<Array<SweptException>>;
  // Which of `fingerprints` an exception of the project exists under, as ingest reads it.
  readKnownGroups: (
    projectId: string,
    fingerprints: Array<string>,
  ) => Promise<Map<string, KnownGroup>>;
  // The texts of an exception's earliest and latest occurrences ClickHouse keeps.
  readOccurrenceTexts: (data: {
    projectId: string;
    primaryEntityId: string;
    fingerprint: string;
    from: Date;
    to: Date;
    limit: number;
  }) => Promise<Array<ExceptionGroupingContent>>;
  heal: (
    pair: ExceptionSplitByFailedLookup,
  ) => Promise<ExceptionSplitHealOutcome>;
  readProgress: () => Promise<SweepProgress | null>;
  writeProgress: (progress: SweepProgress) => Promise<void>;
  // When the upgrade's run of this migration was recorded; null before.
  readMigratedAt: () => Promise<Date | null>;
  isSwept: () => Promise<boolean>;
  recordSwept: (at: Date) => Promise<void>;
}

// What one run of the sweep did.
export interface MergeBackSplitsResult {
  // Every exception made since grouping v2 has been read, now or before.
  isDone: boolean;
  // Read and done before this run: nothing was read.
  wasSweptBefore: boolean;
  // The job's run before the upgrade's: nothing was read.
  isWaitingForUpgrade: boolean;
  pages: number;
  read: number;
  merged: number;
  // Left as they are, by why.
  tooLongToRead: number;
  notOfTheirOwnText: number;
  notADuplicate: number;
  occurrencesDisagree: number;
  occurrencesUnread: number;
  alreadyMerged: number;
  leftToAPerson: number;
  notFound: number;
  mergeFailed: number;
}

function emptyResult(): MergeBackSplitsResult {
  return {
    isDone: false,
    wasSweptBefore: false,
    isWaitingForUpgrade: false,
    pages: 0,
    read: 0,
    merged: 0,
    tooLongToRead: 0,
    notOfTheirOwnText: 0,
    notADuplicate: 0,
    occurrencesDisagree: 0,
    occurrencesUnread: 0,
    alreadyMerged: 0,
    leftToAPerson: 0,
    notFound: 0,
    mergeFailed: 0,
  };
}

function timeOf(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

// The key ExceptionUtil's lookups know a fingerprint by.
function knownKey(projectId: string, fingerprint: string): string {
  return `${projectId}|${fingerprint}`;
}

// What an exception stored, as its fingerprints read it.
export function storedTextOf(
  exception: Pick<SweptException, "message" | "stackTrace" | "exceptionType">,
): ExceptionGroupingContent {
  return {
    message: exception.message || "",
    stackTrace: exception.stackTrace || "",
    exceptionType: exception.exceptionType || "",
  };
}

// Whether its text was too long to read (SWEEP_PAGE_SQL left it out).
export function isTooLongToRead(exception: SweptException): boolean {
  return (Number(exception.textBytes) || 0) > MAX_TEXT_BYTES;
}

/*
 * The fingerprints an occurrence of `text` tries, as ingest makes them,
 * when `fingerprint` is grouping v1's of it - the text is then what the
 * occurrence arrived with, as far as v1 reads it. Null otherwise: nothing
 * proves which fingerprints the occurrence tried. Pure.
 */
export function occurrenceOfText(data: {
  projectId: string;
  primaryEntityId: string | null;
  fingerprint: string;
  text: ExceptionGroupingContent;
}): GroupFingerprintCandidate | null {
  if (!data.projectId || !data.primaryEntityId || !data.fingerprint) {
    return null;
  }

  const projectId: ObjectID = new ObjectID(data.projectId);
  const primaryEntityId: ObjectID = new ObjectID(data.primaryEntityId);

  if (
    ExceptionUtil.getFingerprint({
      projectId,
      primaryEntityId,
      message: data.text.message,
      stackTrace: data.text.stackTrace,
      exceptionType: data.text.exceptionType,
    }) !== data.fingerprint
  ) {
    return null;
  }

  // As it arrived and as it was stored: no rule changed it.
  const fingerprints: OccurrenceFingerprints =
    ExceptionUtil.getOccurrenceFingerprints({
      projectId,
      primaryEntityId,
      arrived: data.text,
      stored: data.text,
    });

  return {
    projectId: data.projectId,
    primaryEntityId: data.primaryEntityId,
    v1: fingerprints.fingerprint,
    v2: fingerprints.fingerprintV2,
    candidates: fingerprints.fingerprintCandidates,
  };
}

// The exception a fingerprint stands for: where it moved, when it did (#10619).
function exceptionUnder(
  known: Map<string, KnownGroup>,
  projectId: string,
  fingerprint: string,
): string {
  return known.get(knownKey(projectId, fingerprint))?.movedTo || fingerprint;
}

// The default environment: Postgres, ClickHouse, Valkey, the merge.
export function getDefaultMergeBackSplitsEnvironment(): MergeBackSplitsEnvironment {
  return {
    now: (): Date => {
      return OneUptimeDate.getCurrentDate();
    },
    pageSize: PAGE_SIZE,
    readPage: async (data: {
      after: string;
      since: Date;
      cutoff: Date;
      limit: number;
      maxTextBytes: number;
    }): Promise<Array<SweptException>> => {
      return (
        (await TelemetryExceptionService.getRepository().manager.query(
          SWEEP_PAGE_SQL,
          [data.after, data.since, data.maxTextBytes, data.cutoff, data.limit],
        )) || []
      );
    },
    readKnownGroups: async (
      projectId: string,
      fingerprints: Array<string>,
    ): Promise<Map<string, KnownGroup>> => {
      const rows: Array<GroupLookupRow> =
        await TelemetryExceptionService.getRepository().manager.query(
          GROUP_FINGERPRINT_LOOKUP_SQL,
          [projectId, fingerprints],
        );

      return knownGroupsOfLookupRows(rows);
    },
    readOccurrenceTexts: readOccurrenceTextsFromClickhouse,
    heal: (
      pair: ExceptionSplitByFailedLookup,
    ): Promise<ExceptionSplitHealOutcome> => {
      return TelemetryExceptionSplitHeal.heal(pair);
    },
    readProgress: async (): Promise<SweepProgress | null> => {
      try {
        return readSweepProgress(
          await GlobalCache.getString(
            SWEEP_PROGRESS_NAMESPACE,
            MERGE_BACK_SPLITS_MIGRATION_NAME,
          ),
        );
      } catch (err) {
        logger.warn(
          `${MERGE_BACK_SPLITS_MIGRATION_NAME}: could not read where the sweep is from Valkey; it starts from the first exception, which merges nothing twice: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );

        return null;
      }
    },
    writeProgress: async (progress: SweepProgress): Promise<void> => {
      try {
        await GlobalCache.setString(
          SWEEP_PROGRESS_NAMESPACE,
          MERGE_BACK_SPLITS_MIGRATION_NAME,
          writeSweepProgress(progress),
          { expiresInSeconds: SWEEP_PROGRESS_TTL_SECONDS },
        );
      } catch (err) {
        logger.warn(
          `${MERGE_BACK_SPLITS_MIGRATION_NAME}: could not keep where the sweep is in Valkey; a run cut short starts again from the first exception: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
    readMigratedAt: (): Promise<Date | null> => {
      return PresentedKeysAtRest.getExecutedAt(
        DataMigrationService.getRepository().manager,
        MERGE_BACK_SPLITS_MIGRATION_NAME,
      );
    },
    isSwept: async (): Promise<boolean> => {
      return Boolean(
        await PresentedKeysAtRest.getExecutedAt(
          DataMigrationService.getRepository().manager,
          SWEPT_MARKER_NAME,
        ),
      );
    },
    recordSwept: async (at: Date): Promise<void> => {
      // Two runs at once record it once, or twice, which reads the same.
      if (
        await PresentedKeysAtRest.getExecutedAt(
          DataMigrationService.getRepository().manager,
          SWEPT_MARKER_NAME,
        )
      ) {
        return;
      }

      const marker: DataMigration = new DataMigration();
      marker.name = SWEPT_MARKER_NAME;
      marker.executed = true;
      marker.executedAt = at;

      await DataMigrationService.create({
        data: marker,
        props: {
          isRoot: true,
        },
      });
    },
  };
}

// Where the sweep is, as Valkey keeps it; null for anything else.
export function readSweepProgress(value: string | null): SweepProgress | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const cutoff: Date = new Date(String((parsed as JSONObject)["cutoff"]));
    const after: string = String((parsed as JSONObject)["after"] || "");

    if (Number.isNaN(cutoff.getTime()) || !ObjectID.isValidUUID(after)) {
      return null;
    }

    return { cutoff, after: after.toLowerCase() };
  } catch {
    return null;
  }
}

export function writeSweepProgress(progress: SweepProgress): string {
  return JSON.stringify({
    cutoff: progress.cutoff.toISOString(),
    after: progress.after,
  });
}

/*
 * The texts of an exception's earliest and latest occurrences ClickHouse
 * still keeps - OCCURRENCES_READ of each, originals only (a crash another
 * reporter repeated is counted nowhere, #9923) - between `from` and `to`.
 * Each read is bounded by the table's order (project, time), the
 * fingerprint's skip index, the limit and OCCURRENCE_READ_TIME_LIMIT_SECONDS.
 */
export async function readOccurrenceTextsFromClickhouse(data: {
  projectId: string;
  primaryEntityId: string;
  fingerprint: string;
  from: Date;
  to: Date;
  limit: number;
}): Promise<Array<ExceptionGroupingContent>> {
  const texts: Array<ExceptionGroupingContent> = [];

  for (const order of ["ASC", "DESC"]) {
    const statement: Statement = SQL`SELECT message, stackTrace, exceptionType FROM ${AnalyticsTableName.ExceptionInstance} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: new ObjectID(data.projectId),
    }} AND primaryEntityId = ${{
      type: TableColumnType.ObjectID,
      value: new ObjectID(data.primaryEntityId),
    }} AND fingerprint = ${{
      type: TableColumnType.Text,
      value: data.fingerprint,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.from,
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: data.to,
    }} AND retentionDate >= now()`;

    statement.append(` AND ${EXCEPTION_ORIGINALS_SQL}`);
    // A word of this file's, never data.
    statement.append(` ORDER BY time ${order}`);
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limit)),
      }}`,
    );

    const result: Results = await ExceptionInstanceService.executeQuery(
      statement,
      {
        clickhouseSettings: {
          max_execution_time: OCCURRENCE_READ_TIME_LIMIT_SECONDS,
        },
      },
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = (response.data ||
      []) as unknown as Array<JSONObject>;

    for (const row of rows) {
      texts.push(
        storedTextOf({
          message: (row["message"] as string) || null,
          stackTrace: (row["stackTrace"] as string) || null,
          exceptionType: (row["exceptionType"] as string) || null,
        }),
      );
    }
  }

  return texts;
}

export default class MergeBackExceptionsSplitByFailedLookups extends DataMigrationBase {
  private readonly environment: MergeBackSplitsEnvironment;

  public lastResult: MergeBackSplitsResult | null = null;

  public constructor(
    environment?: Partial<MergeBackSplitsEnvironment> | undefined,
  ) {
    super(MERGE_BACK_SPLITS_MIGRATION_NAME);

    this.environment = {
      ...getDefaultMergeBackSplitsEnvironment(),
      ...(environment || {}),
    };
  }

  /*
   * At the upgrade: as much of the sweep as MIGRATION_TIME_BUDGET_MS holds.
   * Never fails the chain of migrations - a read that fails is the job's to
   * try again, from where this stopped.
   */
  public override async migrate(): Promise<void> {
    try {
      await this.sweep({ timeBudgetMs: MIGRATION_TIME_BUDGET_MS });
    } catch (err) {
      logger.error(
        `${this.name}: the sweep stopped, and ${MERGE_BACK_SPLITS_JOB_NAME} goes on from where it did: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    // A merge is undone by Unmerge, one exception at a time, as any merge.
    return;
  }

  /*
   * The job's run: nothing before the upgrade's run of this migration, so
   * the two do not read the same pages at once, and nothing once every
   * exception has been read.
   */
  public async continueSweep(options: {
    deadline?: JobDeadline | undefined;
    timeBudgetMs?: number | undefined;
  }): Promise<MergeBackSplitsResult> {
    if (await this.environment.isSwept()) {
      const result: MergeBackSplitsResult = {
        ...emptyResult(),
        isDone: true,
        wasSweptBefore: true,
      };

      this.lastResult = result;

      return result;
    }

    if (!(await this.environment.readMigratedAt())) {
      const result: MergeBackSplitsResult = {
        ...emptyResult(),
        isWaitingForUpgrade: true,
      };

      this.lastResult = result;

      return result;
    }

    return this.sweep(options);
  }

  /*
   * Reads on from where the sweep is, a page at a time, until every
   * exception is read or the time is up, and merges back each duplicate it
   * can prove. Throws when a read of Postgres fails: where it is is kept,
   * page by page, for the next run.
   */
  public async sweep(options: {
    deadline?: JobDeadline | undefined;
    timeBudgetMs?: number | undefined;
  }): Promise<MergeBackSplitsResult> {
    const environment: MergeBackSplitsEnvironment = this.environment;
    const result: MergeBackSplitsResult = emptyResult();

    this.lastResult = result;

    if (await environment.isSwept()) {
      result.isDone = true;
      result.wasSweptBefore = true;

      return result;
    }

    const startedAt: Date = environment.now();
    const stopsAt: number | null =
      options.timeBudgetMs !== undefined
        ? startedAt.getTime() + options.timeBudgetMs
        : null;

    const progress: SweepProgress | null = await environment.readProgress();
    const cutoff: Date = progress?.cutoff || startedAt;
    let after: string = progress?.after || FIRST_ID;

    if (!progress) {
      await environment.writeProgress({ cutoff, after });
    }

    try {
      for (;;) {
        if (
          options.deadline?.hasPassed() ||
          (stopsAt !== null && environment.now().getTime() >= stopsAt)
        ) {
          break;
        }

        const page: Array<SweptException> = await environment.readPage({
          after,
          since: GROUPING_V2_SINCE,
          cutoff,
          limit: environment.pageSize,
          maxTextBytes: MAX_TEXT_BYTES,
        });

        if (page.length === 0) {
          result.isDone = true;
          break;
        }

        const lastId: string = String(page[page.length - 1]!.id).toLowerCase();

        // A page that does not move on would be read for ever.
        if (!lastId || lastId <= after) {
          throw new Error(
            `${this.name}: a page of exceptions did not move on past ${after}.`,
          );
        }

        await this.mergeBackPage(page, result);

        after = lastId;
        result.pages++;

        await environment.writeProgress({ cutoff, after });

        if (page.length < environment.pageSize) {
          result.isDone = true;
          break;
        }
      }

      if (result.isDone) {
        await environment.recordSwept(environment.now());
      }
    } finally {
      this.logResult(result);
    }

    return result;
  }

  // The duplicates of one page, each merged back once it is proven.
  private async mergeBackPage(
    page: Array<SweptException>,
    result: MergeBackSplitsResult,
  ): Promise<void> {
    const candidates: Array<{
      exception: SweptException;
      occurrence: GroupFingerprintCandidate;
    }> = [];

    for (const exception of page) {
      result.read++;

      if (isTooLongToRead(exception)) {
        result.tooLongToRead++;
        continue;
      }

      const occurrence: GroupFingerprintCandidate | null = occurrenceOfText({
        projectId: exception.projectId,
        primaryEntityId: exception.primaryEntityId,
        fingerprint: exception.fingerprint,
        text: storedTextOf(exception),
      });

      if (!occurrence) {
        result.notOfTheirOwnText++;
        continue;
      }

      candidates.push({ exception, occurrence });
    }

    if (candidates.length === 0) {
      return;
    }

    // Which of their fingerprints an exception exists under, per project.
    const fingerprintsOf: Map<string, Set<string>> = new Map();

    for (const candidate of candidates) {
      const fingerprints: Set<string> =
        fingerprintsOf.get(candidate.occurrence.projectId) || new Set<string>();

      for (const fingerprint of candidate.occurrence.candidates || []) {
        fingerprints.add(fingerprint);
      }

      fingerprintsOf.set(candidate.occurrence.projectId, fingerprints);
    }

    const known: Map<string, KnownGroup> = new Map();

    for (const [projectId, fingerprints] of fingerprintsOf) {
      await this.lookUp(known, projectId, Array.from(fingerprints));
    }

    for (const candidate of candidates) {
      const pair: ExceptionSplitByFailedLookup | null =
        ExceptionUtil.splitByFailedLookupOf({
          candidate: candidate.occurrence,
          found: candidate.occurrence.v1,
          known,
        });

      if (!pair) {
        result.notADuplicate++;
        continue;
      }

      const verdict: OccurrenceVerdict = await this.occurrencesAgree({
        exception: candidate.exception,
        pair,
        known,
      });

      if (verdict === OccurrenceVerdict.Unread) {
        result.occurrencesUnread++;
        continue;
      }

      if (verdict === OccurrenceVerdict.Disagree) {
        result.occurrencesDisagree++;
        continue;
      }

      const outcome: ExceptionSplitHealOutcome =
        await this.environment.heal(pair);

      switch (outcome) {
        case ExceptionSplitHealOutcome.Merged:
          result.merged++;
          break;
        case ExceptionSplitHealOutcome.AlreadyMerged:
          result.alreadyMerged++;
          break;
        case ExceptionSplitHealOutcome.NotADuplicate:
          result.notADuplicate++;
          break;
        case ExceptionSplitHealOutcome.LeftToAPerson:
          result.leftToAPerson++;
          break;
        case ExceptionSplitHealOutcome.NotFound:
          result.notFound++;
          break;
        default:
          result.mergeFailed++;
          logger.warn(
            `${this.name}: could not merge exception ${candidate.exception.id} of project ${candidate.exception.projectId} back into the exception a failed lookup split it from; it is left as it is, and Merge Exceptions can merge the two.`,
          );
      }
    }
  }

  // What the project's exceptions say of `fingerprints`, into `known`.
  private async lookUp(
    known: Map<string, KnownGroup>,
    projectId: string,
    fingerprints: Array<string>,
  ): Promise<void> {
    if (fingerprints.length === 0) {
      return;
    }

    const groups: Map<string, KnownGroup> =
      await this.environment.readKnownGroups(projectId, fingerprints);

    for (const fingerprint of fingerprints) {
      known.set(
        knownKey(projectId, fingerprint),
        groups.get(fingerprint) || { exists: false },
      );
    }
  }

  /*
   * Whether every occurrence of the duplicate ClickHouse still keeps leads
   * to the exception its stored text does. Each whose text is grouping
   * v1's of its fingerprint is an occurrence ingest's rule can be run for
   * again; one that leads to another exception, or to none, disagrees. One
   * whose text a rule changed proves nothing either way. None kept: the
   * stored text stands alone, as it is the latest of them.
   */
  private async occurrencesAgree(data: {
    exception: SweptException;
    pair: ExceptionSplitByFailedLookup;
    known: Map<string, KnownGroup>;
  }): Promise<OccurrenceVerdict> {
    const projectId: string = data.pair.projectId;
    const madeAt: number | null = timeOf(data.exception.createdAt);
    const firstSeenAt: number | null = timeOf(data.exception.firstSeenAt);
    const lastSeenAt: number | null = timeOf(data.exception.lastSeenAt);
    // From its first occurrence (or when it was made) to its last (or now).
    const from: number = Math.min(
      firstSeenAt ?? Number.POSITIVE_INFINITY,
      madeAt ?? Number.POSITIVE_INFINITY,
    );
    const to: number = Math.max(
      lastSeenAt ?? this.environment.now().getTime(),
      madeAt ?? 0,
    );

    let texts: Array<ExceptionGroupingContent>;

    try {
      texts = await this.environment.readOccurrenceTexts({
        projectId,
        primaryEntityId: data.pair.primaryEntityId,
        fingerprint: data.pair.duplicate,
        from: new Date(
          (Number.isFinite(from) ? from : to) - OCCURRENCE_WINDOW_SLACK_MS,
        ),
        to: new Date(to + OCCURRENCE_WINDOW_SLACK_MS),
        limit: OCCURRENCES_READ,
      });
    } catch (err) {
      logger.warn(
        `${this.name}: could not read the occurrences of exception ${data.exception.id} of project ${projectId}; it is left as it is: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      return OccurrenceVerdict.Unread;
    }

    const seen: Set<string> = new Set<string>();
    const occurrences: Array<GroupFingerprintCandidate> = [];

    for (const text of texts) {
      const key: string = JSON.stringify([
        text.message,
        text.stackTrace,
        text.exceptionType,
      ]);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const occurrence: GroupFingerprintCandidate | null = occurrenceOfText({
        projectId,
        primaryEntityId: data.pair.primaryEntityId,
        fingerprint: data.pair.duplicate,
        text,
      });

      if (occurrence) {
        occurrences.push(occurrence);
      }
    }

    const unread: Set<string> = new Set<string>();

    for (const occurrence of occurrences) {
      for (const fingerprint of occurrence.candidates || []) {
        if (!data.known.has(knownKey(projectId, fingerprint))) {
          unread.add(fingerprint);
        }
      }
    }

    await this.lookUp(data.known, projectId, Array.from(unread));

    const original: string = exceptionUnder(
      data.known,
      projectId,
      data.pair.original,
    );

    for (const occurrence of occurrences) {
      const pair: ExceptionSplitByFailedLookup | null =
        ExceptionUtil.splitByFailedLookupOf({
          candidate: occurrence,
          found: data.pair.duplicate,
          known: data.known,
        });

      if (
        !pair ||
        exceptionUnder(data.known, projectId, pair.original) !== original
      ) {
        return OccurrenceVerdict.Disagree;
      }
    }

    return OccurrenceVerdict.Agree;
  }

  private logResult(result: MergeBackSplitsResult): void {
    const left: number =
      result.tooLongToRead +
      result.notOfTheirOwnText +
      result.notADuplicate +
      result.occurrencesDisagree +
      result.occurrencesUnread +
      result.leftToAPerson +
      result.notFound +
      result.mergeFailed;

    logger.info(
      `${this.name}: read ${result.read} exception(s) made since grouping v2 in ${result.pages} page(s); merged ${result.merged} duplicate(s) a failed lookup made before #11027 back into the exception each was split from (${result.alreadyMerged} merged already); left ${left} as they are (${result.notOfTheirOwnText} not grouped by their own text, ${result.notADuplicate} not a duplicate, ${result.occurrencesDisagree} whose occurrences disagree, ${result.occurrencesUnread} whose occurrences could not be read, ${result.tooLongToRead} too long to read, ${result.leftToAPerson} left to a person, ${result.notFound} gone, ${result.mergeFailed} whose merge failed). ${
        result.isDone
          ? "Every exception has been read."
          : `${MERGE_BACK_SPLITS_JOB_NAME} reads the rest.`
      }`,
    );
  }
}
