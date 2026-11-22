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
  getExceptionGroupingKey,
  getExceptionGroupingText,
} from "Common/Server/Utils/Telemetry/ExceptionGrouping";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import { JSONObject } from "Common/Types/JSON";

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
 *    be read.
 */
export interface OccurrenceFingerprints {
  fingerprint: string;
  fingerprintV2: string;
  fingerprintCandidates: Array<string>;
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
 * Whether an exception exists under a fingerprint an occurrence may belong
 * to, by project and fingerprint, for a few minutes: the same few
 * exceptions make most of every batch, and an existing exception never
 * stops existing under its fingerprint. One a batch makes is known to
 * exist from then on. Capped, and cleared whole when full.
 */
const EXISTING_GROUP_CACHE_TTL_MS: number = 10 * 60 * 1000;
export const EXISTING_GROUP_CACHE_MAX_ENTRIES: number = 100000;
const existingGroupCache: Map<string, { exists: boolean; at: number }> =
  new Map();

// Forgets which exceptions exist under which fingerprints (tests).
export function clearExistingV1FingerprintCache(): void {
  existingGroupCache.clear();
}

// Remembers that an exception exists under a fingerprint, within the cap.
function rememberGroupMade(cacheKey: string, at: number): void {
  if (
    existingGroupCache.size >= EXISTING_GROUP_CACHE_MAX_ENTRIES &&
    !existingGroupCache.has(cacheKey)
  ) {
    existingGroupCache.clear();
  }

  existingGroupCache.set(cacheKey, { exists: true, at: at });
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
}

/*
 * The key resolveGroupFingerprints answers a candidate under: its project,
 * its two fingerprints and, when it has them, its candidates.
 */
export function groupFingerprintKey(
  candidate: GroupFingerprintCandidate,
): string {
  const key: string = `${candidate.projectId}|${candidate.v1}|${candidate.v2}`;

  return candidate.candidates
    ? `${key}|${candidate.candidates.join("|")}`
    : key;
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
    return getExceptionGroupingText({
      projectId: data.projectId?.toString() || "",
      primaryEntityId: data.primaryEntityId?.toString() || "",
      key: getExceptionGroupingKey({
        exceptionType: data.exceptionType,
        message: data.message,
        stackTrace: data.stackTrace,
      }),
    });
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
   * When no rule changed it, its fingerprints are grouping v1's and v2's as
   * ever: the exception made before v2 under the first, else the one made
   * under the second - or one made under the keyed fingerprint below, by a
   * copy of it a rule did change (its log record's, while no rule changed
   * its span's; or one from before a rule was removed). None existing, a
   * new exception is made under v2's.
   *
   * When a rule changed it, the same are tried, so an exception that
   * existed before the rule keeps its occurrences. A new one is made under
   * v2's only if what the rule hid is not in the text v2 hashes - a stack
   * trace's frames leave the message out. Otherwise everyone who reads the
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
    const v1: string = ExceptionUtil.getFingerprint(arrived);
    const groupingText: string = ExceptionUtil.getGroupingTextV2(arrived);
    const v2: string = fingerprintSha256(groupingText);
    const keyed: string = KeyedExceptionFingerprint.ofGroupingText({
      projectId: data.projectId,
      text: groupingText,
    });

    if (
      (data.arrived.message || "") === (data.stored.message || "") &&
      (data.arrived.stackTrace || "") === (data.stored.stackTrace || "") &&
      (data.arrived.exceptionType || "") === (data.stored.exceptionType || "")
    ) {
      return {
        fingerprint: v1,
        fingerprintV2: v2,
        fingerprintCandidates: [v1, v2, keyed],
      };
    }

    const stored: ExceptionFingerprintInput = {
      projectId: data.projectId,
      primaryEntityId: data.primaryEntityId,
      message: data.stored.message,
      stackTrace: data.stored.stackTrace,
      exceptionType: data.stored.exceptionType,
    };
    const storedV1: string = ExceptionUtil.getFingerprint(stored);
    const storedV2: string = ExceptionUtil.getFingerprintV2(stored);

    /*
     * Whether what a rule hid is in the text each fingerprint hashes: the
     * text it hashes is the same with it as without it when it is not -
     * left out (the message, beside a stack trace's frames, for v2) or
     * taken out by the normalizer.
     */
    const opens: string = storedV2 === v2 ? v2 : keyed;

    return {
      fingerprint: storedV1 === v1 ? v1 : opens,
      fingerprintV2: opens,
      fingerprintCandidates: Array.from(
        new Set<string>([
          ...(data.findsGroupsOfStoredText ? [storedV1, storedV2] : []),
          v1,
          v2,
          keyed,
        ]),
      ),
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
   * Returns the fingerprint to use, by groupFingerprintKey.
   */
  public static async resolveGroupFingerprints(
    candidates: Array<GroupFingerprintCandidate>,
    now: number = Date.now(),
  ): Promise<Map<string, string>> {
    const chosen: Map<string, string> = new Map();
    // What this read knows: whether an exception exists, by `projectId|fingerprint`.
    const known: Map<string, boolean> = new Map();
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

        const cached: { exists: boolean; at: number } | undefined =
          existingGroupCache.get(cacheKey);

        if (cached && now - cached.at < EXISTING_GROUP_CACHE_TTL_MS) {
          known.set(cacheKey, cached.exists);
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
        const rows: Array<{ fingerprint: string }> =
          await TelemetryExceptionService.getRepository().manager.query(
            `SELECT "fingerprint" FROM "TelemetryException" WHERE "projectId" = $1 AND "fingerprint" = ANY($2::text[]) AND "deletedAt" IS NULL`,
            [projectId, Array.from(fingerprints)],
          );
        const existing: Set<string> = new Set<string>(
          (rows || []).map((row: { fingerprint: string }): string => {
            return row.fingerprint;
          }),
        );

        if (
          existingGroupCache.size + fingerprints.size >
          EXISTING_GROUP_CACHE_MAX_ENTRIES
        ) {
          existingGroupCache.clear();
        }

        for (const fingerprint of fingerprints) {
          const exists: boolean = existing.has(fingerprint);

          known.set(`${projectId}|${fingerprint}`, exists);
          existingGroupCache.set(`${projectId}|${fingerprint}`, {
            exists: exists,
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

    for (const candidate of candidates) {
      const key: string = groupFingerprintKey(candidate);

      if (!candidate.v2 || failedProjects.has(candidate.projectId)) {
        chosen.set(key, candidate.v1);
        continue;
      }

      const found: string | undefined = fingerprintsToTry(candidate).find(
        (fingerprint: string): boolean => {
          return known.get(`${candidate.projectId}|${fingerprint}`) === true;
        },
      );

      if (found !== undefined) {
        chosen.set(key, found);
        continue;
      }

      // A new exception is made under its v2, for the occurrences after it.
      chosen.set(key, candidate.v2);
      known.set(`${candidate.projectId}|${candidate.v2}`, true);
      rememberGroupMade(`${candidate.projectId}|${candidate.v2}`, now);
    }

    return chosen;
  }

  // A row's or a payload's fingerprints, as resolveGroupFingerprints reads them.
  private static candidateOf(data: {
    projectId: string;
    fingerprint: unknown;
    fingerprintV2: unknown;
    fingerprintCandidates: unknown;
  }): GroupFingerprintCandidate | null {
    if (typeof data.fingerprintV2 !== "string" || !data.fingerprintV2) {
      return null;
    }

    const candidates: Array<string> | undefined = readCandidates(
      data.fingerprintCandidates,
    );

    return {
      projectId: data.projectId,
      v1: String(data.fingerprint || ""),
      v2: data.fingerprintV2,
      ...(candidates ? { candidates } : {}),
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
        fingerprint: row["fingerprint"],
        fingerprintV2: row["fingerprintV2"],
        fingerprintCandidates: row["fingerprintCandidates"],
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
        fingerprint: payload.fingerprint,
        fingerprintV2: payload.fingerprintV2,
        fingerprintCandidates: payload.fingerprintCandidates,
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

        return resolved;
      },
    );
  }

  public static getFingerprint(data: ExceptionFingerprintInput): string {
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

    const hash: string = fingerprintSha256(
      projectId +
        primaryEntityId +
        normalizedMessage +
        normalizedStackTrace +
        type,
    );

    return hash;
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
