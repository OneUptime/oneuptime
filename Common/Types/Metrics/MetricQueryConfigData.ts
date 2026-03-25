import AggregatedModel from "../BaseDatabase/AggregatedModel";
import MetricAliasData from "./MetricAliasData";
import MetricQueryData from "./MetricQueryData";

export enum MetricChartType {
  LINE = "line",
  BAR = "bar",
  AREA = "area",
}

export interface ChartSeries {
  title: string;
}

export default interface MetricQueryConfigData {
  metricAliasData?: MetricAliasData | undefined;
  metricQueryData: MetricQueryData;
  getSeries?: ((data: AggregatedModel) => ChartSeries) | undefined;
  chartType?: MetricChartType | undefined;
  yAxisValueFormatter?: ((value: number) => string) | undefined;
}
