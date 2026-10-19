import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The project's session replay master switch, on Real User Monitoring ->
 * Settings -> Session Replay.
 *
 * It used to be a "Session Replay for this Project" card whose Update
 * dialog held one switch, "Allow session replay in this project". Now the
 * card is the switch (on the shared ModelSwitchCard), and it saves the
 * moment it is flipped - with one difference from a plain switch: turning
 * recording ON asks first. The switch's own sentence says to confirm the
 * masking policy and the lawful basis before turning it on, and a dialog is
 * where that is asked. Turning it off - the privacy-safe way - saves at
 * once: stopping the recording of your end users must never take a dialog.
 *
 * The card's title, its description and the switch's name and sentence are
 * the ones the dialog card had, so their translations carry over.
 *
 * Kept free of React so the page and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const SessionReplayAllowedSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch, whichever way it is set.
  switchDescription: string;
  // The dialog before session replay is allowed in the project.
  allowConfirmTitle: string;
  allowConfirmDescription: string;
  allowConfirmButton: string;
} = {
  cardTitle: translationKey("Session Replay for this Project"),
  cardDescription: translationKey(
    "The master switch for recording your users' screens in this project.",
  ),
  switchTitle: translationKey("Allow session replay in this project"),
  switchDescription: translationKey(
    "Records what real people do on your site, including anything not masked. Confirm your masking policy and lawful basis first.",
  ),
  allowConfirmTitle: translationKey("Allow session replay?"),
  allowConfirmDescription: translationKey(
    "Applications with session replay on start recording real people on your site. Confirm your masking policy and lawful basis first.",
  ),
  allowConfirmButton: translationKey("Allow session replay"),
};

// The Project column the switch writes.
export type SessionReplayAllowedSwitchColumn = "isSessionReplayAllowed";

export const SESSION_REPLAY_ALLOWED_SWITCH_COLUMN: SessionReplayAllowedSwitchColumn =
  "isSessionReplayAllowed";

// The data-testid of the "Allow session replay in this project" switch.
export const SESSION_REPLAY_ALLOWED_SWITCH_TEST_ID: string =
  "project-session-replay-switch";

export default SessionReplayAllowedSwitchCopy;
