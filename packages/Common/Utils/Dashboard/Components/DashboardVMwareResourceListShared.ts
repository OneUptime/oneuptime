import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { getViewModeArgument } from "./DashboardListSharedArgs";

/*
 * Arguments shared by every VMware inventory list widget (hosts, virtual
 * machines). The shape — title, max rows, view mode, then a vCenter
 * multi-select in a collapsed Filters panel — is deliberately identical to
 * the Ceph / Docker Swarm / Proxmox / Kubernetes builders; a cross-provider
 * test compares them. Widget-specific filters (power state, templates) are
 * added by the per-widget util, never here.
 */

export const VMwareDisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

export const VMwareFiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which resources are shown",
  order: 2,
  defaultCollapsed: true,
};

export function getVMwareCommonArguments<
  T extends DashboardBaseComponent,
>(): Array<ComponentArgument<T>> {
  const args: Array<ComponentArgument<T>> = [];

  args.push({
    name: "Title",
    description: "Header shown above the list",
    required: false,
    type: ComponentInputType.Text,
    id: "title" as keyof T["arguments"],
    section: VMwareDisplaySection,
  });

  args.push({
    name: "Max Rows",
    description: "Maximum number of rows to show",
    required: false,
    type: ComponentInputType.Number,
    id: "maxRows" as keyof T["arguments"],
    placeholder: "25",
    section: VMwareDisplaySection,
  });

  args.push(getViewModeArgument<T>(VMwareDisplaySection));

  args.push({
    name: "vCenters",
    description: "Show only resources from the selected vCenters",
    required: false,
    type: ComponentInputType.EntityMultiSelectDropdown,
    id: "vmwareVCenterIds" as keyof T["arguments"],
    placeholder: "All vCenters",
    section: VMwareFiltersSection,
    entityFilterModelType: EntityFilterModelType.VMwareVCenter,
  });

  return args;
}
