import Zod, { ZodSchema } from "../../../Utils/Schema/Zod";

/**
 * Per-criteria configuration that lets a single Incoming Request /
 * webhook monitor open MULTIPLE concurrent incidents — one per distinct
 * value extracted from the incoming payload — instead of the default
 * one-active-incident-per-criteria behaviour.
 *
 * This is what makes a single Grafana/Alertmanager webhook endpoint fan
 * out into separate incidents ("High RAM Usage", "High CPU Usage", ...)
 * that can all be active at the same time. Under the hood the extracted
 * value is hashed into the same `seriesFingerprint` dedupe key that
 * metric monitors already use for per-series incidents, so the existing
 * create + dedupe machinery handles the rest.
 *
 * When this is absent on a criteria, the monitor behaves exactly as
 * before (one active incident per criteria) — the feature is strictly
 * opt-in.
 */
export default interface IncidentGroupingConfig {
  /**
   * Path into the incoming request body used to derive the grouping /
   * dedupe key. Uses the same `requestBody`-rooted convention as incident
   * templates and JavaScript-expression filters; both of these resolve
   * identically (the `{{ … }}` template wrapper is optional):
   *
   *   `{{requestBody.alerts[*].labels.alertname}}`
   *   `requestBody.alerts[*].labels.alertname`
   *
   * The `requestBody` root is required. Supports dotted paths and array
   * indexing (`[0]`, `[last]`) per the
   * shared `VMUtil.deepFind` syntax, plus a single `[*]` wildcard to fan
   * out over an array — one incident per element. For Grafana's
   * Alertmanager-shaped webhook this is typically
   * `requestBody.alerts[*].labels.alertname` or
   * `requestBody.commonLabels.alertname`.
   */
  groupByJSONPath: string;

  /**
   * Optional explicit "resolved" classifier for event-driven sources.
   * Webhooks are event-driven: a single POST describes only the alerts in
   * that payload, not the full set of everything currently firing, so an
   * incident must NOT be auto-resolved merely because its key is absent
   * from a later payload (that's the snapshot model metric monitors use).
   * Instead, when the value at `resolvedWhenJSONPath` equals
   * `resolvedWhenValue`, the event resolves the incident for that key.
   *
   * Uses the same `requestBody`-rooted convention as `groupByJSONPath`.
   * For Grafana this is `requestBody.status` == `resolved` (payload-level),
   * or `requestBody.alerts[*].status` == `resolved` when `groupByJSONPath`
   * also fans out over `alerts[*]` (the resolve check is then evaluated per
   * element).
   *
   * When unset, every matching event is treated as firing and grouped
   * incidents are only ever resolved manually.
   */
  resolvedWhenJSONPath?: string | undefined;
  resolvedWhenValue?: string | undefined;

  /**
   * Safety cap on the number of distinct keys processed from a single
   * payload. Protects against a high-cardinality field (or a key that
   * changes every fire) spawning unbounded incidents. Defaults to 100.
   */
  maxKeysPerPayload?: number | undefined;
}

export const IncidentGroupingConfigSchema: ZodSchema = Zod.object({
  groupByJSONPath: Zod.string(),
  resolvedWhenJSONPath: Zod.string().optional(),
  resolvedWhenValue: Zod.string().optional(),
  maxKeysPerPayload: Zod.number().optional(),
});
