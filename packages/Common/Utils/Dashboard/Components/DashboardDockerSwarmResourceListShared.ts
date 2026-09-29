import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { getViewModeArgument } from "./DashboardListSharedArgs";

export const DockerSwarmDisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

export const DockerSwarmFiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which resources are shown",
  order: 2,
  defaultCollapsed: true,
};

export function getDockerSwarmCommonArguments<
  T extends DashboardBaseComponent,
>(): Array<ComponentArgument<T>> {
  const args: Array<ComponentArgument<T>> = [];

  args.push({
    name: "Title",
    description: "Header shown above the list",
    required: false,
    type: ComponentInputType.Text,
    id: "title" as keyof T["arguments"],
    section: DockerSwarmDisplaySection,
  });

  args.push({
    name: "Max Rows",
    description: "Maximum number of rows to show",
    required: false,
    type: ComponentInputType.Number,
    id: "maxRows" as keyof T["arguments"],
    placeholder: "25",
    section: DockerSwarmDisplaySection,
  });

  args.push(getViewModeArgument<T>(DockerSwarmDisplaySection));

  args.push({
    name: "Clusters",
    description: "Show only resources from the selected Docker Swarm clusters",
    required: false,
    type: ComponentInputType.EntityMultiSelectDropdown,
    id: "dockerSwarmClusterIds" as keyof T["arguments"],
    placeholder: "All clusters",
    section: DockerSwarmFiltersSection,
    entityFilterModelType: EntityFilterModelType.DockerSwarmCluster,
  });

  return args;
}
