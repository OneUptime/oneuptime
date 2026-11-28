import { translationKey } from "Common/Types/Translator";

/*
 * The words of the Project Call Voices card on Settings > Call and SMS
 * (#11065): whether projects choose the voice of their calls through this
 * server's Twilio account (ProjectCallVoicesCard, Common/Types/Call/
 * ProjectCallVoice).
 *
 * Kept free of React, so App/Tests can read these exact strings.
 */

// The switch's data-testid; the card's body is `${it}-card`, its lines `${it}-details`.
export const PROJECT_CALL_VOICES_SWITCH_TEST_ID: string =
  "let-projects-choose-call-voice";

export const PROJECT_CALL_VOICES_COPY: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
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
};
