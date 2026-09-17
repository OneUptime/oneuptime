import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { getViewModeArgument } from "./DashboardListSharedArgs";

export const CephDisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

export const CephFiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which resources are shown",
  order: 2,
  defaultCollapsed: true,
};

export function getCephCommonArguments<
  T extends DashboardBaseComponent,
>(): Array<ComponentArgument<T>> {
  const args: Array<ComponentArgument<T>> = [];

  args.push({
    name: "Title",
    description: "Header shown above the list",
    required: false,
    type: ComponentInputType.Text,
    id: "title" as keyof T["arguments"],
    section: CephDisplaySection,
  });

  args.push({
    name: "Max Rows",
    description: "Maximum number of rows to show",
    required: false,
    type: ComponentInputType.Number,
    id: "maxRows" as keyof T["arguments"],
    placeholder: "25",
    section: CephDisplaySection,
  });

  args.push(getViewModeArgument<T>(CephDisplaySection));

  args.push({
    name: "Clusters",
    description: "Show only resources from the selected Ceph clusters",
    required: false,
    type: ComponentInputType.EntityMultiSelectDropdown,
    id: "cephClusterIds" as keyof T["arguments"],
    placeholder: "All clusters",
    section: CephFiltersSection,
    entityFilterModelType: EntityFilterModelType.CephCluster,
  });

  return args;
}
