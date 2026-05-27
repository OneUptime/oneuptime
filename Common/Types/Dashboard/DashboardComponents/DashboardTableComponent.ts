import MetricFormulaConfigData from "../../Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../Metrics/MetricsAggregationType";
import ObjectID from "../../ObjectID";
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
     * Legacy widget shape from before the columns/groupByAttributes
     * redesign — read-only at render time, never written by the editor.
     */
    metricQueryConfig?: MetricQueryConfigData | undefined;
    metricQueryConfigs?: Array<MetricQueryConfigData> | undefined;
    metricFormulaConfigs?: Array<MetricFormulaConfigData> | undefined;
  };
}
