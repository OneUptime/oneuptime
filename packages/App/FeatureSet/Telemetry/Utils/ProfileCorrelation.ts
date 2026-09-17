import Dictionary from "Common/Types/Dictionary";
import Text from "Common/Types/Text";

/*
 * Trace correlation for profile ingest.
 *
 * Shared between the OTLP profiles path (OtelProfilesIngestService, where
 * these keys are the fallback when a sample carries no link-table entry)
 * and the Pyroscope path (PyroscopeIngestService, where labels are the
 * ONLY place an SDK can put trace context — pprof has no link table).
 * Keeping one key list is what guarantees a `trace_id` label means the
 * same thing regardless of which wire format delivered the profile.
 */

/*
 * Common attribute/label keys that agents use to carry OTel trace
 * correlation alongside a profile. Checked in order; first usable value
 * wins.
 */
export const TRACE_ID_KEYS: Array<string> = [
  "trace_id",
  "traceId",
  "trace.id",
  "profile.trace_id",
  "profile.traceId",
  "resource.trace_id",
  "resource.traceId",
  "resource.trace.id",
];

export const SPAN_ID_KEYS: Array<string> = [
  "span_id",
  "spanId",
  "span.id",
  "profile.span_id",
  "profile.spanId",
  "resource.span_id",
  "resource.spanId",
  "resource.span.id",
];

/*
 * A trace or span id of all zeros is the OTel convention for "unset".
 * Length sanity check rejects obvious junk (trace = 32 hex chars,
 * span = 16 hex chars, but agents occasionally emit shorter forms — we
 * only filter the all-zero case).
 */
export function isEmptyHexId(value: string): boolean {
  if (!value) {
    return true;
  }
  const allZerosRegex: RegExp = /^0+$/;
  return allZerosRegex.test(value);
}

function toCandidateString(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "number" || typeof raw === "bigint") {
    return raw.toString();
  }
  return "";
}

export function findCorrelationValue(
  source: Dictionary<unknown>,
  keys: Array<string>,
): string {
  for (const key of keys) {
    const candidate: string = toCandidateString(source[key]);
    if (candidate && !isEmptyHexId(candidate)) {
      return candidate;
    }
  }
  return "";
}

/*
 * Exactly the id shapes OTLP/JSON puts on the wire: 16 hex chars (8-byte
 * span id) or 32 hex chars (16-byte trace/profile id).
 */
const STRICT_HEX_ID_REGEX: RegExp = /^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{32})$/;

/*
 * Normalize an id carried in a LABEL (Pyroscope tags, pprof sample
 * labels) to the lowercase hex the Span/Profile tables store.
 *
 * Label values are operator-typed text, not wire-encoded ids, so unlike
 * Text.convertOtlpIdToHex this must NOT fall back to base64 decoding: an
 * arbitrary tag value satisfies the base64 alphabet and would decode into
 * garbage bytes that then "correlate" with nothing. Only an exact 16- or
 * 32-char hex string is accepted; it then flows through the SAME
 * convertOtlpIdToHex the OTLP link-table path uses, so both paths render
 * an id identically (lowercased).
 */
export function normalizeHexIdFromLabel(value: string): string {
  const trimmed: string = value.trim();

  if (!STRICT_HEX_ID_REGEX.test(trimmed)) {
    return "";
  }

  const hex: string = Text.convertOtlpIdToHex(trimmed);

  if (!hex || isEmptyHexId(hex)) {
    return "";
  }

  return hex;
}

/*
 * findCorrelationValue with hex validation per candidate: a key whose
 * value is not a valid id is SKIPPED rather than terminating the scan, so
 * `trace_id: "garbage"` cannot shadow a well-formed `traceId` label.
 */
export function findHexCorrelationValue(
  source: Dictionary<unknown>,
  keys: Array<string>,
): string {
  for (const key of keys) {
    const candidate: string = toCandidateString(source[key]);

    if (!candidate) {
      continue;
    }

    const normalized: string = normalizeHexIdFromLabel(candidate);

    if (normalized) {
      return normalized;
    }
  }
  return "";
}
