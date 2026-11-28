import { translationKey } from "Common/Types/Translator";

/*
 * The words of the Project Call Voices card on Settings > Call and SMS
 * (#11065): whether projects choose the voice of their calls through this
 * server's Twilio account (ProjectCallVoicesCard, Common/Types/Call/
 * ProjectCallVoice) - switched here, or set by GLOBAL_TWILIO_LET_PROJECTS_
 * CHOOSE_CALL_VOICE (#11462).
 *
 * Kept free of React, so App/Tests can read these exact strings.
 */

// The switch's data-testid; the card's body is `${it}-card`, its lines `${it}-details`.
export const PROJECT_CALL_VOICES_SWITCH_TEST_ID: string =
  "let-projects-choose-call-voice";

// The card while the server says whether a variable sets the switch.
export const PROJECT_CALL_VOICES_LOADING_TEST_ID: string =
  "project-call-voices-loading";

// The card while GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE sets the switch.
export const PROJECT_CALL_VOICES_ENVIRONMENT_TEST_ID: string =
  "project-call-voices-environment";

// What is wrong with the variable, above the switch it leaves off.
export const PROJECT_CALL_VOICES_PROBLEM_TEST_ID: string =
  "project-call-voices-problem";

export const PROJECT_CALL_VOICES_COPY: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  environmentDescription: string;
  environmentLockedReason: string;
  environmentProblemTitle: string;
} = {
  cardTitle: translationKey("Project Call Voices"),
  cardDescription: translationKey(
    "Whether each project chooses the voice of its own calls through this server's Twilio account.",
  ),
  switchTitle: translationKey("Let projects choose their call voice"),
  // What "on" does, and who pays.
  switchOnDescription: translationKey(
    "Project owners and admins choose it in Project Settings > Notifications > Notification Channels, and this server's Twilio account pays for it. A project that chooses none speaks with the voice above.",
  ),
  // What "off" does.
  switchOffDescription: translationKey(
    "Every project's calls through this server's Twilio account speak with the voice above.",
  ),
  /*
   * Said in place of the description when GLOBAL_TWILIO_LET_PROJECTS_
   * CHOOSE_CALL_VOICE sets the switch: what sets it, and where it changes.
   */
  environmentDescription: translationKey(
    "Set by the GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE environment variable: twilio.letProjectsChooseCallVoice with Helm, or config.env with Docker Compose. Change it there and restart OneUptime.",
  ),
  // Why the switch is locked, behind its help icon and to a screen reader.
  environmentLockedReason: translationKey(
    "An environment variable sets this switch, so it cannot be changed here.",
  ),
  // Above the server's line when the variable is neither true nor false.
  environmentProblemTitle: translationKey(
    "Projects speak with the voice above until this environment variable is fixed:",
  ),
};
