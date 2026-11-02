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
  /*
   * The fingerprints of the exceptions merged into this one
   * (TelemetryExceptionMerge): their spans are this exception's too.
   */
  mergedFingerprints?: Array<string> | undefined;
}

// The most merged fingerprints a scope carries.
export const EXCEPTION_SPAN_SCOPE_MAX_MERGED_FINGERPRINTS: number = 100;

// The scope's fingerprints: its own, then the merged ones.
export function getExceptionSpanScopeFingerprints(
  scope: ExceptionSpanScope,
): Array<string> {
  const fingerprints: Array<string> = [scope.fingerprint];

  for (const fingerprint of scope.mergedFingerprints || []) {
    if (!fingerprints.includes(fingerprint)) {
      fingerprints.push(fingerprint);
    }
  }

  return fingerprints;
}

// The merged fingerprints of an untrusted scope: strings of a fingerprint's length, bounded.
function readMergedFingerprints(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const fingerprints: Array<string> = [];

  for (const entry of value.slice(
    0,
    EXCEPTION_SPAN_SCOPE_MAX_MERGED_FINGERPRINTS,
  )) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed: string = entry.trim();

    if (
      trimmed.length > 0 &&
      trimmed.length <= EXCEPTION_SPAN_SCOPE_MAX_FINGERPRINT_LENGTH &&
      !fingerprints.includes(trimmed)
    ) {
      fingerprints.push(trimmed);
    }
  }

  return fingerprints;
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
  const mergedFingerprints: Array<string> = readMergedFingerprints(
    record["mergedFingerprints"],
  ).filter((fingerprint: string): boolean => {
    return fingerprint !== trimmedFingerprint;
  });
  const merged: { mergedFingerprints?: Array<string> } =
    mergedFingerprints.length > 0 ? { mergedFingerprints } : {};

  if (rawEntityId === undefined || rawEntityId === null || rawEntityId === "") {
    return { fingerprint: trimmedFingerprint, ...merged };
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

  return { fingerprint: trimmedFingerprint, primaryEntityId, ...merged };
}
