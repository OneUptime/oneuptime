import { JSONObject } from "../JSON";

/*
 * Serializable view state for the Metrics and Traces explorers. Stored in the
 * `query` JSONB column of MetricSavedView / TraceSavedView. This is the same
 * state each viewer already mirrors to the URL (search string, facet filter
 * tuples, time range, page size), so capture/apply reuses logic that is proven
 * to round-trip.
 */

export interface TelemetrySavedViewTimeRange {
  // A TimeRange enum value (e.g. "Past one hour", "Custom").
  range: string;
  // ISO strings — only present when range is "Custom".
  startValue?: string | undefined;
  endValue?: string | undefined;
}

export default interface TelemetrySavedViewState {
  // Submitted search string from the explorer search bar.
  search?: string | undefined;
  /*
   * Active facet filters as [facetKey, value] tuples.
   *
   * Read these with readSavedViewFilters (Common/Utils/Telemetry/
   * SavedViewFilters) rather than destructuring them. Rows written before
   * JSONFunctions.serializeValue learned to preserve nested arrays hold
   * { "0": facetKey, "1": value } instead, and destructuring one of those
   * throws — which is what this type asserting otherwise once cost us.
   */
  filters?: Array<[string, string]> | undefined;
  // Selected time range.
  timeRange?: TelemetrySavedViewTimeRange | undefined;
  // Rows per page.
  pageSize?: number | undefined;
  /*
   * Traces explorer: which spans the view lists - a TraceSpanType ("entry",
   * "root" or "all"). Read it with readTraceSpanTypeFromSavedView
   * (Types/Telemetry/TraceSpanType), which reads views saved before it by
   * their `rootOnly`.
   */
  spanType?: string | undefined;
  /*
   * Traces explorer, before spanType: the root-spans-only toggle. true is
   * Root spans; false is every span, which is what a view saved with it off
   * showed. Still written (true exactly for Root spans) for readers that
   * only know it.
   */
  rootOnly?: boolean | undefined;
  /*
   * Metrics explorer: the full chart-builder state — MetricsViewConfig-
   * shaped { queryConfigs, formulaConfigs } plus a time-range token.
   * Kept loosely typed like the rest of this state: the explorer owns
   * serialization and must deserialize defensively.
   */
  explorerConfig?: JSONObject | undefined;
}
