export enum DashboardVariableType {
  CustomList = "Custom List",
  Query = "Query",
  TextInput = "Text Input",
}

export default interface DashboardVariable {
  id: string;
  name: string;
  label?: string | undefined;
  type: DashboardVariableType;
  // For CustomList: comma-separated values
  customListValues?: string | undefined;
  // For Query: a ClickHouse query to populate options
  query?: string | undefined;
  // Current selected value(s)
  selectedValue?: string | undefined;
  selectedValues?: Array<string> | undefined;
  // Whether multi-select is enabled
  isMultiSelect?: boolean | undefined;
  // Default value
  defaultValue?: string | undefined;
}
