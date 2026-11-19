import {
  FOLDED_SECTION_OFF,
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * VOICEMAIL ON ON-CALL CALLS (#6594), IN PROJECT SETTINGS > NOTIFICATION
 * CHANNELS' MORE SETTINGS.
 *
 * To Twilio, a call voicemail picks up is answered, like one a person picks
 * up. Most carriers send a call nobody picks up to voicemail long before
 * Twilio stops ringing, so for most responders "did not pick up" ended as
 * answered: the incident's feed said nothing, and the call's log said it
 * was answered. Now each on-call call asks Twilio, in the background, who
 * answered it, and a call voicemail answered counts as not answered, and
 * leaves a short message (Project.detectVoicemailOnCalls).
 *
 * On for every project: it is what a call page is for, and Twilio's fee is
 * small. One switch, saved when flipped, folded away with the project's
 * other paging defaults - most projects never change it. Folded, the header
 * names it, and says Off while it is off.
 *
 * React-free, so the page and the tests read the same names and words.
 */

export const VOICEMAIL_DETECTION_TITLE: string = translationKey(
  "Voicemail on On-Call Calls",
);

// The card's place on the page: its title's, as in any More settings.
export const VOICEMAIL_DETECTION_PLACE: string = getPageAnchorNameForTitle(
  VOICEMAIL_DETECTION_TITLE,
);

// The column the switch writes.
export type VoicemailDetectionColumn = "detectVoicemailOnCalls";

export const VOICEMAIL_DETECTION_COLUMN: VoicemailDetectionColumn =
  "detectVoicemailOnCalls";

// The switch's data-testid.
export const VOICEMAIL_DETECTION_TEST_ID: string = "detect-voicemail-on-calls";

export const VOICEMAIL_DETECTION_COPY: {
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
} = {
  // Under the card's title: what it is for.
  cardDescription: translationKey(
    "Tell whether a person or voicemail answered each on-call phone call, so a call that went to voicemail is not taken as answered.",
  ),
  switchTitle: translationKey("Detect voicemail on on-call calls"),
  // What "on" does, and what it costs.
  switchOnDescription: translationKey(
    "A call that voicemail answers counts as not answered, and leaves a short message. Twilio charges for each answered call it checks.",
  ),
  // What "off" does.
  switchOffDescription: translationKey(
    "A call that voicemail answers counts as answered.",
  ),
};

/*
 * The card as More settings' folded header names it: Off while it is off,
 * and unset - on, as every project starts - otherwise.
 */
export const getVoicemailDetectionFoldedItem: (
  isDetecting: boolean,
) => FoldedSectionItem = (isDetecting: boolean): FoldedSectionItem => {
  return foldedSectionItem(VOICEMAIL_DETECTION_TITLE, {
    key: VOICEMAIL_DETECTION_PLACE,
    isSet: !isDetecting,
    value: FOLDED_SECTION_OFF,
    translateValue: true,
  });
};
