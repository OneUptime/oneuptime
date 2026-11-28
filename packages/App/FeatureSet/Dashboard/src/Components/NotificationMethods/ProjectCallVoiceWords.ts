import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getCallVoice } from "Common/Types/Call/CallVoice";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE VOICE THE PROJECT'S CALLS SPEAK WITH THROUGH THE SERVER'S TWILIO
 * ACCOUNT (#11065), IN PROJECT SETTINGS > NOTIFICATION CHANNELS' MORE
 * SETTINGS.
 *
 * Offered only while the server's master admin lets projects choose
 * (GET /global-config/vars' canProjectsChooseCallVoice, Common/Types/Call/
 * ProjectCallVoice) - never on OneUptime Cloud, whose account OneUptime pays
 * for: the card is then not drawn, and the server refuses a voice. Empty,
 * as every project starts, the calls speak with the server's voice. A
 * Twilio config of the project's own has a voice of its own, chosen on the
 * config (CallSMSConfigTable).
 *
 * React-free, so the page and the tests read the same names and words.
 */

export const PROJECT_CALL_VOICE_TITLE: string = translationKey("Call Voice");

// The card's place on the page: its title's, as in any More settings.
export const PROJECT_CALL_VOICE_PLACE: string = getPageAnchorNameForTitle(
  PROJECT_CALL_VOICE_TITLE,
);

export const PROJECT_CALL_VOICE_TEST_ID: string = "project-call-voice";

export const PROJECT_CALL_VOICE_COPY: {
  cardDescription: string;
  button: string;
  fieldTitle: string;
  serverVoice: string;
  serverVoiceSentence: string;
} = {
  // Under the card's title: what it is for, and what it is not.
  cardDescription: translationKey(
    "The voice your project's calls speak with when they go out through this server's Twilio account. A Twilio config of your own has a voice of its own.",
  ),
  button: translationKey("Choose Voice"),
  fieldTitle: translationKey("Voice"),
  // No voice chosen: the server's, whichever it is.
  serverVoice: translationKey("This server's voice"),
  // Under the picker while it is empty.
  serverVoiceSentence: translationKey(
    "Calls speak with the voice this server's admin chose for its Twilio account.",
  ),
};

/*
 * The card as More settings' folded header names it: with the voice's name
 * once the project chose one, and unset - the server's voice - otherwise.
 */
export const getProjectCallVoiceFoldedItem: (
  value: unknown,
) => FoldedSectionItem = (value: unknown): FoldedSectionItem => {
  const voiceName: string | undefined = getCallVoice(value)?.name;

  return foldedSectionItem(PROJECT_CALL_VOICE_TITLE, {
    key: PROJECT_CALL_VOICE_PLACE,
    isSet: Boolean(voiceName),
    value: voiceName || "",
  });
};
