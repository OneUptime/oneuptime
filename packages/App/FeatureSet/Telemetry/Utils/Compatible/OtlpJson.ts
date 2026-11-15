import { JSONObject } from "Common/Types/JSON";

/*
 * THE OTLP JSON EVERY COMPATIBLE ENDPOINT WRITES.
 *
 * The endpoints that speak another tool's protocol - Prometheus remote
 * write, Loki's push API, Splunk's HTTP Event Collector, Datadog's intake,
 * Sentry's envelopes - each turn what they are sent into an OTLP export
 * request (ExportLogsServiceRequest, ExportMetricsServiceRequest,
 * ExportTraceServiceRequest) in OTLP's JSON encoding, which is queued
 * exactly as an OTLP/HTTP export is. From there it is the same telemetry:
 * drop filters, scrub rules, pipelines, services, retention and billing
 * apply to it as to anything an OpenTelemetry SDK sends.
 *
 * These are the pieces of that encoding they share: attributes (an int64
 * is a decimal string; a trace or span ID is lower-case hex), times in
 * nanoseconds as decimal strings, and severities as OpenTelemetry numbers.
 */

export interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpSeverity {
  number: number;
  text: string;
}

export const OTLP_SEVERITY_TRACE: OtlpSeverity = { number: 1, text: "TRACE" };
export const OTLP_SEVERITY_DEBUG: OtlpSeverity = { number: 5, text: "DEBUG" };
export const OTLP_SEVERITY_INFO: OtlpSeverity = { number: 9, text: "INFO" };
export const OTLP_SEVERITY_INFO2: OtlpSeverity = { number: 10, text: "INFO2" };
export const OTLP_SEVERITY_WARN: OtlpSeverity = { number: 13, text: "WARN" };
export const OTLP_SEVERITY_ERROR: OtlpSeverity = { number: 17, text: "ERROR" };
export const OTLP_SEVERITY_ERROR2: OtlpSeverity = {
  number: 18,
  text: "ERROR2",
};
export const OTLP_SEVERITY_ERROR3: OtlpSeverity = {
  number: 19,
  text: "ERROR3",
};
export const OTLP_SEVERITY_FATAL: OtlpSeverity = { number: 21, text: "FATAL" };
export const OTLP_SEVERITY_UNSPECIFIED: OtlpSeverity = { number: 0, text: "" };

/*
 * The level words the tools write, as OpenTelemetry severities: the
 * syslog names (Splunk, Loki and Datadog all use them), the short forms
 * loggers write, and Datadog's "ok" / "success" for a passing check.
 * Matched in lower case, after trimming.
 */
const SEVERITY_BY_WORD: ReadonlyMap<string, OtlpSeverity> = new Map<
  string,
  OtlpSeverity
>([
  ["trace", OTLP_SEVERITY_TRACE],
  ["trc", OTLP_SEVERITY_TRACE],
  ["verbose", OTLP_SEVERITY_TRACE],
  ["debug", OTLP_SEVERITY_DEBUG],
  ["dbg", OTLP_SEVERITY_DEBUG],
  ["info", OTLP_SEVERITY_INFO],
  ["inf", OTLP_SEVERITY_INFO],
  ["information", OTLP_SEVERITY_INFO],
  ["informational", OTLP_SEVERITY_INFO],
  ["log", OTLP_SEVERITY_INFO],
  ["ok", OTLP_SEVERITY_INFO],
  ["success", OTLP_SEVERITY_INFO],
  ["notice", OTLP_SEVERITY_INFO2],
  ["warn", OTLP_SEVERITY_WARN],
  ["warning", OTLP_SEVERITY_WARN],
  ["wrn", OTLP_SEVERITY_WARN],
  ["error", OTLP_SEVERITY_ERROR],
  ["err", OTLP_SEVERITY_ERROR],
  ["eror", OTLP_SEVERITY_ERROR],
  ["critical", OTLP_SEVERITY_ERROR2],
  ["crit", OTLP_SEVERITY_ERROR2],
  ["alert", OTLP_SEVERITY_ERROR3],
  ["fatal", OTLP_SEVERITY_FATAL],
  ["ftl", OTLP_SEVERITY_FATAL],
  ["panic", OTLP_SEVERITY_FATAL],
  ["emerg", OTLP_SEVERITY_FATAL],
  ["emergency", OTLP_SEVERITY_FATAL],
]);

// A value's own JSON, at most this deep, before it is kept as one string.
const MAX_FLATTEN_DEPTH: number = 8;

