import DataSourceQueryConfig from "../../DataSource/DataSourceQueryConfig";
import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardGaugeComponent extends BaseComponent {
  componentType: DashboardComponentType.Gauge;
  componentId: ObjectID;
  arguments: {
    metricQueryConfig?: MetricQueryConfigData | undefined;
    /*
     * External Data Source query. When set, the widget renders it INSTEAD
     * of metricQueryConfig. Not available on public dashboards.
     */
    dataSourceQueryConfig?: DataSourceQueryConfig | undefined;
    gaugeTitle?: string | undefined;
    minValue?: number | undefined;
    maxValue?: number | undefined;
    warningThreshold?: number | undefined;
    criticalThreshold?: number | undefined;
  };
}
