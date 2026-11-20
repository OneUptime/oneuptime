import { JSONObject } from "../../JSON";

/**
 * One group within a grouped Traces monitor evaluation (#9711): the spans
 * in the window that share one combination of the monitor's group-by
 * attribute values - every span of one install of a mobile app, say.
 *
 * Each group is evaluated against the criteria on its own count, and a
 * breaching group raises its own alert or incident, as a grouped Logs
 * monitor's group does (LogMonitorGroupResult).
 */
export default interface TraceMonitorGroupResult {
  /*
   * MetricSeriesFingerprint.computeFingerprint(labels): the identity the
   * group's alert or incident is stored and deduplicated under, stable
   * across evaluations for the same attribute values.
   */
  fingerprint: string;
  // Group-by attribute key -> the value these spans carry.
  labels: JSONObject;
  spanCount: number;
  /*
   * A group seen in the week before the window and with no span in it
   * (TraceGroupAbsence): counted as 0, as a device that stopped reporting
   * is.
   */
  isQuiet?: boolean | undefined;
}
