export enum DashboardVariableType {
  CustomList = "Custom List",
  Query = "Query",
  TextInput = "Text Input",
  TelemetryAttribute = "Telemetry Attribute",
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
  /*
   * For TelemetryAttribute: the OpenTelemetry attribute key this
   * variable binds to (e.g. "k8s.cluster.name"). At render time the
   * selected value is injected into any widget filter that targets
   * this attribute key. Options are fetched from the distinct values
   * of this attribute across the current time range.
   */
  attributeKey?: string | undefined;
  /*
   * For TelemetryAttribute: optional metric name to scope the option
   * lookup to. When set, the dropdown lists distinct attribute values
   * observed on that metric only (e.g. distinct `k8s.pod.name` values
   * emitted by `k8s.container.cpu_usage`). Leave undefined to list
   * values across every metric in the project.
   */
  metricName?: string | undefined;
  // Current selected value(s)
  selectedValue?: string | undefined;
  selectedValues?: Array<string> | undefined;
  // Whether multi-select is enabled
  isMultiSelect?: boolean | undefined;
  // Default value
  defaultValue?: string | undefined;
}
