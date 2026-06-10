import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Crypto from "Common/Utils/Crypto";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import logger from "Common/Server/Utils/Logger";

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
}

/*
 * Per-batch parameter footprint: 12 columns x rows. Postgres caps a
 * single statement at 65535 placeholders, so 500 rows = 6000 params
 * gives us plenty of headroom while matching the chunk size used by
 * KubernetesResourceService.bulkUpsert (the precedent this batch
 * upsert is modelled on).
 */
const TELEMETRY_EXCEPTION_UPSERT_BATCH_SIZE: number = 500;

export default class ExceptionUtil {
  /**
   * Normalizes a string by replacing dynamic values with placeholders.
   * This ensures that exceptions with the same root cause but different
   * dynamic values (like IDs, timestamps, etc.) get the same fingerprint.
   *
   * @param text - The text to normalize (message or stack trace)
   * @returns The normalized text with dynamic values replaced
   */
  public static normalizeForFingerprint(text: string): string {
    if (!text) {
      return "";
    }

    let normalized: string = text;

    // Order matters! More specific patterns should come before generic ones.

    // 1. UUIDs (e.g., 550e8400-e29b-41d4-a716-446655440000)
    normalized = normalized.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<UUID>",
    );

    // 2. MongoDB ObjectIDs (24 hex characters)
    normalized = normalized.replace(/\b[0-9a-f]{24}\b/gi, "<OBJECT_ID>");

    /*
     * 3. Stripe-style IDs (e.g., sub_xxx, cus_xxx, pi_xxx, ch_xxx, etc.)
     * These have a prefix followed by underscore and alphanumeric characters
     */
    normalized = normalized.replace(
      /\b(sub|cus|pi|ch|pm|card|price|prod|inv|txn|evt|req|acct|payout|ba|btok|src|tok|seti|si|cs|link|file|dp|icr|ii|il|is|isci|mbur|or|po|qt|rcpt|re|refund|sku|tax|txi|tr|us|wh)_[A-Za-z0-9]{10,32}\b/g,
      "<STRIPE_ID>",
    );

    /*
     * 4. Generic API/Service IDs - alphanumeric strings that look like IDs
     * Matches patterns like: prefix_alphanumeric or just long alphanumeric strings
     * Common in many services (AWS, GCP, etc.)
     */
    normalized = normalized.replace(
      /\b[a-z]{2,10}_[A-Za-z0-9]{8,}\b/g,
      "<SERVICE_ID>",
    );

    // 5. JWT tokens (three base64 segments separated by dots)
    normalized = normalized.replace(
      /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g,
      "<JWT>",
    );

    // 6. Base64 encoded strings (long sequences, likely tokens or encoded data)
    normalized = normalized.replace(
      /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
      "<BASE64>",
    );

    // 7. IP addresses (IPv4)
    normalized = normalized.replace(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
      "<IP>",
    );

    // 8. IP addresses (IPv6) - simplified pattern
    normalized = normalized.replace(
      /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
      "<IPV6>",
    );
    normalized = normalized.replace(/\b::1\b/g, "<IPV6>"); // localhost IPv6

