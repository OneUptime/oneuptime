import { ObjectType } from "../../JSON";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardChartComponent extends BaseComponent {
  _type: ObjectType.DashboardChartComponent;
  componentId: ObjectID;
  arguments: {
    metricsViewConfig?: MetricsViewConfig | undefined;
  }
}