const HEX_DIGITS: RegExp = /^[0-9a-fA-F]+$/;

// Seconds as Splunk and Datadog write them: digits, and an optional fraction.
const DECIMAL_SECONDS: RegExp = /^\d+(\.\d+)?$/;
// A number JavaScript writes in exponent form (1e-7, 1e+21).
const EXPONENT: RegExp = /e/i;
// OTLP's "no ID".
const ALL_ZEROS: RegExp = /^0+$/;
// At most an unsigned 64-bit integer's 20 decimal digits.
const UINT64_DIGITS: RegExp = /^\d{1,20}$/;

export default class OtlpJson {
  /*
   * One attribute, typed as OTLP types it: a string as stringValue, an
   * integer as intValue (a decimal string, as OTLP JSON writes an int64), a
   * fraction as doubleValue, a boolean as boolValue. A value that is none
   * of these - null, an object, NaN, an infinity - is no attribute.
   */
  public static attribute(key: string, value: unknown): OtlpKeyValue | null {
    if (!key) {
      return null;
    }

    if (typeof value === "string") {
      return { key: key, value: { stringValue: value } };
    }

    if (typeof value === "boolean") {
      return { key: key, value: { boolValue: value } };
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return null;
      }

      if (Number.isSafeInteger(value)) {
        return { key: key, value: { intValue: String(value) } };
      }

      return { key: key, value: { doubleValue: value } };
    }

    if (typeof value === "bigint") {
      return { key: key, value: { intValue: value.toString() } };
    }

