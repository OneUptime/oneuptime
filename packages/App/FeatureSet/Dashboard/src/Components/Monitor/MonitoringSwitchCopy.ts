import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether OneUptime checks a monitor, in one place.
 *
 * It used to be a "Monitor Settings" card on the monitor's Settings page
 * whose Edit dialog held one switch, "Disable Active Monitoring", with no
 * description: on meant off, and turning a monitor back on took Edit, flip
 * the switch off, Save. A red banner on every page of a disabled monitor
 * said "To enable active monitoring, please go to Settings", and the
 * overview's hero said "Monitoring is turned off" with an "Open settings"
 * link - a trip to another page for a one-press fix.
 *
 * Now:
 * - The Settings page has a "Monitoring" card with one switch, "Check this
 *   monitor", on while the monitor is checked. It saves when flipped (it
 *   writes Monitor.disableActiveMonitoring, inverted), and asks before it
 *   turns monitoring off, the one way a slip silently stops alerting.
 * - The banner on a turned-off monitor's pages, and the overview's hero,
 *   carry a "Turn monitoring on" button that turns it back on in place.
 *
 * Monitoring that an incident or a scheduled maintenance event paused keeps
 * its own wording: it resumes when that ends, so there is nothing to switch.
 *
 * Kept free of React so the card, the banner, the hero and App/Tests read
 * these exact strings. Every sentence is wrapped in translationKey() so npm
 * run i18n:extract finds it.
 */

export const MonitoringSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch while the monitor is checked.
  switchOnDescription: string;
  /*
   * Under the switch while it is not, and in the banner on the monitor's
   * pages: what "off" means.
   */
  offDescription: string;
  // The banner's title on a turned-off monitor's pages.
  bannerTitle: string;
  // The button on that banner and in the overview's hero.
  turnOnButton: string;
  // The dialog before monitoring is turned off.
  turnOffConfirmTitle: string;
  turnOffConfirmDescription: string;
  turnOffConfirmButton: string;
} = {
  cardTitle: translationKey("Monitoring"),
  cardDescription: translationKey(
    "Pause this monitor without deleting it. Its settings and history are kept.",
  ),
  switchTitle: translationKey("Check this monitor"),
  switchOnDescription: translationKey(
    "OneUptime checks this monitor and opens incidents and alerts when its criteria match.",
  ),
  offDescription: translationKey(
    "Nothing checks this monitor while monitoring is off: its status stays at the last one recorded, and it opens no incidents or alerts.",
  ),
  bannerTitle: translationKey("Monitoring is turned off"),
  turnOnButton: translationKey("Turn monitoring on"),
  turnOffConfirmTitle: translationKey("Turn off monitoring?"),
  turnOffConfirmDescription: translationKey(
    "Nothing will check this monitor until monitoring is turned back on, so it opens no incidents or alerts, even if what it watches goes down.",
  ),
  turnOffConfirmButton: translationKey("Turn off monitoring"),
};

// The column the switch writes. The switch is on while it is false.
export type MonitoringSwitchColumn = "disableActiveMonitoring";

export const MONITORING_SWITCH_COLUMN: MonitoringSwitchColumn =
  "disableActiveMonitoring";

// The data-testid of the "Check this monitor" switch.
export const MONITORING_SWITCH_TEST_ID: string = "monitor-monitoring-switch";

// The data-testid of the banner on a turned-off monitor's pages.
export const MONITORING_OFF_BANNER_TEST_ID: string = "monitor-monitoring-off";

// The data-testid of the "Turn monitoring on" button, wherever it is drawn.
export const TURN_MONITORING_ON_BUTTON_TEST_ID: string = "turn-monitoring-on";

// The data-testid of why a press of that button did not turn monitoring on.
export const TURN_MONITORING_ON_ERROR_TEST_ID: string =
  "turn-monitoring-on-error";

export default MonitoringSwitchCopy;
