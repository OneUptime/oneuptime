import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether a runbook can run, in one place: the "Execution" card on the
 * runbook's Settings page.
 *
 * It used to be an "Enable / Disable Runbook" card whose Edit dialog held
 * one switch, "Enabled", under a Status pill. Now the card is one switch,
 * "Run this runbook", that saves the moment it is flipped (on the shared
 * ModelSwitchCard).
 *
 * A runbook that is off is refused everywhere it can be started: Run Now
 * and the API (the Runbook feature's run route), and the runbook rules,
 * auto-remediation and OneUptime AI (RunbookRuleEngineService.
 * startRunbookFor). Executions that already started carry on.
 *
 * Kept free of React so the page and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const RunbookSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch while the runbook can run.
  switchOnDescription: string;
  // Under the switch while it cannot.
  switchOffDescription: string;
} = {
  cardTitle: translationKey("Execution"),
  cardDescription: translationKey(
    "Pause this runbook without deleting it. Its steps and past executions are kept.",
  ),
  switchTitle: translationKey("Run this runbook"),
  switchOnDescription: translationKey(
    "It can be run by hand, and automatically by rules and OneUptime AI.",
  ),
  /*
   * "By hand or automatically" next to what it qualifies: after "until it
   * is turned back on" it read as how it would be turned on. Also the
   * description of the turned-off banner on the runbook's Overview.
   */
  switchOffDescription: translationKey(
    "It cannot be run, by hand or automatically, until it is turned back on. Executions already running are not stopped.",
  ),
};

// The column the switch writes.
export type RunbookSwitchColumn = "isEnabled";

export const RUNBOOK_SWITCH_COLUMN: RunbookSwitchColumn = "isEnabled";

// The data-testid of the "Run this runbook" switch.
export const RUNBOOK_SWITCH_TEST_ID: string = "runbook-run-switch";

export default RunbookSwitchCopy;
