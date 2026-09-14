/*
 * Scope a span query to the spans that raised one exception group.
 *
 * Spans carry no fingerprint of their own; an exception group's occurrences
 * (ExceptionInstance rows) record the (traceId, spanId) they were raised in.
 * The server compiles this scope to
 *
 *   (traceId, spanId) IN (
 *     SELECT traceId, spanId FROM <exception occurrences>
 *     WHERE projectId = <the query's project>
 *       AND fingerprint = <fingerprint>
 *       [AND primaryEntityId = <service>]
 *   )
 *
 * so the span list, its count, the histogram and the facets all describe
 * exactly the spans behind the exception's occurrences — with no cap on how
 * many occurrences there are. It only ever narrows a query: authorization
 * still runs on the span query's own projectId and primaryEntityId.
 */

// The synthetic query key the span list endpoint reads.
export const EXCEPTION_SPAN_SCOPE_QUERY_KEY: string = "exceptionScope";

// Fingerprints are SHA-256 hex today; the cap only rejects junk.
export const EXCEPTION_SPAN_SCOPE_MAX_FINGERPRINT_LENGTH: number = 512;

export interface ExceptionSpanScope {
  fingerprint: string;
  // The exception group's service; a fingerprint is only unique per service.
  primaryEntityId?: string | undefined;
}

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Validate an untrusted scope (request body, deserialized query). Returns
 * null for anything malformed so callers can decide how to fail; a blank or
 * oversized fingerprint, or a service id that is not a UUID, is malformed.
 */
export function parseExceptionSpanScope(
  value: unknown,
): ExceptionSpanScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const fingerprint: unknown = record["fingerprint"];

  if (typeof fingerprint !== "string") {
    return null;
  }

  const trimmedFingerprint: string = fingerprint.trim();

  if (
    trimmedFingerprint.length === 0 ||
    trimmedFingerprint.length > EXCEPTION_SPAN_SCOPE_MAX_FINGERPRINT_LENGTH
  ) {
    return null;
  }

  const rawEntityId: unknown = record["primaryEntityId"];

  if (rawEntityId === undefined || rawEntityId === null || rawEntityId === "") {
    return { fingerprint: trimmedFingerprint };
  }

  const primaryEntityId: string =
    typeof rawEntityId === "string"
      ? rawEntityId.trim()
      : typeof rawEntityId === "object" &&
          typeof (rawEntityId as Record<string, unknown>)["value"] === "string"
        ? ((rawEntityId as Record<string, unknown>)["value"] as string).trim()
        : "";

  if (!UUID_PATTERN.test(primaryEntityId)) {
    return null;
  }

  return { fingerprint: trimmedFingerprint, primaryEntityId };
}
