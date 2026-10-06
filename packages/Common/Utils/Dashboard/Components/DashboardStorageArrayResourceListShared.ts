import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import { getViewModeArgument } from "./DashboardListSharedArgs";

/*
 * Arguments shared by every Storage Array inventory list widget (volumes,
 * hardware). The shape — title, max rows, view mode, then a storage array
 * multi-select in a collapsed Filters panel — is deliberately identical to
 * the Ceph / VMware / Docker Swarm / Proxmox / Kubernetes builders; a
 * cross-provider test compares them. Widget-specific filters (component
 * kind, status) are added by the per-widget util, never here.
 */

export const StorageArrayDisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

export const StorageArrayFiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which resources are shown",
  order: 2,
  defaultCollapsed: true,
};

export function getStorageArrayCommonArguments<
  T extends DashboardBaseComponent,
>(): Array<ComponentArgument<T>> {
  const args: Array<ComponentArgument<T>> = [];

  args.push({
    name: "Title",
    description: "Header shown above the list",
    required: false,
    type: ComponentInputType.Text,
    id: "title" as keyof T["arguments"],
    section: StorageArrayDisplaySection,
  });

  args.push({
    name: "Max Rows",
    description: "Maximum number of rows to show",
    required: false,
    type: ComponentInputType.Number,
    id: "maxRows" as keyof T["arguments"],
    placeholder: "25",
    section: StorageArrayDisplaySection,
  });

  args.push(getViewModeArgument<T>(StorageArrayDisplaySection));

  args.push({
    name: "Storage Arrays",
    description: "Show only resources from the selected storage arrays",
    required: false,
    type: ComponentInputType.EntityMultiSelectDropdown,
    id: "storageArrayIds" as keyof T["arguments"],
    placeholder: "All storage arrays",
    section: StorageArrayFiltersSection,
    entityFilterModelType: EntityFilterModelType.StorageArray,
  });

  return args;
}

/*
 * The inventory kinds the hardware widget lists: hardware components
 * (chassis, power supplies, fans, ports, ...), drives and controllers.
 * FlashBlade reports everything as Hardware; FlashArray reports all three.
 * The widget's query, its kind filter and the public dashboard policy all
 * read this list, so a kind is never listed by one and refused by another.
 */
export const STORAGE_ARRAY_HARDWARE_WIDGET_KINDS: ReadonlyArray<StorageArrayResourceKind> =
  [
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.Drive,
    StorageArrayResourceKind.Controller,
  ];

/*
 * Component statuses, lowercased as ingest stores them, split the way an
 * array's health is derived from them (StorageArraySnapshotScan): a critical
 * status makes the array Critical, a warning status makes it Warning.
 * Together they are the statuses StorageArrayResourceService counts as
 * unhealthy hardware — a test holds the three lists to each other. Every
 * other status (ok, healthy, ready, identifying, not_installed, device_off,
 * empty, unused) needs nobody.
 */
export const STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES: ReadonlyArray<string> =
  ["critical", "failed", "missing", "unhealthy"];

export const STORAGE_ARRAY_WARNING_COMPONENT_STATUSES: ReadonlyArray<string> = [
  "degraded",
  "unknown",
  "unrecognized",
  "not ready",
];

export const STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES: ReadonlyArray<string> =
  [
    ...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
    ...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
  ];

// The hardware widget's status filter value for "unhealthy only".
export const STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER: string = "unhealthy";
