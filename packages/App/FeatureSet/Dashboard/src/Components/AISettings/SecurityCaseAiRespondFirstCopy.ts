import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * SECURITY EVENTS -> AI -> SETTINGS: LET ONEUPTIME AI RESPOND FIRST (#10353).
 * One switch and, once it is on, two choices - the priority OneUptime AI
 * holds cases below, and for how long at most - each saved the moment it
 * is made, in plain words: what holding means, what ends it, and what is
 * never held. Types/SecurityCase/SecurityCaseAiHold says what the server
 * does; these say it to the person who sets it.
 *
 * React-free, so the card and its tests read these exact strings; every
 * sentence goes through translationKey() so npm run i18n:extract finds it.
 */
export const SecurityCaseAiRespondFirstCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchDescription: string;
  // Offered only while OneUptime AI may work cases at all.
  needsResponder: string;
  thresholdTitle: string;
  thresholdDescription: string;
  // Under the picker: what the choice holds, and what alerts people at once.
  thresholdHolds: string;
  thresholdNothingHeld: string;
  holdTitle: string;
  holdDescription: string;
  // A hold time, in the picker.
  holdMinutes: PluralTemplate;
  // What is never held.
  neverHeld: string;
  // Every containment kind asks first: most cases reach people once it asks.
  asksFirstHint: string;
} = {
  cardTitle: translationKey("Let OneUptime AI respond first"),
  cardDescription: translationKey(
    "Hold a new case's alerts while OneUptime AI works it, and alert people only when it needs them.",
  ),
  switchTitle: translationKey("Respond first"),
  switchDescription: translationKey(
    "If OneUptime AI contains a case, nobody is alerted and your channels get one summary. If it needs a person, everyone is alerted at once.",
  ),
  needsResponder: translationKey(
    "Turn on Triage new cases and Work cases end to end above, so OneUptime AI can respond first.",
  ),
  thresholdTitle: translationKey("For cases below"),
  thresholdDescription: translationKey(
    "Cases at this priority and above alert people at once.",
  ),
  thresholdHolds: translationKey(
    "Held: {{held}}. Alerted at once: {{alerted}}.",
  ),
  thresholdNothingHeld: translationKey(
    "No case is below this priority, so none is held.",
  ),
  holdTitle: translationKey("Alert people anyway after"),
  holdDescription: translationKey(
    "If OneUptime AI has not resolved a case by then, everyone it held the case from is alerted.",
  ),
  holdMinutes: {
    one: "{{count}} minute",
    other: "{{count}} minutes",
  },
  neverHeld: translationKey(
    "Never held: your highest priority, several cases opening within minutes, a case whose data tries to steer an AI, and a case about an address, user or host OneUptime AI resolved in the last 24 hours. Response target alerts are never held.",
  ),
  asksFirstHint: translationKey(
    "OneUptime AI asks before it blocks or contains anything, so it alerts people as soon as it asks. Let it block addresses on its own to contain scanners without waking anyone.",
  ),
};

export const SECURITY_CASE_AI_RESPOND_FIRST_TEST_ID: string =
  "security-case-ai-respond-first";