    return null;
  }

  // A string attribute, or none for an empty value.
  public static stringAttribute(
    key: string,
    value: string | undefined | null,
  ): OtlpKeyValue | null {
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }

    return { key: key, value: { stringValue: value } };
  }

  /*
   * Pushes each attribute that is one (attribute() and stringAttribute()
   * return null for a value that is not) onto the list, so a builder can
   * write its attributes one line each.
   */
  public static pushAll(
    attributes: Array<OtlpKeyValue>,
    ...candidates: Array<OtlpKeyValue | null>
  ): void {
    for (const candidate of candidates) {
      if (candidate) {
        attributes.push(candidate);
      }
    }
  }

  /*
   * A record's fields as attributes: nested objects flattened with dots
   * ("http.request.method"), arrays and anything nested past
   * MAX_FLATTEN_DEPTH kept as their JSON, nulls left out. `prefix` names
   * the whole record ("fields" -> "fields.user.id"); `skip` leaves out
   * top-level keys the caller has already read into the record elsewhere
   * (its body, its time, its level).
   */
  public static attributesFromObject(
    record: JSONObject,
    options?: {
      prefix?: string | undefined;
      skip?: ReadonlySet<string> | undefined;
    },
  ): Array<OtlpKeyValue> {
    const attributes: Array<OtlpKeyValue> = [];

    OtlpJson.flattenInto(
      attributes,
      record,
      options?.prefix || "",
      options?.skip,
      0,
    );

    return attributes;
  }

  private static flattenInto(
    attributes: Array<OtlpKeyValue>,
    record: JSONObject,
    prefix: string,
    skip: ReadonlySet<string> | undefined,
    depth: number,
  ): void {
    for (const key of Object.keys(record)) {
      if (depth === 0 && skip && skip.has(key)) {
        continue;
      }

      const value: unknown = record[key];
      const attributeKey: string = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        const json: string | null = OtlpJson.toJson(value);

        if (json !== null) {
          attributes.push({ key: attributeKey, value: { stringValue: json } });
        }

        continue;
      }

      if (typeof value === "object") {
        if (depth + 1 >= MAX_FLATTEN_DEPTH) {
          const json: string | null = OtlpJson.toJson(value);

          if (json !== null) {
            attributes.push({
              key: attributeKey,
              value: { stringValue: json },
            });
          }

          continue;
        }

        OtlpJson.flattenInto(
          attributes,
          value as JSONObject,
          attributeKey,
          undefined,
          depth + 1,
        );
        continue;
      }

      const attribute: OtlpKeyValue | null = OtlpJson.attribute(
        attributeKey,
        value,
      );

      if (attribute) {
        attributes.push(attribute);
      }
    }
  }

  // Milliseconds since the epoch, as the nanoseconds OTLP counts in.
  public static millisecondsToUnixNano(milliseconds: number): string {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      return "0";
    }

    const whole: number = Math.trunc(milliseconds);
    const fraction: number = Math.round((milliseconds - whole) * 1_000_000);

    return (
      BigInt(whole) * BigInt(1_000_000) +
      BigInt(Math.min(fraction, 999_999))
    ).toString();
  }

  /*
   * Seconds since the epoch - whole or fractional, a number or a decimal
   * string, as Splunk and Datadog write them - as nanoseconds. The
   * fraction is read from the digits when it is a string, so
   * "1426279439.123456789" keeps all nine.
   */
  public static secondsToUnixNano(seconds: number | string): string | null {
    if (typeof seconds === "number") {
      if (!Number.isFinite(seconds) || seconds < 0) {
        return null;
      }

      return OtlpJson.secondsToUnixNano(OtlpJson.plainDecimal(seconds));
    }

    const text: string = seconds.trim();

    if (!DECIMAL_SECONDS.test(text)) {
      return null;
    }

    const [whole, fraction] = text.split(".") as [string, string | undefined];
    const nanos: string = (fraction || "").slice(0, 9).padEnd(9, "0");

    return (BigInt(whole) * BigInt(1_000_000_000) + BigInt(nanos)).toString();
  }

  // A number as plain decimal digits, never in exponent form.
  private static plainDecimal(value: number): string {
    const text: string = String(value);

    if (!EXPONENT.test(text)) {
      return text;
    }

    return value.toFixed(9).replace(/\.?0+$/, "");
  }

  // Now, in nanoseconds since the epoch.
  public static nowUnixNano(nowInMs?: number | undefined): string {
    return OtlpJson.millisecondsToUnixNano(nowInMs ?? Date.now());
  }

  // A level word as an OpenTelemetry severity; UNSPECIFIED when unknown.
  public static severityFromWord(word: unknown): OtlpSeverity {
    if (typeof word !== "string") {
      return OTLP_SEVERITY_UNSPECIFIED;
    }

    return (
      SEVERITY_BY_WORD.get(word.trim().toLowerCase()) ||
      OTLP_SEVERITY_UNSPECIFIED
    );
  }

  /*
   * A syslog severity (0 emergency .. 7 debug), as Splunk and Datadog
   * number them, as an OpenTelemetry severity.
   */
  public static severityFromSyslogNumber(value: number): OtlpSeverity {
    const SYSLOG: Array<OtlpSeverity> = [
      OTLP_SEVERITY_FATAL,
      OTLP_SEVERITY_ERROR3,
      OTLP_SEVERITY_ERROR2,
      OTLP_SEVERITY_ERROR,
      OTLP_SEVERITY_WARN,
      OTLP_SEVERITY_INFO2,
      OTLP_SEVERITY_INFO,
      OTLP_SEVERITY_DEBUG,
    ];

    if (!Number.isInteger(value) || value < 0 || value >= SYSLOG.length) {
      return OTLP_SEVERITY_UNSPECIFIED;
    }

    return SYSLOG[value]!;
  }

  /*
   * A trace or span ID as OTLP JSON writes it - lower-case hex of exactly
   * `length` digits (32 for a trace, 16 for a span) - or "" for anything
   * that is not one, or is all zeros (OTLP's "no ID"). Shorter hex is
   * zero-padded on the left, as a 64-bit trace ID becomes a 128-bit one.
   */
  public static hexId(value: unknown, length: number): string {
    if (typeof value !== "string") {
      return "";
    }

    const text: string = value.trim().replace(/-/g, "");

    if (!text || text.length > length || !HEX_DIGITS.test(text)) {
      return "";
    }

    const padded: string = text.toLowerCase().padStart(length, "0");

    return ALL_ZEROS.test(padded) ? "" : padded;
  }

  /*
   * An unsigned 64-bit integer written in decimal (Datadog's trace and
   * span IDs) as 16 hex digits, or "" when it is not one.
   */
  public static decimalIdToHex(value: unknown): string {
    let text: string;

    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value <= 0) {
        return "";
      }

      text = String(value);
    } else if (typeof value === "string") {
      text = value.trim();
    } else if (typeof value === "bigint") {
      text = value.toString();
    } else {
      return "";
    }

    if (!UINT64_DIGITS.test(text)) {
      return "";
    }

    const id: bigint = BigInt(text);

    if (id === BigInt(0) || id > BigInt("18446744073709551615")) {
      return "";
    }

    return id.toString(16).padStart(16, "0");
  }

  private static toJson(value: unknown): string | null {
    try {
      const json: string | undefined = JSON.stringify(value);
      return typeof json === "string" ? json : null;
    } catch {
      return null;
    }
  }
}
