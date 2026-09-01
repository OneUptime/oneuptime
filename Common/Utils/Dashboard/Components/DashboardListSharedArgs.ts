import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

export type DashboardListViewMode = "list" | "honeycomb" | "timeline";

export interface ViewModeArgumentOptions {
  /*
   * Offer the "State Timeline" mode as well.
   *
   * Opt-in rather than universal: a timeline needs a per-entity status
   * history to draw, and most list widgets only have the entity's CURRENT
   * status. Offering the mode where there is nothing to plot would hand the
   * operator a permanently empty widget.
   */
  includeTimeline?: boolean | undefined;
}

/**
 * Returns the `viewMode` dropdown argument used by every dashboard list
 * component to switch between the default table view and a status-colored
 * honeycomb view — plus, for widgets that pass `includeTimeline`, a state
 * timeline that plots each entry's status over the dashboard's time range.
 */
export function getViewModeArgument<T extends DashboardBaseComponent>(
  section: ComponentArgumentSection,
  options?: ViewModeArgumentOptions | undefined,
): ComponentArgument<T> {
  const includeTimeline: boolean = options?.includeTimeline === true;

  const dropdownOptions: Array<DropdownOption> = [
    { label: "List", value: "list" },
    { label: "Honeycomb", value: "honeycomb" },
  ];

  if (includeTimeline) {
    dropdownOptions.push({ label: "State Timeline", value: "timeline" });
  }

  const description: string = includeTimeline
    ? "Show entries as a list (default), as a honeycomb where each cell is colored by status, or as a state timeline where each row is a bar colored by status across the dashboard's time range."
    : "Show entries as a list (default) or as a honeycomb where each cell is colored by status.";

  return {
    name: "View Mode",
    description: description,
    required: false,
    type: ComponentInputType.Dropdown,
    id: "viewMode" as keyof T["arguments"],
    section: section,
    dropdownOptions: dropdownOptions,
  };
}
