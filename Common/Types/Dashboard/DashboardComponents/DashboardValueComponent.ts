import { ObjectType } from "../../JSON";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardValueComponent extends BaseComponent {
  _type: ObjectType.DashboardValueComponent;
  componentId: ObjectID;
  arguments: {
    metricsViewConfig?: MetricsViewConfig | undefined;
  }
}
