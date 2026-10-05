import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether OneUptime evaluates an SLO, in one place.
 *
 * It used to be an "Evaluation" card on the SLO's Settings page whose Edit
 * Evaluation dialog held one switch, "Enabled", with "Last Evaluated" under
 * it. The banner on every page of a disabled SLO said "Turn evaluation back
 * on in Settings" with an Open Settings link - a trip to another page for a
 * one-press fix.
 *
 * Now:
 * - The Evaluation card is one switch, "Evaluate this SLO", that saves the
 *   moment it is flipped (SloEvaluationCard, on the shared ModelSwitchCard),
 *   with "Last Evaluated" as a read-only line under it.
 * - Turning evaluation off asks first. It does more than stop measuring:
 *   ServiceLevelObjectiveService resolves every burn rate alert and
 *   incident the SLO has open, which turning it back on does not undo.
 *   Turning it on saves at once.
 * - The banner on a disabled SLO's pages carries a "Turn evaluation on"
 *   button that turns it back on in place, and the switch follows it.
 *
 * Kept free of React so the card, the banner and App/Tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const SloEvaluationSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch while the SLO is evaluated.
  switchOnDescription: string;
  // Under the switch while it is not.
  switchOffDescription: string;
  // The read-only line under the switch.
  lastEvaluatedTitle: string;
  notEvaluatedYet: string;
  notEvaluatedYetDescription: string;
  // The dialog before evaluation is turned off.
  turnOffConfirmTitle: string;
  turnOffConfirmDescription: string;
  turnOffConfirmButton: string;
  // The button on the banner of a disabled SLO's pages.
  turnOnButton: string;
} = {
  cardTitle: translationKey("Evaluation"),
  cardDescription: translationKey(
    "Pause this SLO without deleting it. Its history and settings are kept.",
  ),
  switchTitle: translationKey("Evaluate this SLO"),
  switchOnDescription: translationKey(
    "OneUptime measures this SLO every few minutes, and its burn rate rules fire when its error budget burns too fast.",
  ),
  switchOffDescription: translationKey(
    "Nothing measures this SLO while evaluation is off: its numbers stay as last evaluated, and its burn rate rules do not fire.",
  ),
  lastEvaluatedTitle: translationKey("Last Evaluated"),
  notEvaluatedYet: translationKey("Not evaluated yet"),
  notEvaluatedYetDescription: translationKey(
    "OneUptime evaluates enabled SLOs every few minutes.",
  ),
  turnOffConfirmTitle: translationKey("Turn off evaluation?"),
  turnOffConfirmDescription: translationKey(
    "OneUptime stops measuring this SLO and resolves the burn rate alerts and incidents it has open. Turning evaluation back on does not reopen them. Its history and settings are kept.",
  ),
  turnOffConfirmButton: translationKey("Turn off evaluation"),
  turnOnButton: translationKey("Turn evaluation on"),
};

// The column the switch writes.
export type SloEvaluationSwitchColumn = "isEnabled";

export const SLO_EVALUATION_SWITCH_COLUMN: SloEvaluationSwitchColumn =
  "isEnabled";

// The data-testid of the "Evaluate this SLO" switch.
export const SLO_EVALUATION_SWITCH_TEST_ID: string = "slo-evaluation-switch";

// The id of the read-only line under it.
export const SLO_EVALUATION_DETAILS_ID: string = "slo-settings-evaluation";

// The data-testid of the "Turn evaluation on" button on the banner.
export const TURN_SLO_EVALUATION_ON_BUTTON_TEST_ID: string =
  "turn-slo-evaluation-on";

// The data-testid of why a press of that button did not turn it on.
export const TURN_SLO_EVALUATION_ON_ERROR_TEST_ID: string =
  "turn-slo-evaluation-on-error";

export default SloEvaluationSwitchCopy;
