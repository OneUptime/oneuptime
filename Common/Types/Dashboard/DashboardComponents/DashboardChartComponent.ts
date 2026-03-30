import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import DashboardChartType from "../Chart/ChartType";
import BaseComponent from "./DashboardBaseComponent";

export interface ChartThreshold {
  value: number;
  label?: string | undefined;
  color?: string | undefined;
}

export default interface DashboardChartComponent extends BaseComponent {
  componentType: DashboardComponentType.Chart;
  componentId: ObjectID;
  arguments: {
    metricQueryConfig?: MetricQueryConfigData | undefined;
    metricQueryConfigs?: Array<MetricQueryConfigData> | undefined;
    chartTitle?: string | undefined;
    chartDescription?: string | undefined;
    chartType?: DashboardChartType | undefined;
    warningThreshold?: number | undefined;
    criticalThreshold?: number | undefined;
  };
}
