import MetricFormulaConfigData from "../../Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../Metrics/MetricsAggregationType";
import ObjectID from "../../ObjectID";
import Dictionary from "../../Dictionary";
import { DictionaryEntryValue } from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export enum TableReduce {
  Last = "Last",
  Avg = "Avg",
  Sum = "Sum",
  Min = "Min",
  Max = "Max",
}

export enum TableColumnKind {
  Metric = "Metric",
  Formula = "Formula",
}

/*
 * Which way a column's values go bad (issue #5231). Higher is worse - CPU,
 * memory or disk in use, errors, latency - reaches a threshold at or above
 * it; lower is worse - free space, availability, throughput - at or below
 * it.
 */
export enum TableThresholdDirection {
  HigherIsWorse = "HigherIsWorse",
  LowerIsWorse = "LowerIsWorse",
}

/*
 * How a value past a threshold is colored, for the whole table: the number
 * itself (the default), or the whole cell behind it.
 */
export enum TableThresholdStyle {
  Text = "Text",
  Background = "Background",
}

// The level a value has reached, worst last.
export enum TableThresholdLevel {
  Warning = "Warning",
  Critical = "Critical",
}

/*
 * A column's thresholds, in the unit the column shows: a usage metric that
 * OpenTelemetry sends as a fraction (unit "1", a name such as
 * system.cpu.utilization) shows - and is compared - as a percent. Either
 * threshold may be left out; with neither, the column is not colored.
 */
export interface TableColumnThresholds {
  warning?: number | undefined;
  critical?: number | undefined;
  // HigherIsWorse when left out.
  direction?: TableThresholdDirection | undefined;
}

export interface TableColumn {
  /*
   * Stable identifier so React keys survive reorder and the form can
   * match inputs to the column being edited.
   */
  id: string;
  // Single-letter variable (a, b, c, ...) that formulas can reference.
  variable: string;
  // User-facing column header (used only when showAsColumn !== false).
  header: string;
  kind: TableColumnKind;
  /*
   * When false, the metric/formula is still fetched (so formulas can
   * reference it by variable) but it does not render a visible column.
   * Default: true.
   */
  showAsColumn?: boolean | undefined;
  // kind === Metric:
  metricName?: string | undefined;
  aggregation?: MetricsAggregationType | undefined;
  // kind === Formula: expression referencing other variables, e.g. "(a / b) * 100".
  formula?: string | undefined;
  // Per-cell formatting (both kinds).
  decimals?: number | undefined;
  /*
   * Unit to render after each cell value (e.g. "%", "MB", "ms").
   * Empty/undefined = Auto: for metric columns, falls back to the metric
   * type's native unit; for formula columns, no unit is rendered.
   */
  unit?: string | undefined;
  /*
   * Colors the column's values amber at the warning threshold and red at
   * the critical one (issue #5231). Left out, the column is not colored.
   */
  thresholds?: TableColumnThresholds | undefined;
}

export interface TableGroupByAttribute {
  // OTel attribute key, e.g. "host.name" or "resource.k8s.pod.name".
  key: string;
  // Optional user-friendly header. When unset, the key is shown as-is.
  header?: string | undefined;
}

export default interface DashboardTableComponent extends BaseComponent {
  componentType: DashboardComponentType.Table;
  componentId: ObjectID;
  arguments: {
    // New shape: columns + widget-level group-by.
    columns?: Array<TableColumn> | undefined;
    // New shape — attribute + optional custom header. Source of truth.
    groupByAttributes?: Array<TableGroupByAttribute> | undefined;
    /*
     * Legacy shape from before per-attribute headers. Read at render
     * time if `groupByAttributes` is absent. Never written by the editor.
     */
    groupByAttributeKeys?: Array<string> | undefined;
    // Common display options.
    tableTitle?: string | undefined;
    tableDescription?: string | undefined;
    maxRows?: number | undefined;
    reduce?: TableReduce | undefined;
    decimals?: number | undefined;
    /*
     * How every column's thresholds color a value past them: the number
     * (Text, when left out) or the whole cell (Background).
     */
    thresholdStyle?: TableThresholdStyle | undefined;
    /*
     * Widget-level attribute filter applied to EVERY metric column's query
     * (e.g. deployment.environment = production, so the table only shows
     * hosts/services in that environment). Stored in the same operator-aware
     * shape the chart widget writes into filterData.attributes, so it flows
     * straight through MetricUtil.fetchResults' sanitizeAttributeFilters with
     * no backend changes. Empty/undefined = no filter (every series shown).
     */
    attributeFilters?: Dictionary<DictionaryEntryValue> | undefined;
    /*
     * Legacy widget shape from before the columns/groupByAttributes
     * redesign — read-only at render time, never written by the editor.
     */
    metricQueryConfig?: MetricQueryConfigData | undefined;
    metricQueryConfigs?: Array<MetricQueryConfigData> | undefined;
    metricFormulaConfigs?: Array<MetricFormulaConfigData> | undefined;
  };
}
