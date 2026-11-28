import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService, {
  TelemetryExceptionActivityEntry,
} from "Common/Server/Services/TelemetryExceptionActivityService";
import { TelemetryExceptionActivityType } from "Common/Models/DatabaseModels/TelemetryExceptionActivity";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { fingerprintSha256 } from "./FingerprintHash";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import logger from "Common/Server/Utils/Logger";
import { normalizeExceptionText } from "Common/Server/Utils/Telemetry/ExceptionSanitizer";
import {
  ExceptionGroupingKey,
  getExceptionGroupingKey,
  getExceptionGroupingKeyV3,
  getExceptionGroupingKeyV4,
  getExceptionGroupingText,
  isChangedOnlyWhereFolded,
} from "Common/Server/Utils/Telemetry/ExceptionGrouping";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import TelemetryExceptionRekey, {
  ExceptionRekeyResult,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionRekey";
import TelemetryExceptionSplitHeal, {
  ExceptionSplitHealOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionSplitHeal";
import { JSONObject } from "Common/Types/JSON";
import { writeOwnValue } from "Common/Utils/LookupTable";
import HeldExceptionOccurrences, {
  HELD_OCCURRENCE_RETRY_MS,
} from "./HeldExceptionOccurrences";

export interface ExceptionFingerprintInput {
  message?: string;
  stackTrace?: string;
  exceptionType?: string;
  projectId?: ObjectID;
  primaryEntityId?: ObjectID;
}

/*
 * What an exception said - its message, stack trace and type - as its
 * fingerprints read it.
 */
export interface ExceptionGroupingContent {
  message: string;
  stackTrace: string;
  exceptionType: string;
}

/*
 * An occurrence's fingerprints until the batch it is in is stored
 * (resolveGroupFingerprints), as getOccurrenceFingerprints makes them:
 *
 *  - `fingerprintCandidates`: those of the exceptions it may already belong
 *    to, tried in order;
 *  - `fingerprintV2`: the one a new exception is made under when none of
 *    them exists;
 *  - `fingerprint`: grouping v1's, unless v1 hashes what a scrub rule hid -
 *    then the one a new exception is made under. Until #11027 an
 *    occurrence was filed under it when the project's exceptions could not
 *    be read, which is how a duplicate under v1 is told apart now
 *    (TelemetryExceptionSplitHeal);
 *  - `fingerprintRekeys`, when a scrub rule changed it: each candidate that
 *    is an unkeyed hash of text the rule hid part of, with the private
 *    (keyed) fingerprint of the same text, which an exception found under
 *    it is moved to (#10619);
 *  - `fingerprintsOfStoredText`, for an exception found in a log that a rule
 *    changed: the candidates made from the text the rules left and not from
 *    what it said as it arrived. An exception found under one of them is
 *    one a rule split from another before #10434 (#10618).
 */
export interface OccurrenceFingerprints {
  fingerprint: string;
  fingerprintV2: string;
  fingerprintCandidates: Array<string>;
  fingerprintRekeys?: Record<string, string> | undefined;
  fingerprintsOfStoredText?: Array<string> | undefined;
}

export interface TelemetryExceptionPayload {
  /*
   * The exception's group. Built as OccurrenceFingerprints' `fingerprint`,
   * with the one a new exception is made under and the candidates beside
   * it, until assignPayloadGroupFingerprints picks which one the occurrence
   * belongs to.
   */
  fingerprint: string;
  fingerprintV2?: string | undefined;
  fingerprintCandidates?: Array<string> | undefined;
  fingerprintRekeys?: Record<string, string> | undefined;
  fingerprintsOfStoredText?: Array<string> | undefined;
  projectId: ObjectID;
  primaryEntityId: ObjectID;
  primaryEntityType?: ServiceType;
  exceptionType?: string;
  stackTrace?: string;
  message?: string;
  release?: string; // current release from the incoming event
  environment?: string;
  /*
   * OTel exception.escaped semantics: true when the exception escaped
   * the span scope (i.e. was unhandled). Rolled up onto the group row
   * as a sticky OR — once a group has seen one unhandled occurrence it
   * stays flagged unhandled.
   */
  unhandled?: boolean;
  /*
   * When the occurrence happened: the span event's or the log record's own
   * time. The group's first and last seen are made of these, so telemetry
   * that reaches a worker late (a backed-up queue, a retried batch) neither
   * moves them forward nor reopens an exception resolved after it happened.
   * Left out, or outside what clampOccurrenceTime accepts, the time the
   * worker reads it stands in.
   */
  occurredAt?: Date | undefined;
  /*
   * How many occurrences it stands for; one when left out. The occurrences
   * of one exception held while its exceptions could not be read are kept
   * as two, the latest counting those between (HeldExceptionOccurrences,
   * #11027).
   */
  occurrences?: number | undefined;
}

/*
 * What is known of a fingerprint an occurrence may belong to: whether an
 * exception exists under it, and, when the row under it only keeps the
 * former fingerprint of an exception OneUptime moved to a private one
 * (#10619), that exception's fingerprint now, where its occurrences go. And,
 * as the read gives them, when the exception was made and what it is merged
 * into: how a duplicate a failed lookup made is told apart (#11027).
 */
export interface KnownGroup {
  exists: boolean;
  movedTo?: string | undefined;
  // When the exception was made, in ms: the moved one's, for a former fingerprint.
  createdAt?: number | undefined;
  // The exception it is merged into, by id.
  mergedInto?: string | undefined;
}

// What a cached or read group says, without when it was cached.
function knownGroupOf(group: KnownGroup): KnownGroup {
  return {
    exists: group.exists,
    ...(group.movedTo ? { movedTo: group.movedTo } : {}),
    ...(group.createdAt !== undefined ? { createdAt: group.createdAt } : {}),
    ...(group.mergedInto ? { mergedInto: group.mergedInto } : {}),
  };
}

/*
 * What is known of each fingerprint, by project and fingerprint, for a few
 * minutes: the same few exceptions make most of every batch, and an
 * existing exception never stops existing under its fingerprint - one moved
 * to a private fingerprint leaves its old one behind as a row of its own.
 * One a batch makes is known to exist from then on. Capped, and cleared
 * whole when full.
 */
const EXISTING_GROUP_CACHE_TTL_MS: number = 10 * 60 * 1000;
export const EXISTING_GROUP_CACHE_MAX_ENTRIES: number = 100000;
const existingGroupCache: Map<string, KnownGroup & { at: number }> = new Map();

/*
 * The moves to a private fingerprint that were refused (the fingerprint
 * taken by another exception) or failed, by project, resource and old
 * fingerprint, with when: not tried again for a while, so a batch does not
 * open a transaction for each of its occurrences of an exception that
 * cannot move now.
 */
const refusedMoves: Map<string, number> = new Map();
const MAX_REFUSED_MOVES: number = 10000;

/*
 * What became of each duplicate a failed lookup made that this process
 * found (#11027, TelemetryExceptionSplitHeal), by project, duplicate and the
 * exception it was split from, with when: merged, or left as it is for a
 * reason that holds - not tried again for SPLIT_HEAL_DECISION_TTL_MS. A
 * merge that failed is tried again after EXISTING_GROUP_CACHE_TTL_MS.
 */
const splitHealDecisions: Map<string, { at: number; failed: boolean }> =
  new Map();
const SPLIT_HEAL_DECISION_TTL_MS: number = 60 * 60 * 1000;
const MAX_SPLIT_HEAL_DECISIONS: number = 10000;

// The timer that tries the held occurrences again when no batch comes.
let heldRetryTimer: ReturnType<typeof setTimeout> | null = null;

/*
 * Forgets which exceptions exist under which fingerprints, and the
 * occurrences held while they could not be read (tests).
 */
export function clearExistingV1FingerprintCache(): void {
  existingGroupCache.clear();
  refusedMoves.clear();
  recordedSplits.clear();
  splitHealDecisions.clear();
  HeldExceptionOccurrences.clear();

  if (heldRetryTimer) {
    clearTimeout(heldRetryTimer);
    heldRetryTimer = null;
  }
}

// Remembers what is known of a fingerprint, within the cap.
function rememberGroup(cacheKey: string, group: KnownGroup, at: number): void {
  if (
    existingGroupCache.size >= EXISTING_GROUP_CACHE_MAX_ENTRIES &&
    !existingGroupCache.has(cacheKey)
  ) {
    existingGroupCache.clear();
  }

  existingGroupCache.set(cacheKey, { ...group, at: at });
}

// Remembers that an exception exists under a fingerprint, within the cap.
function rememberGroupMade(cacheKey: string, at: number): void {
  rememberGroup(cacheKey, { exists: true }, at);
}

/*
 * The pairs of exceptions a rule split this process recorded already
 * (recordSplitPair), by project, split exception and the one it was split
 * from: each is recorded once, and the statement keeps a second process from
 * changing what the first wrote. Capped, and cleared whole when full.
 */
const recordedSplits: Set<string> = new Set<string>();
const MAX_RECORDED_SPLITS: number = 10000;

/*
 * Records that a scrub rule split the exception under $3 from the one under
 * $4, in project $1 and resource $2, on the split one (#10618): once, never
 * over a pair recorded before, and never for a row that only keeps a former
 * fingerprint.
 */
export const RECORD_SPLIT_PAIR_SQL: string = `UPDATE "TelemetryException" AS s SET "splitFromTelemetryExceptionId" = u."_id", "updatedAt" = now() FROM "TelemetryException" AS u WHERE s."projectId" = $1 AND s."primaryEntityId" = $2 AND s."fingerprint" = $3 AND s."deletedAt" IS NULL AND s."splitFromTelemetryExceptionId" IS NULL AND s."formerFingerprintOfTelemetryExceptionId" IS NULL AND u."projectId" = $1 AND u."primaryEntityId" = $2 AND u."fingerprint" = $4 AND u."deletedAt" IS NULL AND u."formerFingerprintOfTelemetryExceptionId" IS NULL AND u."_id" <> s."_id"`;

/*
 * The lookup of which fingerprints a batch tries an exception exists under,
 * one project's, in one indexed read: each with the fingerprint of the
 * exception a row keeps it for, when the row only keeps an exception's
 * former fingerprint (#10619); when the exception was made (the moved
 * one's, for a former fingerprint); and what the row is merged into. The
 * last two tell a duplicate a failed lookup made apart (#11027).
 */
export const GROUP_FINGERPRINT_LOOKUP_SQL: string = `SELECT t."fingerprint" AS "fingerprint", o."fingerprint" AS "movedTo", COALESCE(o."createdAt", t."createdAt") AS "createdAt", t."mergedIntoTelemetryExceptionId"::text AS "mergedInto" FROM "TelemetryException" t LEFT JOIN "TelemetryException" o ON o."_id" = t."formerFingerprintOfTelemetryExceptionId" AND o."deletedAt" IS NULL WHERE t."projectId" = $1 AND t."fingerprint" = ANY($2::text[]) AND t."deletedAt" IS NULL`;

/*
 * WHEN THE LOOKUP FAILS, IT IS READ AGAIN (#11027).
 *
 * A connection reset, or a statement cancelled under load, passes: the read
 * is tried again after each of these pauses - but not once the pause would
 * end GROUP_FINGERPRINT_LOOKUP_RETRY_BUDGET_MS after the first try, so a
 * read that ran out the statement timeout (30 seconds) is not tried again,
 * and the batch goes on without it.
 */
export const GROUP_FINGERPRINT_LOOKUP_RETRY_DELAYS_MS: ReadonlyArray<number> = [
  200, 1000,
];
export const GROUP_FINGERPRINT_LOOKUP_RETRY_BUDGET_MS: number = 5000;

// One row of GROUP_FINGERPRINT_LOOKUP_SQL.
export interface GroupLookupRow {
  fingerprint: string;
  movedTo?: string | null;
  createdAt?: Date | string | null;
  mergedInto?: string | null;
}

/*
 * What the rows of GROUP_FINGERPRINT_LOOKUP_SQL say of each fingerprint
 * they name, by fingerprint: an exception exists under it, where it moved,
 * when it was made (in ms) and what it is merged into. A fingerprint no row
 * names is not in the map. The ingest's lookup reads them so
 * (readKnownGroups), and so does the sweep that merges back the duplicates
 * a failed lookup made before #11027 (MergeBackExceptionsSplitByFailedLookups,
 * #11113), which must tell a duplicate apart exactly as an occurrence does.
 */
export function knownGroupsOfLookupRows(
  rows: ReadonlyArray<GroupLookupRow> | null | undefined,
): Map<string, KnownGroup> {
  const existing: Map<string, KnownGroup> = new Map();

  for (const row of rows || []) {
    const createdAt: number = row.createdAt
      ? new Date(row.createdAt).getTime()
      : NaN;

    existing.set(row.fingerprint, {
      exists: true,
      ...(row.movedTo ? { movedTo: row.movedTo } : {}),
      ...(Number.isFinite(createdAt) ? { createdAt } : {}),
      ...(row.mergedInto ? { mergedInto: row.mergedInto } : {}),
    });
  }

  return existing;
}

/*
 * The candidates resolveGroups answered (`chosen`, by groupFingerprintKey),
 * and those whose exception could not be known (`unknown`): its project's
 * exceptions could not be read, and nothing this process knew settles it.
 */
export interface ResolvedGroups {
  chosen: Map<string, string>;
  unknown: Map<string, GroupFingerprintCandidate>;
}

/*
 * A duplicate a failed lookup made (#11027): the fingerprint it was made
 * under, the occurrence's v1, and the one the exception it was split from
 * is found under, in its project and resource.
 */
export interface ExceptionSplitByFailedLookup {
  projectId: string;
  primaryEntityId: string;
  duplicate: string;
  original: string;
}

// Whether moving this exception was refused a short while ago.
function isMoveRefused(moveKey: string, now: number): boolean {
  const at: number | undefined = refusedMoves.get(moveKey);

  return at !== undefined && now - at < EXISTING_GROUP_CACHE_TTL_MS;
}

/*
 * A pair of exceptions a scrub rule split before #10434, in one project and
 * resource: the split one's fingerprint and that of the one it was split
 * from (#10618).
 */
export interface ExceptionSplitPair {
  projectId: string;
  primaryEntityId: string;
  splitFingerprint: string;
  splitFromFingerprint: string;
}

/*
 * An exception to move to a private fingerprint: the one it is found under,
 * in its project and resource, and the one it moves to (#10619).
 */
export interface ExceptionMove {
  projectId: string;
  primaryEntityId: string;
  from: string;
  to: string;
}

// An exception the upsert reopened, as its statement hands it back.
export interface RegressedExceptionRow {
  id: string;
  projectId: string;
  lastSeenInRelease: string | null;
}

// One occurrence's fingerprints, wherever they are carried.
export interface GroupFingerprintCandidate {
  projectId: string;
  // Kept when the project's exceptions cannot be read (its `fingerprint`).
  v1: string;
  // A new exception is made under it (its `fingerprintV2`).
  v2: string;
  /*
   * The exceptions it may already belong to, tried in order (its
   * `fingerprintCandidates`). Left out, [v1]: an exception made before
   * grouping v2 keeps its first fingerprint.
   */
  candidates?: Array<string> | undefined;
  // The resource it was reported by: an exception is one of its resource's.
  primaryEntityId?: string | undefined;
  /*
   * Each candidate that is an unkeyed hash of text a scrub rule hid part of,
   * with the private fingerprint an exception found under it moves to (its
   * `fingerprintRekeys`, #10619).
   */
  rekeys?: Record<string, string> | undefined;
  /*
   * Those of its candidates made from the text the scrub rules left only
   * (its `fingerprintsOfStoredText`, #10618).
   */
  storedOnly?: Array<string> | undefined;
}

/*
 * The key resolveGroupFingerprints answers a candidate under: its project,
 * its two fingerprints and, when it has them, its candidates and the
 * private fingerprints they move to.
 */
export function groupFingerprintKey(
  candidate: GroupFingerprintCandidate,
): string {
  let key: string = `${candidate.projectId}|${candidate.v1}|${candidate.v2}`;

  if (candidate.candidates) {
    key = `${key}|${candidate.candidates.join("|")}`;
  }

  if (candidate.rekeys) {
    key = `${key}|${Object.keys(candidate.rekeys)
      .sort()
      .map((fingerprint: string): string => {
        return `${fingerprint}>${candidate.rekeys![fingerprint]}`;
      })
      .join("|")}`;
  }

  if (candidate.storedOnly) {
    key = `${key}|stored:${candidate.storedOnly.join(",")}`;
  }

  return key;
}

// The fingerprints tried for a candidate, in order.
function fingerprintsToTry(
  candidate: GroupFingerprintCandidate,
): Array<string> {
  if (candidate.candidates) {
    return candidate.candidates;
  }

  return candidate.v2 === candidate.v1 ? [] : [candidate.v1];
}

// An occurrence's candidates as a row or a payload carries them: texts only.
function readCandidates(value: unknown): Array<string> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((fingerprint: unknown): fingerprint is string => {
    return typeof fingerprint === "string" && fingerprint.length > 0;
  });
}

/*
 * An occurrence's moves to a private fingerprint as a row or a payload
 * carries them: texts to texts only, none for nothing.
 */
function readRekeys(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const rekeys: Record<string, string> = {};

  for (const [from, to] of Object.entries(value as Record<string, unknown>)) {
    if (from && typeof to === "string" && to.length > 0 && to !== from) {
      writeOwnValue(rekeys, from, to);
    }
  }

  return Object.keys(rekeys).length > 0 ? rekeys : undefined;
}

/*
 * Per-batch parameter footprint: 14 columns x rows. Postgres caps a
 * single statement at 65535 placeholders, so 500 rows = 7000 params
 * gives us plenty of headroom while matching the chunk size used by
 * KubernetesResourceService.bulkUpsert (the precedent this batch
 * upsert is modelled on).
 */
const TELEMETRY_EXCEPTION_UPSERT_BATCH_SIZE: number = 500;

/*
 * How old an occurrence's own time may be and still be believed. A span
 * event without a time, or with a broken clock, arrives stamped at the epoch
 * or years out: taken at its word it would make the group's first seen 1970.
 * Telemetry older than this is not a late delivery but a bad timestamp, so
 * the time the worker reads it stands in, as it does for a time in the
 * future.
 */
export const MAX_OCCURRENCE_AGE_MS: number = 30 * 24 * 60 * 60 * 1000;

/*
 * Whether the existing row, resolved, is reopened by this batch. In the
 * conflict branch below "TelemetryException" is the row as it stands before
 * the update - Postgres reads every SET expression against the old row - and
 * EXCLUDED is the batch's aggregate for it:
 *
 *  - an occurrence after the row was resolved (EXCLUDED.lastSeenAt is the
 *    batch's latest occurrence time). One that happened before the resolve
 *    and reached ingest late is not the fix failing;
 *  - and, for an exception resolved in the next release, an occurrence from
 *    a release other than the one it was resolved after. The batch's
 *    release is its latest occurrence's (lastSeenInRelease), so pods still
 *    running the old release during a rollout do not reopen it, and the new
 *    release does. An occurrence that names no release cannot say which it
 *    came from, so it does not reopen it either.
 *
 * Exported for the tests that read the statement; it is spliced into the SQL
 * below, never built from data.
 */
export const REOPENS_RESOLVED_EXCEPTION_SQL: string = `(
            (
              "TelemetryException"."markedAsResolvedAt" IS NULL
              OR EXCLUDED."lastSeenAt" > "TelemetryException"."markedAsResolvedAt"
            )
            AND (
              COALESCE("TelemetryException"."resolvedInReleaseAfter", '') = ''
              OR (
                COALESCE(EXCLUDED."lastSeenInRelease", '') <> ''
                AND EXCLUDED."lastSeenInRelease" <> "TelemetryException"."resolvedInReleaseAfter"
              )
            )
          )`;

// The row was resolved and this batch leaves it so.
export const STAYS_RESOLVED_SQL: string = `("TelemetryException"."isResolved" AND NOT ${REOPENS_RESOLVED_EXCEPTION_SQL})`;

/*
 * When an occurrence happened, as the group's seen times are kept: its own
 * time when that is believable, otherwise `now` - see MAX_OCCURRENCE_AGE_MS.
 */
export function clampOccurrenceTime(
  occurredAt: Date | undefined,
  now: Date,
): Date {
  if (!occurredAt || !(occurredAt instanceof Date)) {
    return now;
  }

  const time: number = occurredAt.getTime();

  if (
    Number.isNaN(time) ||
    time > now.getTime() ||
    now.getTime() - time > MAX_OCCURRENCE_AGE_MS
  ) {
    return now;
  }

  return occurredAt;
}

export default class ExceptionUtil {
  /**
   * Normalizes a string by replacing dynamic values with placeholders.
   * This ensures that exceptions with the same root cause but different
   * dynamic values (like IDs, timestamps, etc.) get the same fingerprint.
   *
   * The implementation lives in
   * Common/Server/Utils/Telemetry/ExceptionSanitizer.ts so the AI agent
   * data API can reuse it; this delegate keeps every fingerprint call
   * site (and the fingerprints themselves) unchanged.
   *
   * @param text - The text to normalize (message or stack trace)
   * @returns The normalized text with dynamic values replaced
   */
  public static normalizeForFingerprint(text: string): string {
    return normalizeExceptionText(text);
  }

  /*
   * The grouping v2 fingerprint (Common/Server/Utils/Telemetry/
   * ExceptionGrouping): the type and the functions and modules of the
   * occurrence's own code, without line numbers or library frames. What a
   * new exception is grouped by; see assignGroupFingerprints.
   */
  public static getFingerprintV2(data: ExceptionFingerprintInput): string {
    return fingerprintSha256(ExceptionUtil.getGroupingTextV2(data));
  }

  // The text the grouping v2 fingerprint hashes.
  private static getGroupingTextV2(data: ExceptionFingerprintInput): string {
    return ExceptionUtil.getGroupingTexts(data).v2;
  }

  /*
   * The grouping v3 fingerprint (#10620): v2's, but for an exception grouped
   * by a message that holds a card number in groups, a Social Security
   * number or a phone number, which are taken out of it. The same as v2's
   * for an exception grouped by its frames.
   */
  public static getFingerprintV3(data: ExceptionFingerprintInput): string {
    return fingerprintSha256(ExceptionUtil.getGroupingTexts(data).v3);
  }

  /*
   * The grouping v4 fingerprint (#10898): v3's, but for an exception grouped
   * by a message that holds an international phone number, a 15-digit
   * American Express card or a 19-digit card, which are taken out of it too.
   * The same as v2's for an exception grouped by its frames.
   */
  public static getFingerprintV4(data: ExceptionFingerprintInput): string {
    return fingerprintSha256(ExceptionUtil.getGroupingTexts(data).v4);
  }

  /*
   * The texts the grouping v2, v3 and v4 fingerprints hash, from one reading
   * of the stack trace: v3's and v4's are v2's for an exception grouped by
   * its frames (ExceptionGrouping.getExceptionGroupingKeyV3 and V4).
   */
  public static getGroupingTexts(data: ExceptionFingerprintInput): {
    v2: string;
    v3: string;
    v4: string;
  } {
    const projectId: string = data.projectId?.toString() || "";
    const primaryEntityId: string = data.primaryEntityId?.toString() || "";
    const keyV2: ExceptionGroupingKey = getExceptionGroupingKey({
      exceptionType: data.exceptionType,
      message: data.message,
      stackTrace: data.stackTrace,
    });
    const keyV3: ExceptionGroupingKey = getExceptionGroupingKeyV3(keyV2);
    const keyV4: ExceptionGroupingKey = getExceptionGroupingKeyV4(keyV3);
    const v2: string = getExceptionGroupingText({
      projectId,
      primaryEntityId,
      key: keyV2,
    });
    const v3: string =
      keyV3 === keyV2
        ? v2
        : getExceptionGroupingText({
            projectId,
            primaryEntityId,
            key: keyV3,
          });

    return {
      v2,
      v3,
      v4:
        keyV4 === keyV3
          ? v3
          : getExceptionGroupingText({
              projectId,
              primaryEntityId,
              key: keyV4,
            }),
    };
  }

  /*
   * WHICH EXCEPTION AN OCCURRENCE BELONGS TO, WHATEVER A SCRUB RULE HID
   * (#10434).
   *
   * An occurrence is grouped by the exception as it arrived (`arrived`),
   * before the scrub rules, and never by what they left of it (`stored`,
   * what is stored and shown): a rule added later hides part of what an
   * exception says from then on, and an exception grouped by that became a
   * new one - with a new first seen, so New Exception fired again for an
   * old error, and its triage, history and counts stayed on the old one.
   *
   * When no rule changed it, its fingerprints are grouping v1's, v2's, v3's
   * and v4's: the exception made before v2 under the first, else the one
   * made under the second, and so on - or one made under the keyed
   * fingerprint of one of them, by a copy of it a rule did change (its log
   * record's, while no rule changed its span's; or one from before a rule
   * was removed). None existing, a new exception is made under v4's.
   *
   * When a rule changed it, the same are tried, so an exception that
   * existed before the rule keeps its occurrences. A new one is made under
   * v4's only if what the rule hid is not in the text v4 hashes - a stack
   * trace's frames leave the message out, and the normalizer folds an email
   * address or a Social Security number. Otherwise everyone who reads the
   * exception would read, in its fingerprint, an unkeyed hash of text a
   * rule hid, and whoever hashes every guess gets the value back: a card's
   * last digits, a Social Security number, which the normalizer leaves in.
   * It is made under a keyed fingerprint instead (KeyedExceptionFingerprint),
   * which no one without ENCRYPTION_SECRET can hash a guess to compare. And
   * when the exceptions cannot be read, the occurrence keeps v1's only if
   * what the rule hid is not in the text v1 hashes either.
   *
   * `findsGroupsOfStoredText`, for an exception found in a log: before
   * #10434 the logs ingest grouped one by the text the rules left, so a
   * rule split it from the exception it was into one of its own. Those are
   * tried first, so each keeps the occurrences it has had since: an upgrade
   * moves nothing. A person who wants the two as one merges them
   * (TelemetryExceptionMerge).
   *
   * Every copy of an exception tries the same fingerprints in the same
   * order, changed by a rule or not (resolveGroupFingerprints), so its log
   * record's copy and its span's share an exception whichever made it.
   *
   * AND AN EXCEPTION MADE BEFORE IS MOVED TO A PRIVATE FINGERPRINT (#10619).
   * An exception made before #10434 - a span's, or any made before the rule
   * existed - keeps the unkeyed fingerprint it was made under, which hashes
   * what the rule now hides. Each fingerprint that does, of v1's, v2's, v3's
   * and v4's, is named in `fingerprintRekeys` with the keyed fingerprint of the
   * same text: an exception the occurrence finds under it is moved there
   * (resolveGroupFingerprints, TelemetryExceptionRekey). The keyed one of
   * v1's text (KeyedExceptionFingerprint.ofFirstGroupingText) is tried
   * right after v1, where such an exception is found once moved.
   *
   * WHAT "HASHES WHAT A RULE HID" MEANS. The two texts a fingerprint can be
   * made from, as the exception arrived and as the rules left it, differ
   * wherever a rule hid something; but a value the normalizer folds never
   * reaches a fingerprint, the text holding <EMAIL> or <SSN> whatever the
   * value was. So a fingerprint gives something away only when the two
   * texts differ beyond those placeholders (isChangedOnlyWhereFolded): only
   * then is a new exception made under the keyed fingerprint, an existing
   * one moved, or v1 not kept when the exceptions cannot be read.
   *
   * AND V3 (#10620): v2, with the card numbers in groups, Social Security
   * and phone numbers a message holds taken out. v3 and its keyed
   * fingerprint are tried after v2's, so an exception made before keeps the
   * occurrences it had - each value it was made for - and the values seen
   * since go to one exception. For an exception grouped by its frames, v3's
   * fingerprints are v2's.
   *
   * AND NEW EXCEPTIONS ARE GROUPED BY V4 (#10898): v3, with international
   * phone numbers, 15-digit American Express cards and 19-digit cards taken
   * out too. Tried after v3's, the same way: every exception made before
   * keeps its fingerprint and its occurrences, none splits and none merges,
   * and the values seen since go to one exception. A new exception is made
   * under v4's, or its keyed one, and so is the fingerprint kept when the
   * exceptions cannot be read and v1 would give away what a rule hid: the
   * newest version's, tried after every older one, so an exception under any
   * of those is still found by the next occurrence. For an exception grouped
   * by its frames, v4's fingerprints are v2's.
   */
  public static getOccurrenceFingerprints(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    arrived: ExceptionGroupingContent;
    stored: ExceptionGroupingContent;
    findsGroupsOfStoredText?: boolean | undefined;
    /*
     * For an exception found in a log: what the rules left of it before
     * #11030, when that differs from what they leave now - a Phone Number
     * or SSN rule hid its own pattern's matches alone then
     * (withOwnPhoneAndSsnPatterns). See fingerprintsOfEarlierStoredText.
     */
    storedByEarlierRules?: ExceptionGroupingContent | undefined;
  }): OccurrenceFingerprints {
    const arrived: ExceptionFingerprintInput = {
      projectId: data.projectId,
      primaryEntityId: data.primaryEntityId,
      message: data.arrived.message,
      stackTrace: data.arrived.stackTrace,
      exceptionType: data.arrived.exceptionType,
    };
    const v1Text: string = ExceptionUtil.getGroupingTextV1(arrived);
    const v1: string = fingerprintSha256(v1Text);
    const keyedV1: string = KeyedExceptionFingerprint.ofFirstGroupingText({
      projectId: data.projectId,
      text: v1Text,
    });
    const texts: { v2: string; v3: string; v4: string } =
      ExceptionUtil.getGroupingTexts(arrived);
    const v2: string = fingerprintSha256(texts.v2);
    const keyedV2: string = KeyedExceptionFingerprint.ofGroupingText({
      projectId: data.projectId,
      text: texts.v2,
    });
    const v3: string = texts.v3 === texts.v2 ? v2 : fingerprintSha256(texts.v3);
    const keyedV3: string =
      texts.v3 === texts.v2
        ? keyedV2
        : KeyedExceptionFingerprint.ofGroupingText({
            projectId: data.projectId,
            text: texts.v3,
          });
    const v4: string = texts.v4 === texts.v3 ? v3 : fingerprintSha256(texts.v4);
    const keyedV4: string =
      texts.v4 === texts.v3
        ? keyedV3
        : KeyedExceptionFingerprint.ofGroupingText({
            projectId: data.projectId,
            text: texts.v4,
          });

    // The exceptions made as each version was the newest, tried oldest first.
    const ofArrived: Array<string> = [
      v1,
      keyedV1,
      v2,
      keyedV2,
      v3,
      keyedV3,
      v4,
      keyedV4,
    ];

    if (
      (data.arrived.message || "") === (data.stored.message || "") &&
      (data.arrived.stackTrace || "") === (data.stored.stackTrace || "") &&
      (data.arrived.exceptionType || "") === (data.stored.exceptionType || "")
    ) {
      return {
        fingerprint: v1,
        fingerprintV2: v4,
        fingerprintCandidates: Array.from(new Set<string>(ofArrived)),
      };
    }

    const stored: ExceptionFingerprintInput = {
      projectId: data.projectId,
      primaryEntityId: data.primaryEntityId,
      message: data.stored.message,
      stackTrace: data.stored.stackTrace,
      exceptionType: data.stored.exceptionType,
    };
    const storedV1Text: string = ExceptionUtil.getGroupingTextV1(stored);
    const storedTexts: { v2: string; v3: string; v4: string } =
      ExceptionUtil.getGroupingTexts(stored);

    // Whether each fingerprint hashes what the rule hid (see above).
    const revealsV1: boolean = !isChangedOnlyWhereFolded(v1Text, storedV1Text);
    const revealsV2: boolean = !isChangedOnlyWhereFolded(
      texts.v2,
      storedTexts.v2,
    );
    const revealsV3: boolean = !isChangedOnlyWhereFolded(
      texts.v3,
      storedTexts.v3,
    );
    const revealsV4: boolean = !isChangedOnlyWhereFolded(
      texts.v4,
      storedTexts.v4,
    );

    // A new exception is made under v4, or its keyed fingerprint.
    const opens: string = revealsV4 ? keyedV4 : v4;

    const rekeys: Record<string, string> = {};

    if (revealsV1) {
      rekeys[v1] = keyedV1;
    }

    if (revealsV2) {
      rekeys[v2] = keyedV2;
    }

    if (revealsV3 && v3 !== v2) {
      rekeys[v3] = keyedV3;
    }

    if (revealsV4 && v4 !== v3) {
      rekeys[v4] = keyedV4;
    }

    // What a log was grouped by before #10434: the text the rules left.
    const ofStored: Array<string> = data.findsGroupsOfStoredText
      ? [
          fingerprintSha256(storedV1Text),
          fingerprintSha256(storedTexts.v2),
          ...ExceptionUtil.fingerprintsOfEarlierStoredText({
            projectId: data.projectId,
            primaryEntityId: data.primaryEntityId,
            earlier: data.storedByEarlierRules,
            storedV1Text,
            storedV2Text: storedTexts.v2,
            rekeys,
          }).filter((fingerprint: string): boolean => {
            // One of what it arrived as is tried in its own place.
            return !ofArrived.includes(fingerprint);
          }),
        ]
      : [];
    const storedOnly: Array<string> = Array.from(
      new Set<string>(
        ofStored.filter((fingerprint: string): boolean => {
          return !ofArrived.includes(fingerprint);
        }),
      ),
    );

    return {
      fingerprint: revealsV1 ? opens : v1,
      fingerprintV2: opens,
      fingerprintCandidates: Array.from(
        new Set<string>([...ofStored, ...ofArrived]),
      ),
      ...(Object.keys(rekeys).length > 0 ? { fingerprintRekeys: rekeys } : {}),
      ...(storedOnly.length > 0
        ? { fingerprintsOfStoredText: storedOnly }
        : {}),
    };
  }

  /*
   * WHAT A LOG'S EXCEPTION WAS FOUND BY BEFORE #11030.
   *
   * Before #10434 an exception found in a log was grouped by the text the
   * rules left of it, and it is still found by that (findsGroupsOfStoredText).
   * #11030 widened what a Phone Number or SSN rule hides - an international
   * number, a Social Security number set apart by dots, one in another
   * script's digits - so what the rules leave now need not be what they left
   * then, and such an exception would not be found: its next occurrence
   * would make a new one, and New Exception fire again. So an occurrence
   * also tries the fingerprints of the text the rules left before #11030
   * (`earlier`), after those of what they leave now.
   *
   * Each hashes what the rules hide now - the number they hide since -
   * unless the two texts differ only where the normalizer folds: an
   * exception found under it is moved to the keyed fingerprint of the same
   * text, as #10619 moves one, its old one kept merged into it (`rekeys`,
   * filled here). That keyed one is tried right after it, so once the old
   * one is retired, no occurrence carrying it any more, the exception is
   * still found. Nothing visibly splits, and nothing fires.
   *
   * None when there is no earlier text, or it is what the rules leave now.
   */
  public static fingerprintsOfEarlierStoredText(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    earlier: ExceptionGroupingContent | undefined;
    // What the rules leave now, as grouping v1 and v2 read it.
    storedV1Text: string;
    storedV2Text: string;
    rekeys: Record<string, string>;
  }): Array<string> {
    if (!data.earlier) {
      return [];
    }

    const earlier: ExceptionFingerprintInput = {
      projectId: data.projectId,
      primaryEntityId: data.primaryEntityId,
      message: data.earlier.message,
      stackTrace: data.earlier.stackTrace,
      exceptionType: data.earlier.exceptionType,
    };
    const fingerprints: Array<string> = [];

    for (const [text, storedText, keyedOf] of [
      [
        ExceptionUtil.getGroupingTextV1(earlier),
        data.storedV1Text,
        KeyedExceptionFingerprint.ofFirstGroupingText,
      ],
      [
        ExceptionUtil.getGroupingTexts(earlier).v2,
        data.storedV2Text,
        KeyedExceptionFingerprint.ofGroupingText,
      ],
    ] as Array<
      [string, string, (input: { projectId: ObjectID; text: string }) => string]
    >) {
      if (text === storedText) {
        continue;
      }

      const fingerprint: string = fingerprintSha256(text);

      fingerprints.push(fingerprint);

      if (isChangedOnlyWhereFolded(text, storedText)) {
        continue;
      }

      const keyed: string = keyedOf.call(KeyedExceptionFingerprint, {
        projectId: data.projectId,
        text,
      });

      fingerprints.push(keyed);

      if (!Object.prototype.hasOwnProperty.call(data.rekeys, fingerprint)) {
        writeOwnValue(data.rekeys, fingerprint, keyed);
      }
    }

    return Array.from(new Set<string>(fingerprints));
  }

  /*
   * WHICH FINGERPRINT AN OCCURRENCE IS GROUPED BY.
   *
   * An occurrence belongs to the first exception that exists under one of
   * its candidates, tried in order; none existing, a new exception is made
   * under its v2. An occurrence that names no candidates tries its v1 alone:
   * an exception that existed before grouping v2 keeps its first (v1)
   * fingerprint, so an occurrence whose v1 fingerprint is an exception's is
   * that exception's, as before, and every other occurrence is grouped by its
   * v2 fingerprint, so a new exception is made under it, and its later
   * occurrences find it whatever their line numbers or library frames. So the
   * switch neither splits an existing exception nor merges two. The
   * candidates getOccurrenceFingerprints names do the same for what a scrub
   * rule hid (#10434).
   *
   * One indexed read per project for the fingerprints a batch tries that are
   * not cached (readKnownGroups), tried again when it fails.
   *
   * A new exception made here exists for the occurrences after it at once -
   * those of this batch, and those of the batches this process reads next -
   * so two copies of one exception that try their candidates in the same
   * order go to the same one, whichever comes first.
   *
   * An exception found under a fingerprint that hashes what a scrub rule
   * hid of the occurrence (its `rekeys`) is moved to the private
   * fingerprint of the same text, once, and the occurrence goes there
   * (moveToPrivateFingerprint, #10619). One found under such a fingerprint
   * that it was moved from already - a row that only keeps it - is where
   * every occurrence that finds it goes, a rule or not: its exception's
   * fingerprint now.
   *
   * WHEN THE EXCEPTIONS CANNOT BE READ (#11027). Every try of the read
   * failing, an occurrence is not grouped by a guess. Until #11027 it kept
   * its grouping v1 fingerprint: for an exception made since grouping v2 no
   * exception exists under v1, so the upsert made one - a duplicate, and
   * New Exception again for an old error - and as every later occurrence
   * tries v1 first, the duplicate kept them all, for good. Now:
   *
   *  - one whose candidates this read knows already (the cache) is grouped
   *    as ever;
   *  - else one whose exception this process knew of before, however long
   *    ago, goes to that exception (lastKnownGroupOf): an exception does not
   *    stop existing under its fingerprint;
   *  - else its exception is not known (`unknown`), and nothing is made for
   *    it. Its exception's count waits: assignPayloadGroupFingerprints holds
   *    it until the read works (HeldExceptionOccurrences). Its occurrence,
   *    stored at once, goes under the fingerprint a new exception would be
   *    made under, tried last, so it never takes occurrences from an
   *    exception that exists (resolveGroupFingerprints).
   *
   * AND A DUPLICATE A FAILED LOOKUP MADE BEFORE #11027 IS MERGED BACK. An
   * occurrence that finds an exception under its v1 fingerprint made after
   * an exception under a fingerprint it tries later found the duplicate:
   * the two are merged as OneUptime, the older one kept, with no alert
   * (splitByFailedLookupOf, TelemetryExceptionSplitHeal).
   */
  public static async resolveGroups(
    candidates: Array<GroupFingerprintCandidate>,
    now: number = Date.now(),
  ): Promise<ResolvedGroups> {
    const chosen: Map<string, string> = new Map();
    const unknown: Map<string, GroupFingerprintCandidate> = new Map();
    // What this read knows of each fingerprint, by `projectId|fingerprint`.
    const known: Map<string, KnownGroup> = new Map();
    const toLookUp: Map<string, Set<string>> = new Map();

    for (const candidate of candidates) {
      if (!candidate.v2) {
        continue;
      }

      for (const fingerprint of fingerprintsToTry(candidate)) {
        const cacheKey: string = `${candidate.projectId}|${fingerprint}`;

        if (known.has(cacheKey)) {
          continue;
        }

        const cached: (KnownGroup & { at: number }) | undefined =
          existingGroupCache.get(cacheKey);

        if (cached && now - cached.at < EXISTING_GROUP_CACHE_TTL_MS) {
          known.set(cacheKey, knownGroupOf(cached));
          continue;
        }

        const fingerprints: Set<string> =
          toLookUp.get(candidate.projectId) || new Set<string>();
        fingerprints.add(fingerprint);
        toLookUp.set(candidate.projectId, fingerprints);
      }
    }

    for (const [projectId, fingerprints] of toLookUp) {
      const existing: Map<string, KnownGroup> | null =
        await ExceptionUtil.readKnownGroups(
          projectId,
          Array.from(fingerprints),
        );

      // Not read: its candidates are settled by what is known, or not at all.
      if (!existing) {
        continue;
      }

      if (
        existingGroupCache.size + fingerprints.size >
        EXISTING_GROUP_CACHE_MAX_ENTRIES
      ) {
        existingGroupCache.clear();
      }

      for (const fingerprint of fingerprints) {
        const group: KnownGroup = existing.get(fingerprint) || {
          exists: false,
        };

        known.set(`${projectId}|${fingerprint}`, group);
        existingGroupCache.set(`${projectId}|${fingerprint}`, {
          ...group,
          at: now,
        });
      }
    }

    // The exceptions to move to a private fingerprint, each once (#10619).
    const moves: Map<string, ExceptionMove> = new Map();
    // The pairs of exceptions a rule split before #10434, each once (#10618).
    const splits: Map<string, ExceptionSplitPair> = new Map();
    // The duplicates a failed lookup made, each once (#11027).
    const heals: Map<string, ExceptionSplitByFailedLookup> = new Map();
    // And the occurrences that go wherever each one moves, by their key.
    const occurrencesOfMove: Map<string, Array<string>> = new Map();

    for (const candidate of candidates) {
      const key: string = groupFingerprintKey(candidate);

      if (!candidate.v2) {
        chosen.set(key, candidate.v1);
        continue;
      }

      let found: string | undefined = undefined;
      let settled: boolean = true;

      for (const fingerprint of fingerprintsToTry(candidate)) {
        const group: KnownGroup | undefined = known.get(
          `${candidate.projectId}|${fingerprint}`,
        );

        // Neither read nor known: its project's exceptions could not be read.
        if (!group) {
          settled = false;
          break;
        }

        if (group.exists) {
          found = fingerprint;
          break;
        }
      }

      if (!settled) {
        const lastKnown: string | undefined =
          ExceptionUtil.lastKnownGroupOf(candidate);

        if (lastKnown !== undefined) {
          chosen.set(key, lastKnown);
        } else {
          unknown.set(key, candidate);
        }

        continue;
      }

      if (found !== undefined) {
        const split: ExceptionSplitPair | null = ExceptionUtil.splitPairOf({
          candidate,
          found,
          known,
        });

        if (split) {
          splits.set(
            `${split.projectId}|${split.splitFingerprint}|${split.splitFromFingerprint}`,
            split,
          );
        }

        const heal: ExceptionSplitByFailedLookup | null =
          ExceptionUtil.splitByFailedLookupOf({ candidate, found, known });

        if (heal) {
          heals.set(
            `${heal.projectId}|${heal.primaryEntityId.toLowerCase()}|${heal.duplicate}|${heal.original}`,
            heal,
          );
        }

        const movedTo: string | undefined = known.get(
          `${candidate.projectId}|${found}`,
        )?.movedTo;

        // Its exception was moved to a private fingerprint: it goes there.
        if (movedTo) {
          chosen.set(key, movedTo);
          continue;
        }

        chosen.set(key, found);

        const to: string | undefined = candidate.rekeys?.[found];

        if (to && to !== found && candidate.primaryEntityId) {
          const moveKey: string = `${candidate.projectId}|${candidate.primaryEntityId.toLowerCase()}|${found}`;

          if (!isMoveRefused(moveKey, now)) {
            moves.set(moveKey, {
              projectId: candidate.projectId,
              primaryEntityId: candidate.primaryEntityId,
              from: found,
              to: to,
            });
            occurrencesOfMove.set(moveKey, [
              ...(occurrencesOfMove.get(moveKey) || []),
              key,
            ]);
          }
        }

        continue;
      }

      // A new exception is made under its v2, for the occurrences after it.
      chosen.set(key, candidate.v2);
      known.set(`${candidate.projectId}|${candidate.v2}`, { exists: true });
      rememberGroupMade(`${candidate.projectId}|${candidate.v2}`, now);
    }

    for (const [splitKey, split] of splits) {
      if (!recordedSplits.has(splitKey)) {
        await ExceptionUtil.recordSplitPair(split);

        if (recordedSplits.size >= MAX_RECORDED_SPLITS) {
          recordedSplits.clear();
        }

        recordedSplits.add(splitKey);
      }
    }

    for (const [moveKey, move] of moves) {
      const fingerprint: string = await ExceptionUtil.moveToPrivateFingerprint(
        move,
        now,
      );

      if (fingerprint === move.from) {
        continue;
      }

      for (const key of occurrencesOfMove.get(moveKey) || []) {
        chosen.set(key, fingerprint);
      }
    }

    for (const [healKey, heal] of heals) {
      await ExceptionUtil.healSplitByFailedLookup(healKey, heal, now);
    }

    return { chosen, unknown };
  }

  /*
   * The fingerprint of each candidate's exception, by groupFingerprintKey
   * (resolveGroups) - for the occurrences ClickHouse stores, which are
   * written now whatever is known: one whose exception could not be known
   * goes under the fingerprint a new exception would be made under (its
   * v2), tried after every other, so the occurrence never takes the place
   * of an exception that exists. When the read works again and none
   * exists, its exception is made under that very fingerprint.
   */
  public static async resolveGroupFingerprints(
    candidates: Array<GroupFingerprintCandidate>,
    now: number = Date.now(),
  ): Promise<Map<string, string>> {
    const resolved: ResolvedGroups = await ExceptionUtil.resolveGroups(
      candidates,
      now,
    );

    for (const [key, candidate] of resolved.unknown) {
      resolved.chosen.set(key, candidate.v2);
    }

    return resolved.chosen;
  }

  /*
   * Which of `fingerprints` an exception of the project exists under
   * (GROUP_FINGERPRINT_LOOKUP_SQL), read again after each of
   * GROUP_FINGERPRINT_LOOKUP_RETRY_DELAYS_MS when the read fails, within
   * GROUP_FINGERPRINT_LOOKUP_RETRY_BUDGET_MS. Null when no try worked.
   */
  private static async readKnownGroups(
    projectId: string,
    fingerprints: Array<string>,
  ): Promise<Map<string, KnownGroup> | null> {
    const startedAt: number = Date.now();

    for (let attempt: number = 0; ; attempt++) {
      try {
        const rows: Array<GroupLookupRow> =
          await TelemetryExceptionService.getRepository().manager.query(
            GROUP_FINGERPRINT_LOOKUP_SQL,
            [projectId, fingerprints],
          );

        return knownGroupsOfLookupRows(rows);
      } catch (err) {
        const pause: number | undefined =
          GROUP_FINGERPRINT_LOOKUP_RETRY_DELAYS_MS[attempt];

        if (
          pause === undefined ||
          Date.now() - startedAt + pause >
            GROUP_FINGERPRINT_LOOKUP_RETRY_BUDGET_MS
        ) {
          logger.warn(
            `Could not read which exceptions of project ${projectId} its occurrences belong to (${attempt + 1} ${
              attempt === 0 ? "try" : "tries"
            }); an occurrence whose exception is not known otherwise is counted once they can be read, and no exception is made for it: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );

          return null;
        }

        await ExceptionUtil.pauseBeforeLookupRetry(pause);
      }
    }
  }

  // Waits before the lookup is read again (a test makes it return at once).
  public static async pauseBeforeLookupRetry(ms: number): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  }

  /*
   * Where an occurrence goes by what this process knew of its project's
   * exceptions, however long ago (#11027): its candidates in order, the
   * first known to exist - or where it moved - unless one before it is not
   * known at all. Undefined when that does not settle it, and when none was
   * known to exist: a new exception is made only on a read.
   */
  public static lastKnownGroupOf(
    candidate: GroupFingerprintCandidate,
  ): string | undefined {
    for (const fingerprint of fingerprintsToTry(candidate)) {
      const cached: (KnownGroup & { at: number }) | undefined =
        existingGroupCache.get(`${candidate.projectId}|${fingerprint}`);

      if (!cached) {
        return undefined;
      }

      if (cached.exists) {
        return cached.movedTo || fingerprint;
      }
    }

    return undefined;
  }

  /*
   * A DUPLICATE A FAILED LOOKUP MADE (#11027).
   *
   * Until #11027 an occurrence whose project's exceptions could not be read
   * was filed under its `fingerprint` - grouping v1's (`v1` here) - and an
   * exception made since grouping v2 has none there: the upsert made a
   * duplicate under it, which every later occurrence found first. So when
   * the exception an occurrence finds (`found`) is under its v1, it is that
   * duplicate if an exception under a fingerprint the occurrence tries later
   * was made before it: since grouping v2 nothing else makes one under v1,
   * and one made before grouping v2 is older than any made since. Null when
   * it is not, when the read does not say when either was made, and for one
   * merged already or that only keeps a former fingerprint.
   */
  public static splitByFailedLookupOf(data: {
    candidate: GroupFingerprintCandidate;
    found: string;
    known: Map<string, KnownGroup>;
  }): ExceptionSplitByFailedLookup | null {
    const candidate: GroupFingerprintCandidate = data.candidate;

    if (
      !candidate.primaryEntityId ||
      data.found !== candidate.v1 ||
      candidate.v1 === candidate.v2
    ) {
      return null;
    }

    const duplicate: KnownGroup | undefined = data.known.get(
      `${candidate.projectId}|${data.found}`,
    );

    if (
      !duplicate?.exists ||
      duplicate.movedTo ||
      duplicate.mergedInto ||
      duplicate.createdAt === undefined
    ) {
      return null;
    }

    const tried: Array<string> = fingerprintsToTry(candidate);

    for (const fingerprint of tried.slice(tried.indexOf(data.found) + 1)) {
      const group: KnownGroup | undefined = data.known.get(
        `${candidate.projectId}|${fingerprint}`,
      );

      if (!group?.exists) {
        continue;
      }

      // The first one tried after it is the one it was split from, if any.
      if (
        group.createdAt === undefined ||
        duplicate.createdAt <= group.createdAt
      ) {
        return null;
      }

      return {
        projectId: candidate.projectId,
        primaryEntityId: candidate.primaryEntityId,
        duplicate: data.found,
        original: fingerprint,
      };
    }

    return null;
  }

  /*
   * Merges a duplicate a failed lookup made back into the exception it was
   * split from (TelemetryExceptionSplitHeal), once: what became of it is
   * remembered, and a merge that failed is tried again a while later.
   */
  public static async healSplitByFailedLookup(
    healKey: string,
    heal: ExceptionSplitByFailedLookup,
    now: number = Date.now(),
  ): Promise<ExceptionSplitHealOutcome | null> {
    const decided: { at: number; failed: boolean } | undefined =
      splitHealDecisions.get(healKey);

    if (
      decided &&
      now - decided.at <
        (decided.failed
          ? EXISTING_GROUP_CACHE_TTL_MS
          : SPLIT_HEAL_DECISION_TTL_MS)
    ) {
      return null;
    }

    const outcome: ExceptionSplitHealOutcome =
      await TelemetryExceptionSplitHeal.heal(heal);

    if (
      splitHealDecisions.size >= MAX_SPLIT_HEAL_DECISIONS &&
      !splitHealDecisions.has(healKey)
    ) {
      splitHealDecisions.clear();
    }

    splitHealDecisions.set(healKey, {
      at: now,
      failed: outcome === ExceptionSplitHealOutcome.Failed,
    });

    return outcome;
  }

  /*
   * A PAIR OF EXCEPTIONS A SCRUB RULE SPLIT BEFORE #10434 (#10618).
   *
   * Before #10434 an exception found in a log was grouped by the text the
   * rules left, so a rule that hid part of it split it from the exception
   * it was: its occurrences since have made one of their own. Ingest still
   * finds them there (findsGroupsOfStoredText), so the pair is known the
   * moment an occurrence lands on one of the exceptions made under the text
   * the rules left (`found`) while an exception also exists under what it
   * said as it arrived: the first of those it tries, or, for one moved to a
   * private fingerprint, where it moved. Null when there is no such pair.
   */
  public static splitPairOf(data: {
    candidate: GroupFingerprintCandidate;
    found: string;
    known: Map<string, KnownGroup>;
  }): ExceptionSplitPair | null {
    const storedOnly: Array<string> = data.candidate.storedOnly || [];

    if (!data.candidate.primaryEntityId || !storedOnly.includes(data.found)) {
      return null;
    }

    for (const fingerprint of fingerprintsToTry(data.candidate)) {
      if (storedOnly.includes(fingerprint)) {
        continue;
      }

      const group: KnownGroup | undefined = data.known.get(
        `${data.candidate.projectId}|${fingerprint}`,
      );

      if (group?.exists) {
        const splitFrom: string = group.movedTo || fingerprint;

        return splitFrom === data.found
          ? null
          : {
              projectId: data.candidate.projectId,
              primaryEntityId: data.candidate.primaryEntityId,
              splitFingerprint: data.found,
              splitFromFingerprint: splitFrom,
            };
      }
    }

    return null;
  }

  /*
   * Records a pair of exceptions a scrub rule split on the split one
   * (RECORD_SPLIT_PAIR_SQL), so its page can offer to merge the two. Never
   * merges them: only a person does. Never fails the batch: a pair that
   * cannot be recorded now is recorded by a later occurrence.
   */
  public static async recordSplitPair(
    split: ExceptionSplitPair,
  ): Promise<void> {
    try {
      await TelemetryExceptionService.getRepository().manager.query(
        RECORD_SPLIT_PAIR_SQL,
        [
          split.projectId,
          split.primaryEntityId,
          split.splitFingerprint,
          split.splitFromFingerprint,
        ],
      );
    } catch (err) {
      logger.warn(
        `Could not record which exception a scrub rule split exception ${split.splitFingerprint} of project ${split.projectId} from: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * Moves an exception found under a fingerprint that hashes what a scrub
   * rule hid to the private fingerprint of the same text
   * (TelemetryExceptionRekey), and remembers where it went: the fingerprint
   * its occurrences go to from now on - its new one, or its old one when it
   * was not moved, which is not tried again for a while.
   */
  public static async moveToPrivateFingerprint(
    move: ExceptionMove,
    now: number = Date.now(),
  ): Promise<string> {
    const result: ExceptionRekeyResult = await TelemetryExceptionRekey.rekey({
      projectId: move.projectId,
      primaryEntityId: move.primaryEntityId,
      from: move.from,
      to: move.to,
    });

    if (result.fingerprint === move.from) {
      if (refusedMoves.size >= MAX_REFUSED_MOVES) {
        refusedMoves.clear();
      }

      refusedMoves.set(
        `${move.projectId}|${move.primaryEntityId.toLowerCase()}|${move.from}`,
        now,
      );

      return move.from;
    }

    rememberGroup(
      `${move.projectId}|${move.from}`,
      { exists: true, movedTo: result.fingerprint },
      now,
    );
    rememberGroupMade(`${move.projectId}|${result.fingerprint}`, now);

    return result.fingerprint;
  }

  // A row's or a payload's fingerprints, as resolveGroupFingerprints reads them.
  private static candidateOf(data: {
    projectId: string;
    primaryEntityId: unknown;
    fingerprint: unknown;
    fingerprintV2: unknown;
    fingerprintCandidates: unknown;
    fingerprintRekeys: unknown;
    fingerprintsOfStoredText?: unknown;
  }): GroupFingerprintCandidate | null {
    if (typeof data.fingerprintV2 !== "string" || !data.fingerprintV2) {
      return null;
    }

    const candidates: Array<string> | undefined = readCandidates(
      data.fingerprintCandidates,
    );
    const rekeys: Record<string, string> | undefined = readRekeys(
      data.fingerprintRekeys,
    );
    const storedOnly: Array<string> | undefined = readCandidates(
      data.fingerprintsOfStoredText,
    );
    const primaryEntityId: string = data.primaryEntityId
      ? String(data.primaryEntityId)
      : "";

    return {
      projectId: data.projectId,
      v1: String(data.fingerprint || ""),
      v2: data.fingerprintV2,
      ...(candidates ? { candidates } : {}),
      ...(primaryEntityId ? { primaryEntityId } : {}),
      ...(rekeys ? { rekeys } : {}),
      ...(storedOnly && storedOnly.length > 0 ? { storedOnly } : {}),
    };
  }

  /*
   * The occurrence rows of a batch, each given the fingerprint of the
   * exception it belongs to (resolveGroupFingerprints) before they are
   * stored: the row keeps no fingerprintV2 or candidates of its own.
   */
  public static async assignRowGroupFingerprints(
    rows: Array<JSONObject>,
  ): Promise<void> {
    const candidateOfRow: (
      row: JSONObject,
    ) => GroupFingerprintCandidate | null = (
      row: JSONObject,
    ): GroupFingerprintCandidate | null => {
      return ExceptionUtil.candidateOf({
        projectId: String(row["projectId"] || ""),
        primaryEntityId: row["primaryEntityId"],
        fingerprint: row["fingerprint"],
        fingerprintV2: row["fingerprintV2"],
        fingerprintCandidates: row["fingerprintCandidates"],
        fingerprintRekeys: row["fingerprintRekeys"],
      });
    };

    const candidates: Array<GroupFingerprintCandidate> = [];

    for (const row of rows) {
      const candidate: GroupFingerprintCandidate | null = candidateOfRow(row);

      if (candidate) {
        candidates.push(candidate);
      }
    }

    const chosen: Map<string, string> =
      candidates.length > 0
        ? await ExceptionUtil.resolveGroupFingerprints(candidates)
        : new Map<string, string>();

    for (const row of rows) {
      const candidate: GroupFingerprintCandidate | null = candidateOfRow(row);

      if (candidate) {
        row["fingerprint"] =
          chosen.get(groupFingerprintKey(candidate)) || row["fingerprint"];
      }

      delete row["fingerprintV2"];
      delete row["fingerprintCandidates"];
      delete row["fingerprintRekeys"];
    }
  }

  /*
   * The same, for the exception group upserts of a batch: the payloads to
   * upsert now, each given its exception's fingerprint. One whose exception
   * could not be known (resolveGroups, #11027) is not among them: no
   * exception is made for it on a guess. It is held, at the time it
   * happened (HeldExceptionOccurrences), and goes with a later batch once
   * the exceptions can be read.
   */
  public static async assignPayloadGroupFingerprints(
    payloads: Array<TelemetryExceptionPayload>,
    now: number = Date.now(),
  ): Promise<Array<TelemetryExceptionPayload>> {
    const candidateOfPayload: (
      payload: TelemetryExceptionPayload,
    ) => GroupFingerprintCandidate | null = (
      payload: TelemetryExceptionPayload,
    ): GroupFingerprintCandidate | null => {
      if (!payload || !payload.projectId) {
        return null;
      }

      return ExceptionUtil.candidateOf({
        projectId: payload.projectId.toString(),
        primaryEntityId: payload.primaryEntityId?.toString(),
        fingerprint: payload.fingerprint,
        fingerprintV2: payload.fingerprintV2,
        fingerprintCandidates: payload.fingerprintCandidates,
        fingerprintRekeys: payload.fingerprintRekeys,
        fingerprintsOfStoredText: payload.fingerprintsOfStoredText,
      });
    };

    const candidates: Array<GroupFingerprintCandidate> = [];

    for (const payload of payloads) {
      const candidate: GroupFingerprintCandidate | null =
        candidateOfPayload(payload);

      if (candidate) {
        candidates.push(candidate);
      }
    }

    if (candidates.length === 0) {
      return payloads;
    }

    const resolution: ResolvedGroups = await ExceptionUtil.resolveGroups(
      candidates,
      now,
    );
    const ready: Array<TelemetryExceptionPayload> = [];
    const toHold: Array<{ key: string; payload: TelemetryExceptionPayload }> =
      [];

    for (const payload of payloads) {
      const candidate: GroupFingerprintCandidate | null =
        candidateOfPayload(payload);

      if (!candidate) {
        ready.push(payload);
        continue;
      }

      const key: string = groupFingerprintKey(candidate);

      if (resolution.unknown.has(key)) {
        // Fixed at the time it happened, so a later upsert counts it then.
        toHold.push({
          key,
          payload: {
            ...payload,
            occurredAt: clampOccurrenceTime(payload.occurredAt, new Date(now)),
          },
        });
        continue;
      }

      const resolved: TelemetryExceptionPayload = {
        ...payload,
        fingerprint: resolution.chosen.get(key) || payload.fingerprint,
      };

      delete resolved.fingerprintV2;
      delete resolved.fingerprintCandidates;
      delete resolved.fingerprintRekeys;
      delete resolved.fingerprintsOfStoredText;

      ready.push(resolved);
    }

    if (toHold.length > 0) {
      HeldExceptionOccurrences.hold(toHold, now);
      ExceptionUtil.tryHeldOccurrencesLater();
    }

    return ready;
  }

  /*
   * Tries the held occurrences again after HELD_OCCURRENCE_RETRY_MS, when no
   * batch has taken them by then (#11027): a process that ingests nothing
   * more does not keep them waiting. One timer at a time, which keeps no
   * process alive.
   */
  public static tryHeldOccurrencesLater(): void {
    if (heldRetryTimer || HeldExceptionOccurrences.isEmpty()) {
      return;
    }

    heldRetryTimer = setTimeout(() => {
      heldRetryTimer = null;

      ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([])
        .catch((err: unknown) => {
          logger.warn(
            `Could not count the exception occurrences held while their exceptions could not be read; they are tried again: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        })
        .finally(() => {
          ExceptionUtil.tryHeldOccurrencesLater();
        });
    }, HELD_OCCURRENCE_RETRY_MS);

    heldRetryTimer.unref?.();
  }

  // The grouping v1 fingerprint: an unkeyed hash of getGroupingTextV1.
  public static getFingerprint(data: ExceptionFingerprintInput): string {
    return fingerprintSha256(ExceptionUtil.getGroupingTextV1(data));
  }

  /*
   * The text the grouping v1 fingerprint hashes: the project, the service,
   * the normalized message and stack trace, and the type, run together.
   * Byte for byte what it always was: every exception made before grouping
   * v2 is found by it.
   */
  public static getGroupingTextV1(data: ExceptionFingerprintInput): string {
    const message: string = data.message || "";
    const stackTrace: string = data.stackTrace || "";
    const type: string = data.exceptionType || "";
    const projectId: string = data.projectId?.toString() || "";
    const primaryEntityId: string = data.primaryEntityId?.toString() || "";

    /*
     * Normalize message and stack trace to group similar exceptions together
     * This replaces dynamic values like IDs, timestamps, etc. with placeholders
     */
    const normalizedMessage: string =
      ExceptionUtil.normalizeForFingerprint(message);
    const normalizedStackTrace: string =
      ExceptionUtil.normalizeForFingerprint(stackTrace);

    return (
      projectId +
      primaryEntityId +
      normalizedMessage +
      normalizedStackTrace +
      type
    );
  }

  /**
   * Convenience single-event wrapper retained so call sites that
   * legitimately only have one exception (e.g. ad-hoc tooling or
   * tests) do not have to construct a one-element array. Inside the
   * OTel traces ingest hot path callers should aggregate first and
   * call `saveOrUpdateTelemetryExceptionsBatch` directly with the
   * full batch — that is where the round-trip savings live.
   */
  public static async saveOrUpdateTelemetryException(
    exception: TelemetryExceptionPayload,
  ): Promise<void> {
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([exception]);
  }

  /**
   * Upsert a batch of telemetry exception observations into Postgres
   * in a single statement per chunk.
   *
   * The legacy per-event implementation issued a SELECT + UPDATE-or-
   * INSERT pair per exception event, fired off as fire-and-forget
   * Promises from inside the OTel trace span loop. Under load that
   * (a) saturated the Postgres pool, (b) lost concurrent
   * occuranceCount increments because the +1 was read-modify-write
   * in JS, and (c) occasionally produced duplicate rows when two
   * workers both missed the SELECT at the same time.
   *
   * This implementation:
   *
   *   - Pre-aggregates the incoming payloads by
   *     (projectId, primaryEntityId, fingerprint) so N events for one
   *     fingerprint cost one VALUES row, not N.
   *   - Issues `INSERT … VALUES (…), (…), … ON CONFLICT
   *     ("projectId", "primaryEntityId", "fingerprint") DO UPDATE SET …`
   *     so the count merge happens atomically inside Postgres and
   *     concurrent workers cannot lose increments.
   *   - Keeps firstSeenAt / lastSeenAt as the occurrences' own times
   *     (clampOccurrenceTime), with GREATEST / LEAST so out-of-order
   *     delivery (a stale job processed after a fresher one) does
   *     not regress lastSeenAt / firstSeenAt.
   *   - Reopens a resolved row when the batch holds an occurrence
   *     that happened after it was resolved - from another release,
   *     when it was resolved in the next release - and stamps
   *     regressedAt (REOPENS_RESOLVED_EXCEPTION_SQL). A row the batch
   *     does not reopen keeps its resolution and who made it.
   *
   * Chunked at TELEMETRY_EXCEPTION_UPSERT_BATCH_SIZE so the
   * placeholder count stays well below Postgres's 65535 limit.
   */
  @CaptureSpan()
  public static async saveOrUpdateTelemetryExceptionsBatch(
    exceptions: Array<TelemetryExceptionPayload>,
  ): Promise<void> {
    /*
     * The occurrences held while their exceptions could not be read go with
     * this batch (#11027): those of its projects, whose exceptions it reads
     * anyway, and any that have waited long enough.
     */
    const projectIds: Set<string> = new Set<string>();

    for (const exception of exceptions || []) {
      if (exception?.projectId) {
        projectIds.add(exception.projectId.toString());
      }
    }

    const occurrences: Array<TelemetryExceptionPayload> = [
      ...HeldExceptionOccurrences.take(Date.now(), projectIds),
      ...(exceptions || []),
    ];

    if (occurrences.length === 0) {
      return;
    }

    /*
     * Each occurrence is grouped by the fingerprint of the exception it
     * belongs to (assignPayloadGroupFingerprints) - one whose exception
     * cannot be known now is held for a later batch - and then an
     * occurrence of a merged exception counts on the one it was merged into
     * as well (withMergedSurvivors): the batch gains a copy of it under the
     * survivor's key before it is aggregated.
     */
    const aggregated: Map<string, AggregatedException> =
      ExceptionUtil.aggregateExceptions(
        await ExceptionUtil.withMergedSurvivors(
          await ExceptionUtil.assignPayloadGroupFingerprints(occurrences),
        ),
      );

    if (aggregated.size === 0) {
      return;
    }

    /*
     * Emit rows in a deterministic order keyed on the ON CONFLICT
     * tuple (projectId, primaryEntityId, fingerprint) — the exact
     * composite aggregateExceptions() keys the Map on. A multi-row
     * `INSERT … ON CONFLICT DO UPDATE` takes row locks in VALUES
     * order, so two concurrent worker batches that touch the same
     * hot fingerprints in different orders deadlock (AB-BA): Postgres
     * aborts a victim, the telemetry job fails and re-queues, the
     * queue backs up, and KEDA scales workers up — adding yet more
     * contending writers. Sorting by the conflict key makes every
     * worker acquire those locks in one global order, which removes
     * the deadlock cycle. (Map.keys() preserves insertion order, i.e.
     * event-arrival order, which is arbitrary across workers — hence
     * the explicit sort.)
     */
    const rows: Array<AggregatedException> = Array.from(aggregated.keys())
      .sort()
      .map((key: string): AggregatedException => {
        return aggregated.get(key) as AggregatedException;
      });

    for (
      let i: number = 0;
      i < rows.length;
      i += TELEMETRY_EXCEPTION_UPSERT_BATCH_SIZE
    ) {
      const chunk: Array<AggregatedException> = rows.slice(
        i,
        i + TELEMETRY_EXCEPTION_UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const row of chunk) {
        /*
         * Column order must stay in lockstep with the INSERT
         * column list below. 14 placeholders per row: projectId,
         * primaryEntityId, fingerprint, message, stackTrace,
         * exceptionType, firstSeenAt, lastSeenAt, occuranceCount,
         * firstSeenInRelease, lastSeenInRelease, environment,
         * primaryEntityType, unhandled.
         */
        const placeholders: Array<string> = [];
        for (let c: number = 0; c < 14; c++) {
          placeholders.push(`$${paramIndex++}`);
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          row.projectId.toString(),
          row.primaryEntityId.toString(),
          row.fingerprint,
          row.message,
          row.stackTrace,
          row.exceptionType,
          row.firstSeenAt,
          row.lastSeenAt,
          row.occuranceCount,
          row.firstSeenInRelease,
          row.lastSeenInRelease,
          row.environment,
          row.primaryEntityType ?? ServiceType.OpenTelemetry,
          row.unhandled,
        );
      }

      /*
       * The rows this statement reopened come back, and nothing else: their
       * regressedAt is this statement's now() (one value for the whole
       * statement, which a row reopened by an earlier one never holds). They
       * go on each exception's activity timeline (recordRegressions).
       */
      const sql: string = `
        WITH "upserted" AS (
        INSERT INTO "TelemetryException" (
          "projectId", "primaryEntityId", "fingerprint",
          "message", "stackTrace", "exceptionType",
          "firstSeenAt", "lastSeenAt", "occuranceCount",
          "firstSeenInRelease", "lastSeenInRelease", "environment",
          "primaryEntityType", "unhandled",
          "isResolved", "isArchived", "version"
        )
        SELECT
          v."projectId"::uuid, v."primaryEntityId"::uuid, v."fingerprint",
          v."message", v."stackTrace", v."exceptionType",
          v."firstSeenAt"::timestamptz, v."lastSeenAt"::timestamptz,
          v."occuranceCount"::int,
          v."firstSeenInRelease", v."lastSeenInRelease", v."environment",
          v."primaryEntityType", v."unhandled"::boolean,
          false, false, 0
        FROM (VALUES ${valueFragments.join(", ")})
          AS v(
            "projectId", "primaryEntityId", "fingerprint",
            "message", "stackTrace", "exceptionType",
            "firstSeenAt", "lastSeenAt", "occuranceCount",
            "firstSeenInRelease", "lastSeenInRelease", "environment",
            "primaryEntityType", "unhandled"
          )
        ON CONFLICT ("projectId", "primaryEntityId", "fingerprint")
        DO UPDATE SET
          "occuranceCount" =
            "TelemetryException"."occuranceCount" + EXCLUDED."occuranceCount",
          "unhandled" =
            "TelemetryException"."unhandled" OR EXCLUDED."unhandled",
          "lastSeenAt" =
            GREATEST("TelemetryException"."lastSeenAt", EXCLUDED."lastSeenAt"),
          "firstSeenAt" =
            LEAST("TelemetryException"."firstSeenAt", EXCLUDED."firstSeenAt"),
          "message" = COALESCE(
            NULLIF(EXCLUDED."message", ''),
            "TelemetryException"."message"
          ),
          "stackTrace" = COALESCE(
            NULLIF(EXCLUDED."stackTrace", ''),
            "TelemetryException"."stackTrace"
          ),
          "exceptionType" = COALESCE(
            NULLIF(EXCLUDED."exceptionType", ''),
            "TelemetryException"."exceptionType"
          ),
          "lastSeenInRelease" = CASE
            WHEN COALESCE(EXCLUDED."lastSeenInRelease", '') = ''
              THEN "TelemetryException"."lastSeenInRelease"
            WHEN COALESCE("TelemetryException"."lastSeenInRelease", '') = ''
              OR "TelemetryException"."lastSeenAt" IS NULL
              OR EXCLUDED."lastSeenAt" >= "TelemetryException"."lastSeenAt"
              THEN EXCLUDED."lastSeenInRelease"
            ELSE "TelemetryException"."lastSeenInRelease"
          END,
          "environment" = COALESCE(
            NULLIF(EXCLUDED."environment", ''),
            "TelemetryException"."environment"
          ),
          "primaryEntityType" = COALESCE(
            "TelemetryException"."primaryEntityType",
            EXCLUDED."primaryEntityType"
          ),
          "regressedAt" = CASE
            WHEN "TelemetryException"."isResolved" AND NOT ${STAYS_RESOLVED_SQL}
              THEN now()
            ELSE "TelemetryException"."regressedAt"
          END,
          "markedAsResolvedByUserId" = CASE
            WHEN ${STAYS_RESOLVED_SQL}
              THEN "TelemetryException"."markedAsResolvedByUserId"
            ELSE NULL
          END,
          "markedAsResolvedAt" = CASE
            WHEN ${STAYS_RESOLVED_SQL}
              THEN "TelemetryException"."markedAsResolvedAt"
            ELSE NULL
          END,
          "resolvedInReleaseAfter" = CASE
            WHEN ${STAYS_RESOLVED_SQL}
              THEN "TelemetryException"."resolvedInReleaseAfter"
            ELSE NULL
          END,
          "isResolved" = ${STAYS_RESOLVED_SQL},
          "updatedAt" = now()
        RETURNING "_id", "projectId", "regressedAt", "lastSeenInRelease"
        )
        SELECT "_id"::text AS "id", "projectId"::text AS "projectId",
          "lastSeenInRelease"
        FROM "upserted"
        WHERE "regressedAt" = now()
      `;

      let regressed: Array<RegressedExceptionRow> = [];

      try {
        regressed =
          (await TelemetryExceptionService.getRepository().manager.query(
            sql,
            params,
          )) || [];
      } catch (err) {
        /*
         * Fail loud — the caller wraps this in a try/catch and
         * logs context-rich attributes; we just surface the cause.
         */
        logger.error(
          `Telemetry exception batch upsert failed (${chunk.length} rows): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }

      await ExceptionUtil.recordRegressions(regressed);
    }
  }

  /*
   * Each exception the batch reopened came back after it was resolved: a
   * Regressed entry on its activity timeline, by OneUptime, naming the
   * release of the occurrence that brought it back when it names one. Never
   * fails the batch: the occurrences are counted already, and an entry that
   * cannot be written is logged and dropped (TelemetryExceptionActivityService).
   */
  public static async recordRegressions(
    rows: Array<RegressedExceptionRow> | null | undefined,
  ): Promise<void> {
    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }

    try {
      const entries: Array<TelemetryExceptionActivityEntry> = [];

      for (const row of rows) {
        if (
          !row ||
          !ObjectID.isValidUUID(row.id || "") ||
          !ObjectID.isValidUUID(row.projectId || "")
        ) {
          continue;
        }

        entries.push({
          projectId: new ObjectID(row.projectId),
          telemetryExceptionId: new ObjectID(row.id),
          activityType: TelemetryExceptionActivityType.Regressed,
          release: row.lastSeenInRelease || null,
        });
      }

      await TelemetryExceptionActivityService.record({
        entries,
        actor: {},
      });
    } catch (err) {
      logger.warn(
        `Could not record the exceptions the batch reopened: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * THE FINGERPRINT ALIASES OF MERGED EXCEPTIONS.
   *
   * An exception merged into another (TelemetryExceptionMerge) keeps its
   * fingerprint, and that fingerprint is from then on an alias of the one it
   * was merged into: an occurrence of it is counted on both - on its own
   * row, which keeps counting so an unmerge gives it back exactly, and on
   * the survivor's, which the lists show. One indexed read per batch and
   * project (the partial index on merged rows), and none of the batch's
   * occurrences is ever dropped: when the read fails, the batch is counted
   * as it would have been before any merge.
   *
   * Returns, per project, the merged fingerprints the batch holds and the
   * survivor each points at.
   */
  public static async resolveMergedExceptions(
    exceptions: Array<TelemetryExceptionPayload>,
  ): Promise<Map<string, MergedExceptionSurvivor>> {
    const survivors: Map<string, MergedExceptionSurvivor> = new Map();
    const fingerprintsByProject: Map<string, Set<string>> = new Map();

    for (const exception of exceptions) {
      if (!exception || !exception.projectId || !exception.fingerprint) {
        continue;
      }

      const projectId: string = exception.projectId.toString();
      const fingerprints: Set<string> =
        fingerprintsByProject.get(projectId) || new Set<string>();
      fingerprints.add(exception.fingerprint);
      fingerprintsByProject.set(projectId, fingerprints);
    }

    for (const [projectId, fingerprints] of fingerprintsByProject) {
      try {
        const rows: Array<{
          fingerprint: string;
          primaryEntityId: string;
          survivorPrimaryEntityId: string;
          survivorFingerprint: string;
        }> = await TelemetryExceptionService.getRepository().manager.query(
          `SELECT m."fingerprint" AS "fingerprint",
                  m."primaryEntityId"::text AS "primaryEntityId",
                  s."primaryEntityId"::text AS "survivorPrimaryEntityId",
                  s."fingerprint" AS "survivorFingerprint"
           FROM "TelemetryException" m
           JOIN "TelemetryException" s
             ON s."_id" = m."mergedIntoTelemetryExceptionId"
            AND s."deletedAt" IS NULL
           WHERE m."projectId" = $1
             AND m."fingerprint" = ANY($2::text[])
             AND m."mergedIntoTelemetryExceptionId" IS NOT NULL
             AND m."deletedAt" IS NULL`,
          [projectId, Array.from(fingerprints)],
        );

        for (const row of rows || []) {
          if (!row.survivorFingerprint || !row.survivorPrimaryEntityId) {
            continue;
          }

          survivors.set(
            mergedExceptionKey(projectId, row.primaryEntityId, row.fingerprint),
            {
              primaryEntityId: new ObjectID(row.survivorPrimaryEntityId),
              fingerprint: row.survivorFingerprint,
            },
          );
        }
      } catch (err) {
        logger.warn(
          `Could not read the merged exceptions of project ${projectId}; the batch is counted without them: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return survivors;
  }

  /*
   * The batch, plus a copy of each occurrence of a merged exception under
   * its survivor's key. The copy carries no message, stack trace, type or
   * environment: the survivor keeps its own (the upsert never overwrites a
   * value with an empty one), while its count, seen times, releases and
   * unhandled flag take in the occurrence - and a resolved survivor reopens
   * as Regressed, as it would for an occurrence of its own.
   */
  public static async withMergedSurvivors(
    exceptions: Array<TelemetryExceptionPayload>,
  ): Promise<Array<TelemetryExceptionPayload>> {
    const survivors: Map<string, MergedExceptionSurvivor> =
      await ExceptionUtil.resolveMergedExceptions(exceptions);

    if (survivors.size === 0) {
      return exceptions;
    }

    const out: Array<TelemetryExceptionPayload> = [...exceptions];

    for (const exception of exceptions) {
      if (
        !exception ||
        !exception.projectId ||
        !exception.primaryEntityId ||
        !exception.fingerprint
      ) {
        continue;
      }

      const survivor: MergedExceptionSurvivor | undefined = survivors.get(
        mergedExceptionKey(
          exception.projectId.toString(),
          exception.primaryEntityId.toString(),
          exception.fingerprint,
        ),
      );

      if (!survivor) {
        continue;
      }

      out.push({
        fingerprint: survivor.fingerprint,
        projectId: exception.projectId,
        primaryEntityId: survivor.primaryEntityId,
        ...(exception.primaryEntityType
          ? { primaryEntityType: exception.primaryEntityType }
          : {}),
        ...(exception.release ? { release: exception.release } : {}),
        ...(exception.unhandled !== undefined
          ? { unhandled: exception.unhandled }
          : {}),
        ...(exception.occurredAt ? { occurredAt: exception.occurredAt } : {}),
        ...(exception.occurrences !== undefined
          ? { occurrences: exception.occurrences }
          : {}),
      });
    }

    return out;
  }

  /*
   * Group payloads by (projectId, primaryEntityId, fingerprint), sum
   * occurrence counts, and pick the most-informative metadata to
   * carry into the INSERT/UPDATE. We prefer non-empty message /
   * stackTrace / exceptionType from later events because earlier
   * events in the same batch may be truncated or sampled; the
   * COALESCE(NULLIF(...)) in the SQL guarantees we never overwrite
   * a populated DB value with an empty incoming one.
   *
   * The seen times are the earliest and latest occurrence times, and
   * the releases are those occurrences' own: the first seen release
   * is the earliest occurrence's that names one, the last seen
   * release the latest's - not whichever event of the batch came
   * first, which during a rollout is often the old release.
   */
  public static aggregateExceptions(
    exceptions: Array<TelemetryExceptionPayload>,
    now: Date = new Date(),
  ): Map<string, AggregatedException> {
    const out: Map<string, AggregatedException> = new Map();

    for (const exception of exceptions) {
      if (!exception) {
        continue;
      }

      if (
        !exception.fingerprint ||
        !exception.projectId ||
        !exception.primaryEntityId
      ) {
        /*
         * Mirror the legacy validation but skip the bad row instead
         * of throwing — losing one event must not poison the whole
         * worker batch.
         */
        logger.warn(
          "Skipping telemetry exception payload missing fingerprint / projectId / primaryEntityId",
        );
        continue;
      }

      const key: string = `${exception.projectId.toString()}|${exception.primaryEntityId.toString()}|${exception.fingerprint}`;
      const occurredAt: Date = clampOccurrenceTime(exception.occurredAt, now);
      const release: string = exception.release || "";
      // One occurrence, or the many a held one stands for (#11027).
      const occurrences: number = occurrencesOf(exception);

      const existing: AggregatedException | undefined = out.get(key);
      if (existing) {
        existing.occuranceCount += occurrences;
        existing.unhandled = existing.unhandled || exception.unhandled === true;
        if (!existing.primaryEntityType && exception.primaryEntityType) {
          existing.primaryEntityType = exception.primaryEntityType;
        }
        existing.message = pickNonEmpty(existing.message, exception.message);
        existing.stackTrace = pickNonEmpty(
          existing.stackTrace,
          exception.stackTrace,
        );
        existing.exceptionType = pickNonEmpty(
          existing.exceptionType,
          exception.exceptionType,
        );
        existing.environment = pickNonEmpty(
          existing.environment,
          exception.environment,
        );

        if (occurredAt.getTime() < existing.firstSeenAt.getTime()) {
          existing.firstSeenAt = occurredAt;
        }

        if (occurredAt.getTime() > existing.lastSeenAt.getTime()) {
          existing.lastSeenAt = occurredAt;
        }

        /*
         * The releases of the earliest and latest occurrences that name one.
         * Ties keep the one already held, so a batch whose occurrences share
         * a time reads its releases in arrival order, as before.
         */
        if (release) {
          if (
            !existing.firstSeenInRelease ||
            occurredAt.getTime() < existing.firstReleaseAt.getTime()
          ) {
            existing.firstSeenInRelease = release;
            existing.firstReleaseAt = occurredAt;
          }

          if (
            !existing.lastSeenInRelease ||
            occurredAt.getTime() > existing.lastReleaseAt.getTime()
          ) {
            existing.lastSeenInRelease = release;
            existing.lastReleaseAt = occurredAt;
          }
        }
        continue;
      }

      out.set(key, {
        projectId: exception.projectId,
        primaryEntityId: exception.primaryEntityId,
        primaryEntityType: exception.primaryEntityType ?? null,
        fingerprint: exception.fingerprint,
        message: exception.message || "",
        stackTrace: exception.stackTrace || "",
        exceptionType: exception.exceptionType || "",
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
        occuranceCount: occurrences,
        firstSeenInRelease: release,
        lastSeenInRelease: release,
        firstReleaseAt: occurredAt,
        lastReleaseAt: occurredAt,
        environment: exception.environment || "",
        unhandled: exception.unhandled === true,
      });
    }

    return out;
  }
}

// Where an occurrence of a merged exception is counted as well.
export interface MergedExceptionSurvivor {
  primaryEntityId: ObjectID;
  fingerprint: string;
}

function mergedExceptionKey(
  projectId: string,
  primaryEntityId: string,
  fingerprint: string,
): string {
  return `${projectId.toLowerCase()}|${primaryEntityId.toLowerCase()}|${fingerprint}`;
}

export interface AggregatedException {
  projectId: ObjectID;
  primaryEntityId: ObjectID;
  primaryEntityType: ServiceType | null;
  fingerprint: string;
  message: string;
  stackTrace: string;
  exceptionType: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occuranceCount: number;
  firstSeenInRelease: string;
  lastSeenInRelease: string;
  // When the occurrences that gave the two releases above happened.
  firstReleaseAt: Date;
  lastReleaseAt: Date;
  environment: string;
  unhandled: boolean;
}

// How many occurrences a payload stands for: one, unless it says more.
function occurrencesOf(exception: TelemetryExceptionPayload): number {
  const count: number = Number(exception.occurrences);

  return Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
}

function pickNonEmpty(current: string, incoming: string | undefined): string {
  if (current && current.length > 0) {
    return current;
  }
  if (incoming && incoming.length > 0) {
    return incoming;
  }
  return current;
}