    // 9. Email addresses
    normalized = normalized.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      "<EMAIL>",
    );

    /*
     * 10. URLs with dynamic paths/query params (normalize the dynamic parts)
     * Keep the domain but normalize path segments that look like IDs
     */
    normalized = normalized.replace(
      /\/[0-9a-f]{8,}(?=\/|$|\?|#|\s|'|")/gi,
      "/<ID>",
    );

    /*
     * 11. Timestamps in various formats
     * ISO 8601 timestamps
     */
    normalized = normalized.replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
      "<TIMESTAMP>",
    );
    // Unix timestamps (10 or 13 digits)
    normalized = normalized.replace(/\b1[0-9]{9,12}\b/g, "<TIMESTAMP>");

    // 12. Date formats (YYYY-MM-DD, MM/DD/YYYY, etc.)
    normalized = normalized.replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, "<DATE>");
    normalized = normalized.replace(/\b\d{2}[-/]\d{2}[-/]\d{4}\b/g, "<DATE>");

    // 13. Time formats (HH:MM:SS, HH:MM)
    normalized = normalized.replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, "<TIME>");

    // 14. Memory addresses (0x followed by hex)
    normalized = normalized.replace(/\b0x[0-9a-fA-F]+\b/g, "<MEMORY_ADDR>");

    // 15. Session IDs (common patterns) - MUST come before hex ID pattern
    normalized = normalized.replace(
      /\bsession[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
      "session_id=<SESSION>",
    );

    // 16. Request IDs (common patterns) - MUST come before hex ID pattern
    normalized = normalized.replace(
      /\brequest[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
      "request_id=<REQUEST>",
    );

    // 17. Correlation IDs - MUST come before hex ID pattern
    normalized = normalized.replace(
      /\bcorrelation[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
      "correlation_id=<CORRELATION>",
    );

    // 18. Transaction IDs - MUST come before hex ID pattern
    normalized = normalized.replace(
      /\btransaction[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
      "transaction_id=<TRANSACTION>",
    );

    // 19. Hex strings that are likely IDs (8+ chars)
    normalized = normalized.replace(/\b[0-9a-f]{8,}\b/gi, "<HEX_ID>");

    /*
     * 20. Quoted strings containing IDs or dynamic values
     * Match strings in single or double quotes that look like IDs
     */
    normalized = normalized.replace(/'[A-Za-z0-9_-]{16,}'/g, "'<ID>'");
    normalized = normalized.replace(/"[A-Za-z0-9_-]{16,}"/g, '"<ID>"');

    // 21. Port numbers in URLs or connection strings
    normalized = normalized.replace(/:(\d{4,5})(?=\/|$|\s)/g, ":<PORT>");

    /*
     * 22. Line numbers in stack traces (keep for context, but normalize large numbers)
     * This normalizes specific line/column references that might vary
     */
    normalized = normalized.replace(/:\d+:\d+\)?$/gm, ":<LINE>:<COL>)");

    // 23. Process/Thread IDs
    normalized = normalized.replace(/\bPID[:\s]*\d+\b/gi, "PID:<PID>");
    normalized = normalized.replace(/\bTID[:\s]*\d+\b/gi, "TID:<TID>");

    // 24. Numeric IDs in common patterns (id=123, id: 123, etc.)
    normalized = normalized.replace(/\bid[=:\s]*['"]?\d+['"]?/gi, "id=<ID>");

    // 25. Large numbers that are likely IDs (more than 6 digits)
    normalized = normalized.replace(/\b\d{7,}\b/g, "<NUMBER>");

    return normalized;
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
   *   - Uses GREATEST / LEAST on the timestamps so out-of-order
   *     delivery (a stale job processed after a fresher one) does
   *     not regress lastSeenAt / firstSeenAt.
   *   - Preserves the legacy "new occurrence un-resolves the row"
   *     behaviour by clearing markedAsResolved* and setting
   *     isResolved=false in the conflict branch.
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

    const rows: Array<AggregatedException> = Array.from(aggregated.values());

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
         * column list below. 13 placeholders per row: projectId,
         * primaryEntityId, fingerprint, message, stackTrace,
         * exceptionType, firstSeenAt, lastSeenAt, occuranceCount,
         * firstSeenInRelease, lastSeenInRelease, environment,
         * primaryEntityType.
         */
        const placeholders: Array<string> = [];
        for (let c: number = 0; c < 13; c++) {
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
        );
      }

      const sql: string = `
        INSERT INTO "TelemetryException" (
          "projectId", "primaryEntityId", "fingerprint",
          "message", "stackTrace", "exceptionType",
          "firstSeenAt", "lastSeenAt", "occuranceCount",
          "firstSeenInRelease", "lastSeenInRelease", "environment",
          "primaryEntityType",
          "isResolved", "isArchived", "version"
        )
        SELECT
          v."projectId"::uuid, v."primaryEntityId"::uuid, v."fingerprint",
          v."message", v."stackTrace", v."exceptionType",
          v."firstSeenAt"::timestamptz, v."lastSeenAt"::timestamptz,
          v."occuranceCount"::int,
          v."firstSeenInRelease", v."lastSeenInRelease", v."environment",
          v."primaryEntityType",
          false, false, 0
        FROM (VALUES ${valueFragments.join(", ")})
          AS v(
            "projectId", "primaryEntityId", "fingerprint",
            "message", "stackTrace", "exceptionType",
            "firstSeenAt", "lastSeenAt", "occuranceCount",
            "firstSeenInRelease", "lastSeenInRelease", "environment",
            "primaryEntityType"
          )
        ON CONFLICT ("projectId", "primaryEntityId", "fingerprint")
        DO UPDATE SET
          "occuranceCount" =
            "TelemetryException"."occuranceCount" + EXCLUDED."occuranceCount",
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
          "lastSeenInRelease" = COALESCE(
            NULLIF(EXCLUDED."lastSeenInRelease", ''),
            "TelemetryException"."lastSeenInRelease"
          ),
          "environment" = COALESCE(
            NULLIF(EXCLUDED."environment", ''),
            "TelemetryException"."environment"
          ),
          "primaryEntityType" = COALESCE(
            "TelemetryException"."primaryEntityType",
            EXCLUDED."primaryEntityType"
          ),
          "markedAsResolvedByUserId" = NULL,
          "markedAsResolvedAt" = NULL,
          "isResolved" = false,
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
   */
  private static aggregateExceptions(
    exceptions: Array<TelemetryExceptionPayload>,
  ): Map<string, AggregatedException> {
    const now: Date = new Date();
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

      const existing: AggregatedException | undefined = out.get(key);
      if (existing) {
        existing.occuranceCount += 1;
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
        existing.lastSeenInRelease = pickNonEmpty(
          existing.lastSeenInRelease,
          exception.release,
        );
        existing.firstSeenInRelease = pickNonEmpty(
          existing.firstSeenInRelease,
          exception.release,
        );
        existing.environment = pickNonEmpty(
          existing.environment,
          exception.environment,
        );
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
        firstSeenAt: now,
        lastSeenAt: now,
        occuranceCount: 1,
        firstSeenInRelease: exception.release || "",
        lastSeenInRelease: exception.release || "",
        environment: exception.environment || "",
      });
    }

    return out;
  }
}

interface AggregatedException {
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
  environment: string;
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
