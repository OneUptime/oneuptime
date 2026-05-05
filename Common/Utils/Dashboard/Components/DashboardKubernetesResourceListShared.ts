import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";

export const KubernetesDisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

export const KubernetesFiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which resources are shown",
  order: 2,
  defaultCollapsed: true,
};

export interface KubernetesCommonArgumentsOptions {
  includeNamespaceFilter: boolean;
}

export function getKubernetesCommonArguments<T extends DashboardBaseComponent>(
  options: KubernetesCommonArgumentsOptions,
): Array<ComponentArgument<T>> {
  const args: Array<ComponentArgument<T>> = [];

  args.push({
    name: "Title",
    description: "Header shown above the list",
    required: false,
    type: ComponentInputType.Text,
    id: "title" as keyof T["arguments"],
    section: KubernetesDisplaySection,
  });

  args.push({
    name: "Max Rows",
    description: "Maximum number of rows to show",
    required: false,
    type: ComponentInputType.Number,
    id: "maxRows" as keyof T["arguments"],
    placeholder: "25",
    section: KubernetesDisplaySection,
  });

  args.push({
    name: "Clusters",
    description: "Show only resources from the selected clusters",
    required: false,
    type: ComponentInputType.EntityMultiSelectDropdown,
    id: "kubernetesClusterIds" as keyof T["arguments"],
    placeholder: "All clusters",
    section: KubernetesFiltersSection,
    entityFilterModelType: EntityFilterModelType.KubernetesCluster,
  });

  if (options.includeNamespaceFilter) {
    args.push({
      name: "Namespaces",
      description:
        "Comma-separated list of namespaces to include. Leave blank for all.",
      required: false,
      type: ComponentInputType.Text,
      id: "namespaces" as keyof T["arguments"],
      placeholder: "default, kube-system",
      section: KubernetesFiltersSection,
    });
  }

  return args;
}
