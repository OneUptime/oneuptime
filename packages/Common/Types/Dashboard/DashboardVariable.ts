import { DashboardResourceScope } from "./DashboardResourceScope";

export enum DashboardVariableType {
  CustomList = "Custom List",
  Query = "Query",
  TextInput = "Text Input",
  TelemetryAttribute = "Telemetry Attribute",
  ProjectLabel = "Project Labels",
}

export interface DashboardVariableOption {
  label: string;
  value: string;
}

export default interface DashboardVariable {
  id: string;
  name: string;
  label?: string | undefined;
  type: DashboardVariableType;
  // For CustomList: comma-separated values
  customListValues?: string | undefined;
  // Author-selected project label IDs and their published display names.
  labelOptions?: Array<DashboardVariableOption> | undefined;
  // For Query: a ClickHouse query to populate options
  query?: string | undefined;
  /*
   * For TelemetryAttribute: the OpenTelemetry attribute key this
   * variable binds to (e.g. "k8s.cluster.name"). At render time the
   * selected value is injected into any widget filter that targets
   * this attribute key. Options are fetched from the distinct values
   * of this attribute across the current time range.
   */
  attributeKey?: string | undefined;
  /*
   * For TelemetryAttribute: the kind of resource the variable picks among
   * (DashboardResourceScope) - a template's Cluster, Host or vCenter. Every
   * widget the variable applies to reads only that kind's telemetry, "All"
   * meaning all of them, and its picker offers only their names. Left out,
   * "All" filters nothing, as it always has.
   */
  resourceScope?: DashboardResourceScope | undefined;
  // Current selected value(s)
  selectedValue?: string | undefined;
  selectedValues?: Array<string> | undefined;
  // Whether multi-select is enabled
  isMultiSelect?: boolean | undefined;
  // Default value
  defaultValue?: string | undefined;
}
