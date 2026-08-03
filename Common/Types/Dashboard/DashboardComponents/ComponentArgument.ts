import DashboardBaseComponent from "./DashboardBaseComponent";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

export enum ComponentInputType {
  Text = "Text",
  Date = "Date",
  DateTime = "Date Time",
  Boolean = "True or False",
  Number = "Number",
  Decimal = "Decimal",
  MetricsQueryConfig = "MetricsQueryConfig",
  MetricsQueryConfigs = "MetricsQueryConfigs",
  MetricsFormulaConfigs = "MetricsFormulaConfigs",
  TableColumns = "TableColumns",
  TableGroupBy = "TableGroupBy",
  LongText = "Long Text",
  Dropdown = "Dropdown",
  MultiSelectDropdown = "MultiSelectDropdown",
  EntityDropdown = "EntityDropdown",
  EntityMultiSelectDropdown = "EntityMultiSelectDropdown",
  // Monaco code editors, one per language.
  Html = "Html",
  Css = "Css",
  JavaScript = "JavaScript",
}

export enum EntityFilterModelType {
  IncidentSeverity = "IncidentSeverity",
  AlertSeverity = "AlertSeverity",
  IncidentState = "IncidentState",
  AlertState = "AlertState",
  MonitorStatus = "MonitorStatus",
  Monitor = "Monitor",
  ServiceLevelObjective = "ServiceLevelObjective",
  Label = "Label",
  KubernetesCluster = "KubernetesCluster",
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  ProxmoxCluster = "ProxmoxCluster",
  CephCluster = "CephCluster",
  DockerSwarmCluster = "DockerSwarmCluster",
}

export interface ComponentArgumentSection {
  name: string;
  description?: string | undefined;
  icon?: string | undefined;
  defaultCollapsed?: boolean | undefined;
  order: number;
}

export interface ComponentArgument<T extends DashboardBaseComponent> {
  name: string;
  description: string;
  required: boolean;
  type: ComponentInputType;
  id: keyof T["arguments"];
  isAdvanced?: boolean | undefined;
  placeholder?: string | undefined;
  dropdownOptions?: Array<DropdownOption> | undefined;
  section?: ComponentArgumentSection | undefined;
  entityFilterModelType?: EntityFilterModelType | undefined;
}
