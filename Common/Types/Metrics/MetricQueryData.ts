import Metric from "../../Models/AnalyticsModels/Metric";
import FilterData from "../../UI/Components/Filters/Types/FilterData";
import GroupBy from "../BaseDatabase/GroupBy";
import MetricsQuery from "./MetricsQuery";

export default interface MetricQueryData {
  filterData: FilterData<MetricsQuery>;
  groupBy?: GroupBy<Metric> | undefined;
}
