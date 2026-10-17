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
  noMonitorsInProject: string;
  everyMonitorInGroup: string;
  createMonitorButton: string;
  noneAddedError: string;
  someNotAddedError: string;
  removeButton: string;
  removeDialogTitle: string;
  removeDialogDescription: string;
  alreadyRemovedError: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyGroupCardTitle: string;
  emptyGroupStatus: string;
  tableNoItems: string;
} = {
  addButton: translationKey("Add Monitors"),
  addDialogTitle: translationKey("Add Monitors to Group"),
  addDialogDescription: translationKey(
    "Pick the monitors that make up this service. The group shows the worst status among them.",
  ),
  monitorsField: translationKey("Monitors"),
  monitorsPlaceholder: translationKey("Select Monitors"),
  /*
   * Add Monitors with nothing to pick: the project has no monitor yet, or
   * the group holds every one. Said in place of an empty picker, with
   * Create Monitor as the way on.
   */
  noMonitorsInProject: translationKey(
    "This project has no monitors yet. Create one, then add it to this group.",
  ),
  everyMonitorInGroup: translationKey(
    "Every monitor in this project is already in this group.",
  ),
  createMonitorButton: translationKey("Create Monitor"),
  noneAddedError: translationKey("No monitor was added: {{reason}}"),
  // The picks that were not added stay in the picker, ready to try again.
  someNotAddedError: translationKey(
    "Added {{added}} of {{total}} monitors. Those still picked were not added: {{reason}}",
  ),
  // The pages write it as the literal "Remove" (ListDeletePolicy reads it).
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
  // An empty group's Current Status: it has nothing to be operational about.
  emptyGroupStatus: translationKey("No monitors yet"),
  tableNoItems: translationKey(
    "No monitors in this group yet. Add the monitors that make up this service.",
  ),
};

export default MonitorGroupMonitorsCopy;
