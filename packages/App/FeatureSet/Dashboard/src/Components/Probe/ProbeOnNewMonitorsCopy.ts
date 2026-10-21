import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether new monitors start with a custom probe selected
 * (Probe.shouldAutoEnableProbeOnNewMonitors), named one way wherever it is
 * shown. It had four names: "Enable monitoring automatically on new
 * monitors" on the create and edit forms, "Enable Monitoring on New
 * Monitors" on the probe's page and "Enable Monitoring by Default" as the
 * list's column and filter - while the switch for OneUptime's own probes,
 * on the same page, reads "Add global probes to new monitors"
 * (GlobalProbesOnNewMonitorsCopy). Now both say "add to new monitors".
 *
 * Kept free of React so the pages and App/Tests read these exact words.
 */
export const PROBE_ON_NEW_MONITORS_COPY: {
  // The switch on the create and edit forms, a sentence like the global one.
  switchTitle: string;
  // The list's column and filter, and the probe page's field.
  columnTitle: string;
  description: string;
} = {
  switchTitle: translationKey("Add to new monitors"),
  columnTitle: translationKey("Added to New Monitors"),
  description: translationKey("New monitors start with this probe selected."),
};

export default PROBE_ON_NEW_MONITORS_COPY;
