import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Crypto from "Common/Utils/Crypto";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import logger from "Common/Server/Utils/Logger";
import { normalizeExceptionText } from "Common/Server/Utils/Telemetry/ExceptionSanitizer";

export interface ExceptionFingerprintInput {
  message?: string;
  stackTrace?: string;
  exceptionType?: string;
  projectId?: ObjectID;
  primaryEntityId?: ObjectID;
}

export interface TelemetryExceptionPayload {
  fingerprint: string;
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

    const hash: string = Crypto.getSha256Hash(
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

    const aggregated: Map<string, AggregatedException> =
      ExceptionUtil.aggregateExceptions(exceptions);

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

      const sql: string = `
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
      `;

      try {
        await TelemetryExceptionService.getRepository().manager.query(
          sql,
          params,
        );
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
    }
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
