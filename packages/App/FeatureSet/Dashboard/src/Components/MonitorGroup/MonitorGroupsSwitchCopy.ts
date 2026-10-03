import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether the project uses monitor groups, on Settings -> Feature Flags.
 *
 * It used to be a "Feature Flags" card whose Edit Feature Flags dialog held
 * one switch, "Enable Monitor Groups", and reloaded the whole dashboard
 * after saving it. The card is the switch now (MonitorGroupsSwitchCard, on
 * the shared ModelSwitchCard), and it saves the moment it is flipped; the
 * Monitors menu and the status page menus follow at once, because the
 * dashboard hears the save (SelectedProjectSwitches) instead of reloading.
 *
 * The switch stays on Feature Flags rather than moving next to the Monitor
 * Groups page: while it is off, there is no Monitor Groups page in the
 * menu to put it on, and it decides more than that page - the status pages'
 * "Resources" menu item and their "Add a Monitor Group instead" link too.
 *
 * No dialog either way: turning it off only hides Monitor Groups again, and
 * deletes no group.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const MonitorGroupsSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // Under the switch, whichever way it is set.
  note: string;
} = {
  cardTitle: translationKey("Feature Flags"),
  cardDescription: translationKey(
    "Turn optional features on or off for this project.",
  ),
  switchTitle: translationKey("Monitor Groups"),
  switchOnDescription: translationKey(
    "Monitor Groups is in the Monitors menu.",
  ),
  switchOffDescription: translationKey(
    "Monitor Groups is hidden from the Monitors menu.",
  ),
  note: translationKey(
    "A monitor group rolls several monitors up into one status, which a status page can show as one row. Turning this off deletes no group.",
  ),
};

// The Project column the switch writes.
export type MonitorGroupsSwitchColumn = "isFeatureFlagMonitorGroupsEnabled";

export const MONITOR_GROUPS_SWITCH_COLUMN: MonitorGroupsSwitchColumn =
  "isFeatureFlagMonitorGroupsEnabled";

// The data-testid of the switch.
export const MONITOR_GROUPS_SWITCH_TEST_ID: string =
  "project-monitor-groups-switch";

export default MonitorGroupsSwitchCopy;
