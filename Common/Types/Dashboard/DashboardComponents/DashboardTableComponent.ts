import MetricFormulaConfigData from "../../Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
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

export default interface DashboardTableComponent extends BaseComponent {
  componentType: DashboardComponentType.Table;
  componentId: ObjectID;
  arguments: {
    metricQueryConfig?: MetricQueryConfigData | undefined;
    metricQueryConfigs?: Array<MetricQueryConfigData> | undefined;
    metricFormulaConfigs?: Array<MetricFormulaConfigData> | undefined;
    tableTitle?: string | undefined;
    tableDescription?: string | undefined;
    maxRows?: number | undefined;
    reduce?: TableReduce | undefined;
    decimals?: number | undefined;
  };
}
