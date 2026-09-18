import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";

export type DashboardListViewMode = "list" | "honeycomb";

/**
 * Returns the `viewMode` dropdown argument used by every dashboard list
 * component to switch between the default table view and a status-colored
 * honeycomb view.
 */
export function getViewModeArgument<T extends DashboardBaseComponent>(
  section: ComponentArgumentSection,
): ComponentArgument<T> {
  return {
    name: "View Mode",
    description:
      "Show entries as a list (default) or as a honeycomb where each cell is colored by status.",
    required: false,
    type: ComponentInputType.Dropdown,
    id: "viewMode" as keyof T["arguments"],
    section: section,
    dropdownOptions: [
      { label: "List", value: "list" },
      { label: "Honeycomb", value: "honeycomb" },
    ],
  };
}
