import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether a new monitor starts with OneUptime's global probes, on Monitors ->
 * Settings -> Probes.
 *
 * It used to be a "Global Probe Settings" card whose Edit dialog held one
 * switch, "Disable Global Probes on New Monitors": on meant global probes
 * were NOT added, under a help line that called it a toggle "to enable or
 * disable" them. It is one switch now, "Add global probes to new monitors",
 * on while they are added, that saves when flipped. It stores
 * Project.doNotAddGlobalProbesByDefaultOnNewMonitors, the other way round,
 * which needs a project admin (the switch says so, locked, to anyone else).
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const GlobalProbesOnNewMonitorsCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // Under the switch, whichever way it is set.
  note: string;
} = {
  cardTitle: translationKey("Global Probes on New Monitors"),
  cardDescription: translationKey(
    "Which probes a monitor starts with when you create it. You can change any monitor's probes on its Probes page.",
  ),
  switchTitle: translationKey("Add global probes to new monitors"),
  switchOnDescription: translationKey(
    "New monitors start with OneUptime's global probes, along with the custom probes you add to new monitors.",
  ),
  switchOffDescription: translationKey(
    "New monitors start with only the custom probes you add to new monitors.",
  ),
  note: translationKey("Monitors that already exist keep their probes."),
};

// The project column the switch writes. The switch is on while it is false.
export type GlobalProbesOnNewMonitorsColumn =
  "doNotAddGlobalProbesByDefaultOnNewMonitors";

export const GLOBAL_PROBES_ON_NEW_MONITORS_COLUMN: GlobalProbesOnNewMonitorsColumn =
  "doNotAddGlobalProbesByDefaultOnNewMonitors";

// The data-testid of the switch.
export const GLOBAL_PROBES_ON_NEW_MONITORS_SWITCH_TEST_ID: string =
  "global-probes-on-new-monitors-switch";

export default GlobalProbesOnNewMonitorsCopy;
