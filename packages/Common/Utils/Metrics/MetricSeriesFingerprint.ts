import { createHash } from "crypto";
import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import { JSONObject, JSONValue } from "../../Types/JSON";

/*
 * The fingerprints of label sets seen lately, by their canonical text
 * ("key=value|key=value"). A grouped metric monitor fingerprints every raw
 * row it reads - 10,000 a query, over a few hundred series - and the SHA-256
 * was nine tenths of the work, so each series is hashed once and read back
 * after. Bounded both ways: a text longer than
 * FINGERPRINT_MEMO_MAX_TEXT_LENGTH is hashed every time and never kept, and
 * a full memo (FINGERPRINT_MEMO_MAX_ENTRIES texts) is emptied before the
 * next text goes in, so it holds a few megabytes at most.
 *
 * Emptied, not trimmed one entry at a time: a Map keeps the slots of deleted
 * entries until it is rebuilt, so finding the oldest entry over and over
 * walks past more and more of them. With more series than the memo holds -
 * a large cluster grouped by pod - that walk made every row cost twice
 * master's hash. Starting over costs one hash per series at most.
 */
export const FINGERPRINT_MEMO_MAX_ENTRIES: number = 4096;
export const FINGERPRINT_MEMO_MAX_TEXT_LENGTH: number = 512;

const fingerprintMemo: Map<string, string> = new Map<string, string>();

/**
 * Canonicalize a label dictionary (key/value string pairs identifying a
 * metric series) into a stable short hash. Used to key incidents/alerts
 * by the series that breached so one incident is created per host (or
 * per whatever attribute combination the user grouped by) rather than a
 * single incident per monitor.
 */
export default class MetricSeriesFingerprint {
  /**
   * Sentinel fingerprint used when a metric monitor has no group-by
   * configured — i.e. traditional whole-monitor evaluation. Using an
   * explicit sentinel (rather than undefined) lets callers store a
   * single value and still use the same dedupe query shape.
   */
  public static readonly WholeMonitorFingerprint: string = "__all__";

  /**
   * Compute a deterministic 16-char hex fingerprint from a label map.
   * Keys are sorted so `{a,b}` and `{b,a}` hash identically. Null and
   * undefined values canonicalize to the empty string so a series that
   * occasionally drops an attribute still maps to the same bucket.
   */
  public static computeFingerprint(labels: JSONObject): string {
    const keys: Array<string> = Object.keys(labels || {}).sort();

    if (keys.length === 0) {
      return MetricSeriesFingerprint.WholeMonitorFingerprint;
    }

    const parts: Array<string> = [];

    for (const key of keys) {
      const raw: JSONValue | undefined = labels[key];
      const value: string =
        raw === undefined || raw === null ? "" : String(raw);
      parts.push(`${key}=${value}`);
    }

    const canonical: string = parts.join("|");
    const kept: string | undefined = fingerprintMemo.get(canonical);

    if (kept !== undefined) {
      return kept;
    }

    const fingerprint: string = createHash("sha256")
      .update(canonical)
      .digest("hex")
      .slice(0, 16);

    if (canonical.length <= FINGERPRINT_MEMO_MAX_TEXT_LENGTH) {
      if (fingerprintMemo.size >= FINGERPRINT_MEMO_MAX_ENTRIES) {
        fingerprintMemo.clear();
      }

      fingerprintMemo.set(canonical, fingerprint);
    }

    return fingerprint;
  }

  // How many label sets the fingerprint memo holds now (for tests).
  public static getMemoSize(): number {
    return fingerprintMemo.size;
  }

  /**
   * Extract the series labels from an aggregated sample. When
   * `attributeKeys` is provided, pulls those specific keys out of the
   * sample's `attributes` map (OpenTelemetry attributes live nested in
   * a MapStringString column, so users group by "host.name" as an
   * attribute KEY rather than a top-level column). When no keys are
   * provided, falls back to every non-reserved key on the sample so
   * callers that pass top-level group-by columns still work.
   */
  public static extractSeriesLabels(input: {
    sample: AggregatedModel;
    attributeKeys?: Array<string> | undefined;
  }): JSONObject {
    const result: JSONObject = {};

    const sampleAttributes: JSONObject =
      ((input.sample as unknown as JSONObject)["attributes"] as
        | JSONObject
        | undefined) || {};

    if (input.attributeKeys && input.attributeKeys.length > 0) {
      for (const key of input.attributeKeys) {
        const value: JSONValue | undefined = sampleAttributes[key];
        if (value !== undefined && value !== null) {
          result[key] = value;
        } else {
          /*
           * Preserve the key even when missing so the fingerprint stays
           * stable across evaluations that happen to drop the attribute.
           */
          result[key] = "";
        }
      }
      return result;
    }

    for (const key of Object.keys(input.sample)) {
      if (key === "timestamp" || key === "value") {
        continue;
      }
      const value: unknown = (input.sample as unknown as JSONObject)[key];
      if (value === undefined || value === null) {
        continue;
      }
      result[key] = value as JSONValue;
    }
    return result;
  }
}
