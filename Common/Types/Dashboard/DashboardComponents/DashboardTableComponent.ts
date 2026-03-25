import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardTableComponent extends BaseComponent {
  componentType: DashboardComponentType.Table;
  componentId: ObjectID;
  arguments: {
    metricQueryConfig?: MetricQueryConfigData | undefined;
    tableTitle?: string | undefined;
    maxRows?: number | undefined;
  };
}
