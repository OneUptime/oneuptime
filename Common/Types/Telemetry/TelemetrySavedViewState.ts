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
  // Active facet filters as [facetKey, value] tuples.
  filters?: Array<[string, string]> | undefined;
  // Selected time range.
  timeRange?: TelemetrySavedViewTimeRange | undefined;
  // Rows per page.
  pageSize?: number | undefined;
}
