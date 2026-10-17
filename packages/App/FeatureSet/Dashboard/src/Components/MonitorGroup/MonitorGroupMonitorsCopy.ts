import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Putting monitors in a monitor group, and taking them out.
 *
 * A new group has no monitors, and its Overview used to say nothing about
 * that: it showed the operational status and a full uptime bar, with the
 * one thing to do next - add the monitors - on another page, behind
 * "Assign Monitor", one monitor per dialog. Now the Overview of an empty
 * group says so and offers Add Monitors, which picks every monitor of the
 * group in one dialog. A row is taken out with Remove ("Unassign" before).
 *
 * Kept free of React so the pages and App/Tests read these exact words.
 */

// The query parameter that opens Add Monitors as the Monitors page opens.
export const ADD_MONITORS_QUERY_PARAM: string = "addMonitors";

export const MonitorGroupMonitorsCopy: {
  addButton: string;
  addDialogTitle: string;
  addDialogDescription: string;
  monitorsField: string;
  monitorsPlaceholder: string;
  nothingToAdd: string;
  noneAddedError: string;
  someNotAddedError: string;
  removeButton: string;
  removeDialogTitle: string;
  removeDialogDescription: string;
  alreadyRemovedError: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyGroupCardTitle: string;
  tableNoItems: string;
} = {
  addButton: translationKey("Add Monitors"),
  addDialogTitle: translationKey("Add Monitors to Group"),
  addDialogDescription: translationKey(
    "Pick the monitors that make up this service. The group shows the worst status among them.",
  ),
  monitorsField: translationKey("Monitors"),
  monitorsPlaceholder: translationKey("Select Monitors"),
  nothingToAdd: translationKey("Every monitor in this project is in the group."),
  noneAddedError: translationKey("No monitor was added: {{reason}}"),
  someNotAddedError: translationKey(
    "{{added}} of {{total}} monitors were added. The rest were not: {{reason}}",
  ),
  removeButton: translationKey("Remove"),
  removeDialogTitle: translationKey("Remove from Group"),
  removeDialogDescription: translationKey(
    "{{monitorName}} leaves this group. The monitor itself does not change.",
  ),
  alreadyRemovedError: translationKey(
    "This monitor is no longer in the group.",
  ),
  emptyTitle: translationKey("No monitors in this group yet"),
  emptyDescription: translationKey(
    "Add the monitors that make up this service. The group shows the worst status among them.",
  ),
  emptyGroupCardTitle: translationKey("Monitors in Group"),
  tableNoItems: translationKey(
    "No monitors in this group yet. Add the monitors that make up this service.",
  ),
};

export default MonitorGroupMonitorsCopy;
