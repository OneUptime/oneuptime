import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardValueComponent extends BaseComponent {
  componentType: DashboardComponentType.Value;
  componentId: ObjectID;
  arguments: {
    metricQueryConfig?: MetricQueryConfigData | undefined;
    title: string;
  };
}
