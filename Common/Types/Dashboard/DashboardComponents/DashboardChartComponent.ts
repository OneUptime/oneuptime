import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardChartComponent extends BaseComponent {
  componentType: DashboardComponentType.Chart;
  componentId: ObjectID;
  arguments: {
    metricsViewConfig?: MetricsViewConfig | undefined;
  };
}
