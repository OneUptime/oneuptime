import { LockedFilterDetail } from "../../../Types/Telemetry/LockedFilterDetail";
import IconProp from "../../../Types/Icon/IconProp";

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
  /*
   * For a read-only chip: its search syntax (or why there is none), shown in
   * the chip's tooltip. Display only.
   */
  lockedDetail?: LockedFilterDetail | undefined;
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
  // Hover text for the legend entry, e.g. what a status name means.
  description?: string | undefined;
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
  // Optional icon shown beside the section title (e.g. resource brand icon).
  icon?: IconProp | undefined;
  /*
   * When true, the sidebar folds the section away while it has no values,
   * no active selection and no search in progress, and counts it in the
   * "N empty filters hidden" footer instead. Meant for resource facets,
   * where an empty list means the project has no resource of that type.
   */
  hideWhenEmpty?: boolean | undefined;
  // Plural noun used in the empty state once revealed ("Docker Hosts").
  emptyStateNoun?: string | undefined;
  /*
   * A choice of exactly one value that the explorer keeps itself, rather
   * than in chips: the traces explorer's Span Type (Entry, Root or All
   * spans). Its rows are radio buttons. This value is drawn chosen whether
   * or not a chip names it, a click on another value is handed to
   * onFacetInclude, a click on the chosen one does nothing, and no value can
   * be excluded. Every value the facet answers with is listed, even under a
   * page's locked scope.
   */
  chosenValue?: string | undefined;
  /*
   * What the facet is about, in one or two plain sentences (English, drawn
   * in the reader's language). Never spelled out under the title, where a
   * paragraph pushed the values down the sidebar: an (i) beside the title
   * shows it on hover, keyboard focus or a tap, and a screen reader hears it
   * as the (i)'s description.
   */
  description?: string | undefined;
  /*
   * What each value is, value -> one plain sentence (English, drawn in the
   * reader's language): the Span Type's "Where a trace starts." for Root
   * spans. The (i) beside the title lists every one under its value's name,
   * and a described value's row says its own on hover and keyboard focus,
   * and to a screen reader as the row's description.
   */
  valueDescriptionMap?: Record<string, string> | undefined;
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
  /*
   * A word or two after the name, in the reader's language - a hunt's
   * schedule, say. Drawn where "default" is, so a default view shows that.
   */
  detail?: string | undefined;
}
