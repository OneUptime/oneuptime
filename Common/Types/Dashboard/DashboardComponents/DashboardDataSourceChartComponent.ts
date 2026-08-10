import DataSourceQueryConfig from "../../DataSource/DataSourceQueryConfig";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import DashboardChartType from "../Chart/ChartType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * Time-series chart over one or more EXTERNAL Data Source queries (PromQL /
 * SQL / LogQL / ES DSL / REST). The OneUptime-metrics chart is a separate
 * widget (DashboardChartComponent) — this one never touches metric queries,
 * formulas, or the metric explorer.
 *
 * Not available on public dashboards: the anonymous API has no data-source
 * surface, by design.
 */
export default interface DashboardDataSourceChartComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DataSourceChart;
  componentId: ObjectID;
  arguments: {
    // Each query becomes one overlaid set of series on the chart.
    queries?: Array<DataSourceQueryConfig> | undefined;
    chartTitle?: string | undefined;
    chartDescription?: string | undefined;
    chartType?: DashboardChartType | undefined;
  };
}
