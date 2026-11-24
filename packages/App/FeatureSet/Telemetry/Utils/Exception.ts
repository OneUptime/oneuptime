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
  getExceptionGroupingText,
  isChangedOnlyWhereFolded,
} from "Common/Server/Utils/Telemetry/ExceptionGrouping";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import TelemetryExceptionRekey, {
  ExceptionRekeyResult,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionRekey";
import { JSONObject } from "Common/Types/JSON";
import { writeOwnValue } from "Common/Utils/LookupTable";

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
 *  - `fingerprint`: the one it keeps when the project's exceptions cannot
 *    be read;
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
   * The exception's group. Built as the one kept when the exceptions cannot
   * be read (OccurrenceFingerprints), with the one a new exception is made
   * under and the candidates beside it, until assignGroupFingerprints picks
   * which one the occurrence belongs to.
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
}

/*
 * What is known of a fingerprint an occurrence may belong to: whether an
 * exception exists under it, and, when the row under it only keeps the
 * former fingerprint of an exception OneUptime moved to a private one
 * (#10619), that exception's fingerprint now, where its occurrences go.
 */
interface KnownGroup {
  exists: boolean;
  movedTo?: string | undefined;
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

// Forgets which exceptions exist under which fingerprints (tests).
export function clearExistingV1FingerprintCache(): void {
  existingGroupCache.clear();
  refusedMoves.clear();
  recordedSplits.clear();
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
 * former fingerprint (#10619).
 */
export const GROUP_FINGERPRINT_LOOKUP_SQL: string = `SELECT t."fingerprint" AS "fingerprint", o."fingerprint" AS "movedTo" FROM "TelemetryException" t LEFT JOIN "TelemetryException" o ON o."_id" = t."formerFingerprintOfTelemetryExceptionId" AND o."deletedAt" IS NULL WHERE t."projectId" = $1 AND t."fingerprint" = ANY($2::text[]) AND t."deletedAt" IS NULL`;

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
   * The texts the grouping v2 and v3 fingerprints hash, from one reading of
   * the stack trace: v3's is v2's for an exception grouped by its frames
   * (ExceptionGrouping.getExceptionGroupingKeyV3).
   */
  public static getGroupingTexts(data: ExceptionFingerprintInput): {
    v2: string;
    v3: string;
  } {
    const projectId: string = data.projectId?.toString() || "";
    const primaryEntityId: string = data.primaryEntityId?.toString() || "";
    const keyV2: ExceptionGroupingKey = getExceptionGroupingKey({
      exceptionType: data.exceptionType,
      message: data.message,
      stackTrace: data.stackTrace,
    });
    const keyV3: ExceptionGroupingKey = getExceptionGroupingKeyV3(keyV2);
    const v2: string = getExceptionGroupingText({
      projectId,
      primaryEntityId,
      key: keyV2,
    });

    return {
      v2,
      v3:
        keyV3 === keyV2
          ? v2
          : getExceptionGroupingText({
              projectId,
              primaryEntityId,
              key: keyV3,
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
   * When no rule changed it, its fingerprints are grouping v1's, v2's and
   * v3's: the exception made before v2 under the first, else the one made
   * under the second, else the third - or one made under the keyed
   * fingerprint of one of them, by a copy of it a rule did change (its log
   * record's, while no rule changed its span's; or one from before a rule
   * was removed). None existing, a new exception is made under v3's.
   *
   * When a rule changed it, the same are tried, so an exception that
   * existed before the rule keeps its occurrences. A new one is made under
   * v3's only if what the rule hid is not in the text v3 hashes - a stack
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
   * what the rule now hides. Each fingerprint that does, of v1's, v2's and
   * v3's, is named in `fingerprintRekeys` with the keyed fingerprint of the
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
   * AND NEW EXCEPTIONS ARE GROUPED BY V3 (#10620): v2, with the card numbers
   * in groups, Social Security and phone numbers a message holds taken out.
   * v3 and its keyed fingerprint are tried after v2's, so an exception made
   * before keeps the occurrences it had - each value it was made for - and
   * the values seen since go to one exception. For an exception grouped by
   * its frames, v3's fingerprints are v2's.
   */
  public static getOccurrenceFingerprints(data: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    arrived: ExceptionGroupingContent;
    stored: ExceptionGroupingContent;
    findsGroupsOfStoredText?: boolean | undefined;
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
    const texts: { v2: string; v3: string } =
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

    // The exceptions made as each version was the newest, tried oldest first.
    const ofArrived: Array<string> = [v1, keyedV1, v2, keyedV2, v3, keyedV3];

    if (
      (data.arrived.message || "") === (data.stored.message || "") &&
      (data.arrived.stackTrace || "") === (data.stored.stackTrace || "") &&
      (data.arrived.exceptionType || "") === (data.stored.exceptionType || "")
    ) {
      return {
        fingerprint: v1,
        fingerprintV2: v3,
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
    const storedTexts: { v2: string; v3: string } =
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

    // A new exception is made under v3, or its keyed fingerprint.
    const opens: string = revealsV3 ? keyedV3 : v3;

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

    // What a log was grouped by before #10434: the text the rules left.
    const ofStored: Array<string> = data.findsGroupsOfStoredText
      ? [fingerprintSha256(storedV1Text), fingerprintSha256(storedTexts.v2)]
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
   * not cached. When it fails, the occurrence keeps its `v1`, never lost:
   * its grouping v1 fingerprint, grouped as before v2, unless a scrub rule
   * hid part of what that one hashes (getOccurrenceFingerprints).
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
   * Returns the fingerprint to use, by groupFingerprintKey.
   */
  public static async resolveGroupFingerprints(
    candidates: Array<GroupFingerprintCandidate>,
    now: number = Date.now(),
  ): Promise<Map<string, string>> {
    const chosen: Map<string, string> = new Map();
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
          known.set(cacheKey, {
            exists: cached.exists,
            ...(cached.movedTo ? { movedTo: cached.movedTo } : {}),
          });
          continue;
        }

        const fingerprints: Set<string> =
          toLookUp.get(candidate.projectId) || new Set<string>();
        fingerprints.add(fingerprint);
        toLookUp.set(candidate.projectId, fingerprints);
      }
    }

    const failedProjects: Set<string> = new Set<string>();

    for (const [projectId, fingerprints] of toLookUp) {
      try {
        const rows: Array<{ fingerprint: string; movedTo?: string | null }> =
          await TelemetryExceptionService.getRepository().manager.query(
            GROUP_FINGERPRINT_LOOKUP_SQL,
            [projectId, Array.from(fingerprints)],
          );
        const existing: Map<string, KnownGroup> = new Map();

        for (const row of rows || []) {
          existing.set(row.fingerprint, {
            exists: true,
            ...(row.movedTo ? { movedTo: row.movedTo } : {}),
          });
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
      } catch (err) {
        failedProjects.add(projectId);
        logger.warn(
          `Could not read which exceptions of project ${projectId} keep their first fingerprint; the batch is grouped as before grouping v2: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // The exceptions to move to a private fingerprint, each once (#10619).
    const moves: Map<string, ExceptionMove> = new Map();
    // The pairs of exceptions a rule split before #10434, each once (#10618).
    const splits: Map<string, ExceptionSplitPair> = new Map();
    // And the occurrences that go wherever each one moves, by their key.
    const occurrencesOfMove: Map<string, Array<string>> = new Map();

    for (const candidate of candidates) {
      const key: string = groupFingerprintKey(candidate);

      if (!candidate.v2 || failedProjects.has(candidate.projectId)) {
        chosen.set(key, candidate.v1);
        continue;
      }

      const found: string | undefined = fingerprintsToTry(candidate).find(
        (fingerprint: string): boolean => {
          return (
            known.get(`${candidate.projectId}|${fingerprint}`)?.exists === true
          );
        },
      );

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

    return chosen;
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

  // The same, for the exception group upserts of a batch.
  public static async assignPayloadGroupFingerprints(
    payloads: Array<TelemetryExceptionPayload>,
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

    const chosen: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints(candidates);

    return payloads.map(
      (payload: TelemetryExceptionPayload): TelemetryExceptionPayload => {
        const candidate: GroupFingerprintCandidate | null =
          candidateOfPayload(payload);

        if (!candidate) {
          return payload;
        }

        const resolved: TelemetryExceptionPayload = {
          ...payload,
          fingerprint:
            chosen.get(groupFingerprintKey(candidate)) || payload.fingerprint,
        };

        delete resolved.fingerprintV2;
        delete resolved.fingerprintCandidates;
        delete resolved.fingerprintRekeys;
        delete resolved.fingerprintsOfStoredText;

        return resolved;
      },
    );
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
    if (!exceptions || exceptions.length === 0) {
      return;
    }

    /*
     * An occurrence of a merged exception counts on the one it was merged
     * into as well (resolveMergedExceptions): the batch gains a copy of it
     * under the survivor's key before it is aggregated.
     */
    /*
     * Each occurrence is grouped by the fingerprint of the exception it
     * belongs to (assignPayloadGroupFingerprints), and then an occurrence of
     * a merged exception counts on the one it was merged into as well
     * (withMergedSurvivors).
     */
    const aggregated: Map<string, AggregatedException> =
      ExceptionUtil.aggregateExceptions(
        await ExceptionUtil.withMergedSurvivors(
          await ExceptionUtil.assignPayloadGroupFingerprints(exceptions),
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

      const existing: AggregatedException | undefined = out.get(key);
      if (existing) {
        existing.occuranceCount += 1;
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
        occuranceCount: 1,
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

function pickNonEmpty(current: string, incoming: string | undefined): string {
  if (current && current.length > 0) {
    return current;
  }
  if (incoming && incoming.length > 0) {
    return incoming;
  }
  return current;
}
