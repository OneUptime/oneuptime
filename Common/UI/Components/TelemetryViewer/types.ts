/*
 * Generic types for the TelemetryViewer shell. Shared by logs, traces,
 * metrics, and exceptions viewers.
 */

export interface FacetValue {
  value: string;
  count: number;
  /*
   * Optional server-resolved display name. Set by the backend when the facet
   * value is resolved against a source-of-truth table (e.g. serviceId →
   * service name). Falls back to the parent's valueDisplayMap if not present.
   */
  displayName?: string | undefined;
}

export type FacetData = Record<string, Array<FacetValue>>;

export interface ActiveFilter {
  facetKey: string;
  value: string;
  displayKey: string;
  displayValue: string;
  readOnly?: boolean | undefined;
}

export interface HistogramBucket {
  time: string;
  /*
   * Series key used to color and stack the bucket (e.g. severity, statusCode,
   * level). Each viewer decides what this means via histogramSeries config.
   */
  series: string;
  count: number;
}

export interface HistogramSeriesOption {
  key: string;
  label: string;
  // Hex fill color used for the bar segment and the legend swatch.
  color: string;
}

export interface LiveOptions {
  isLive: boolean;
  onToggle: (next: boolean) => void;
  isDisabled?: boolean;
}

export interface FacetConfig {
  // Backing field key (e.g. "serviceId", "statusCode").
  key: string;
  // Human-readable section title.
  title: string;
  // Optional value → display name map (e.g. serviceId → service name).
  valueDisplayMap?: Record<string, string> | undefined;
  // Optional value → hex color map (e.g. severity colors).
  valueColorMap?: Record<string, string> | undefined;
  // Ordering priority: lower = shown first.
  priority?: number | undefined;
  /*
   * When true, the section's search box also emits typed text to the
   * sidebar's `onFacetSearchChange` callback so the parent can refetch
   * values from the backend (used for resource facets backed by Postgres).
   */
  serverSearchable?: boolean | undefined;
}

export interface SearchHelpRow {
  syntax: string;
  description: string;
  example: string;
}

export interface SavedViewOption {
  id: string;
  name: string;
  isDefault?: boolean;
}
