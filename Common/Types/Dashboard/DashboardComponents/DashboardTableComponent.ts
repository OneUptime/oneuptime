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
  // User-facing column header.
  header: string;
  kind: TableColumnKind;
  // kind === Metric:
  metricName?: string | undefined;
  aggregation?: MetricsAggregationType | undefined;
  // kind === Formula: expression referencing other columns' variables, e.g. "(a / b) * 100".
  formula?: string | undefined;
  // Per-cell formatting (both kinds).
  decimals?: number | undefined;
  suffix?: string | undefined;
}

export default interface DashboardTableComponent extends BaseComponent {
  componentType: DashboardComponentType.Table;
  componentId: ObjectID;
  arguments: {
    // New shape: columns + widget-level group-by.
    columns?: Array<TableColumn> | undefined;
    groupByAttributeKeys?: Array<string> | undefined;
    // Common display options.
    tableTitle?: string | undefined;
    tableDescription?: string | undefined;
    maxRows?: number | undefined;
    reduce?: TableReduce | undefined;
    decimals?: number | undefined;
    /*
     * Legacy shape (kept for backward compatibility with widgets saved
     * before the columns/groupByAttributeKeys redesign — read-only at
     * render time, never written by the editor).
     */
    metricQueryConfig?: MetricQueryConfigData | undefined;
    metricQueryConfigs?: Array<MetricQueryConfigData> | undefined;
    metricFormulaConfigs?: Array<MetricFormulaConfigData> | undefined;
  };
}
