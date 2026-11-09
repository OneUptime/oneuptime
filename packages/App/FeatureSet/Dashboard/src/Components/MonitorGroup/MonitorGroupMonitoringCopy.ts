import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Monitoring for every monitor in a monitor group (issue #6401;
 * Common/Utils/Monitor/MonitorGroupMonitoring).
 *
 * Turning monitoring off for a group's monitors took a trip to the Monitors
 * list, a selection and a bulk Disable - of one page of a list, never of
 * "the group" - and nothing on the group said that it was off. Now the
 * group's Overview has a Monitoring card that says how many of its monitors
 * are checked and turns monitoring off or on for every one of them at once,
 * and a group whose monitors all have monitoring off reads "Disabled" where
 * its status is shown, as a monitor does.
 *
 * Turning it off asks first, as a monitor's own switch does; turning it on
 * saves at once.
 *
 * Kept free of React so the card, the group's status and App/Tests read
 * these exact words. Every sentence is wrapped in translationKey() so npm
 * run i18n:extract finds it.
 */

export const MonitorGroupMonitoringCopy: {
  cardTitle: string;
  cardDescription: string;
  // What the card says, for each state of the group's monitors.
  onLine: string;
  offLine: string;
  mixedLine: string;
  turnOffButton: string;
  turnOnButton: string;
  // The dialog before monitoring is turned off.
  turnOffConfirmTitle: string;
  turnOffConfirmDescription: string;
  // The group's Current Status when monitoring is off for all its monitors.
  disabledStatus: string;
} = {
  cardTitle: translationKey("Monitoring"),
  cardDescription: translationKey(
    "Turn monitoring off or on for every monitor in this group at once.",
  ),
  onLine: translationKey("Monitoring is on for every monitor in this group."),
  offLine: translationKey(
    "Monitoring is off for every monitor in this group. Nothing checks them, and they open no incidents or alerts until monitoring is turned back on.",
  ),
  // Never fewer than two monitors: one is off and another is on.
  mixedLine: translationKey(
    "Monitoring is off for {{off}} of {{total}} monitors in this group.",
  ),
  turnOffButton: translationKey("Turn off monitoring"),
  turnOnButton: translationKey("Turn monitoring on"),
  turnOffConfirmTitle: translationKey("Turn off monitoring for this group?"),
  turnOffConfirmDescription: translationKey(
    "Nothing checks these monitors until monitoring is back on, so they open no incidents or alerts. Their open ones set to auto-resolve are resolved now.",
  ),
  disabledStatus: translationKey("Disabled"),
};

// The data-testid of the Monitoring card on a group's Overview.
export const MONITOR_GROUP_MONITORING_CARD_TEST_ID: string =
  "monitor-group-monitoring";

// The data-testid of the line that says how many monitors are checked.
export const MONITOR_GROUP_MONITORING_STATE_TEST_ID: string =
  "monitor-group-monitoring-state";

export const MONITOR_GROUP_TURN_MONITORING_OFF_TEST_ID: string =
  "monitor-group-turn-monitoring-off";

export const MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID: string =
  "monitor-group-turn-monitoring-on";

// The data-testid of why a press did not turn monitoring on.
export const MONITOR_GROUP_MONITORING_ERROR_TEST_ID: string =
  "monitor-group-monitoring-error";

// The data-testid of the group's "Disabled" status, wherever it is drawn.
export const MONITOR_GROUP_DISABLED_STATUS_TEST_ID: string =
  "monitor-group-status-disabled";

export default MonitorGroupMonitoringCopy;
