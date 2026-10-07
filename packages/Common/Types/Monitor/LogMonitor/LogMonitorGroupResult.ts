import { JSONObject, JSONValue } from "../../JSON";

/**
 * One group within a grouped Logs monitor evaluation: the logs in the
 * window that share one combination of the monitor's group-by attribute
 * values (e.g. every IPsec "terminated" line for con_name = HQ-Branch1).
 *
 * Each group is evaluated against the criteria on its own count, and a
 * breaching group raises its own alert/incident - the same per-series
 * path a grouped metric monitor's MetricSeriesResult takes.
 */
export default interface LogMonitorGroupResult {
  /*
   * MetricSeriesFingerprint.computeFingerprint(labels): the identity the
   * group's alert or incident is stored and deduplicated under, stable
   * across evaluations for the same attribute values.
   */
  fingerprint: string;
  /*
   * Group-by attribute key -> the value these logs carry. A log that does
   * not carry the attribute is counted under "" (as is one whose value is
   * empty), the same way a metric series missing a label is.
   */
  labels: JSONObject;
  logCount: number;
}

/** Longest a group value is shown in a message before it is cut. */
const MaxGroupValueLengthInMessage: number = 100;

export class LogMonitorGroupResultUtil {
  /*
   * The group as a reader names it: `con_name = HQ-Branch1, gw_name =
   * WAN2`. A value the logs did not carry reads "(not set)" rather than
   * as nothing at all. Plain text - Markdown callers escape it.
   */
  public static describeGroup(labels: JSONObject | undefined): string {
    const parts: Array<string> = [];

    for (const key of Object.keys(labels || {})) {
      const rawValue: JSONValue | undefined = labels?.[key];
      let value: string =
        rawValue === undefined || rawValue === null ? "" : String(rawValue);

      if (value.length > MaxGroupValueLengthInMessage) {
        value = `${value.slice(0, MaxGroupValueLengthInMessage)}...`;
      }

      parts.push(`${key} = ${value.length > 0 ? value : "(not set)"}`);
    }

    return parts.join(", ");
  }
}
