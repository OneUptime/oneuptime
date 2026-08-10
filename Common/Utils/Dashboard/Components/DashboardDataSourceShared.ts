import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { DataSourceValueReduce } from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";

/*
 * Reduction picker shared by the Data Source Value and Gauge widgets — both
 * collapse a series into one number the same way, so the option list (and
 * its wording) lives in one place.
 */
export const DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS: Array<DropdownOption> = [
  { label: "Last value", value: DataSourceValueReduce.Last },
  { label: "First value", value: DataSourceValueReduce.First },
  { label: "Average", value: DataSourceValueReduce.Avg },
  { label: "Sum", value: DataSourceValueReduce.Sum },
  { label: "Min", value: DataSourceValueReduce.Min },
  { label: "Max", value: DataSourceValueReduce.Max },
];
