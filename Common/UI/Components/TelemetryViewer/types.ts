/*
 * Generic types for the TelemetryViewer shell. Shared by logs, traces,
 * metrics, and exceptions viewers.
 */

export interface FacetValue {
  value: string;
  count: number;
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
