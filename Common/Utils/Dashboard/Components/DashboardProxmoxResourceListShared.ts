import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { getViewModeArgument } from "./DashboardListSharedArgs";

export const ProxmoxDisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

export const ProxmoxFiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which resources are shown",
  order: 2,
  defaultCollapsed: true,
};

export function getProxmoxCommonArguments<
  T extends DashboardBaseComponent,
>(): Array<ComponentArgument<T>> {
  const args: Array<ComponentArgument<T>> = [];

  args.push({
    name: "Title",
    description: "Header shown above the list",
    required: false,
    type: ComponentInputType.Text,
    id: "title" as keyof T["arguments"],
    section: ProxmoxDisplaySection,
  });

  args.push({
    name: "Max Rows",
    description: "Maximum number of rows to show",
    required: false,
    type: ComponentInputType.Number,
    id: "maxRows" as keyof T["arguments"],
    placeholder: "25",
    section: ProxmoxDisplaySection,
  });

  args.push(getViewModeArgument<T>(ProxmoxDisplaySection));

  args.push({
    name: "Clusters",
    description: "Show only resources from the selected Proxmox clusters",
    required: false,
    type: ComponentInputType.EntityMultiSelectDropdown,
    id: "proxmoxClusterIds" as keyof T["arguments"],
    placeholder: "All clusters",
    section: ProxmoxFiltersSection,
    entityFilterModelType: EntityFilterModelType.ProxmoxCluster,
  });

  return args;
}
