import {
  DEFAULT_INCOMING_CALL_GREETING_MESSAGE,
  DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE,
  DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE,
} from "Common/Types/IncomingCall/IncomingCallMessages";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * AN INCOMING CALL POLICY'S SETTINGS, IN PLAIN WORDS.
 *
 * The page used to hold two cards. "Voice Messages", with help such as
 * "Text-to-speech message played to callers when they first connect", and
 * "Policy Settings", whose one Edit dialog held three things that are not
 * one thing: "Enabled" ("Enable or disable this policy"), a switch "Repeat
 * Policy If No One Answers" ("Restart from first rule if all escalations
 * fail") and a number "Repeat Policy Times" that meant something only while
 * that switch was on. An emptied message read "No greeting message set",
 * while callers in fact heard a message of OneUptime's own.
 *
 * Now there are three cards, each about one thing:
 *   - Answer Calls: one switch, "Answer calls to this policy's numbers",
 *     that saves the moment it is flipped (it stores isEnabled) and asks
 *     before it turns calls away, the one press that silences a hotline.
 *     While it is off, the policy's Overview opens with a banner that says
 *     so, and Start answering calls turns it back on there.
 *   - Repeat Policy: what happens when nobody answers after the last rule,
 *     one plain choice (RepeatChoice.ts, the on-call policy's own card).
 *   - Voice Messages: what callers hear, each message saying when it is
 *     read out, and an emptied one showing the words read in its place,
 *     marked Default.
 *
 * Nothing stored changed. Kept free of React, so App/Tests can read it.
 */

export const IncomingCallAnswerCallsCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch while the policy answers calls.
  switchOnDescription: string;
  // Under it while it does not, and in the Overview's banner.
  switchOffDescription: string;
  // The dialog before calls are turned away.
  turnOffConfirmTitle: string;
  turnOffConfirmDescription: string;
  turnOffConfirmButton: string;
  // The banner on the Overview while calls are off, and its button.
  offBannerTitle: string;
  startAnsweringButton: string;
} = {
  cardTitle: translationKey("Answer Calls"),
  cardDescription: translationKey(
    "Turn the line off without deleting it. Its numbers, rules and call logs are kept.",
  ),
  switchTitle: translationKey("Answer calls to this policy's numbers"),
  switchOnDescription: translationKey(
    "Calls ring the people its escalation rules name.",
  ),
  switchOffDescription: translationKey(
    "Callers hear that the line is not available, and nobody is rung.",
  ),
  turnOffConfirmTitle: translationKey("Stop answering calls?"),
  turnOffConfirmDescription: translationKey(
    "Until it is turned back on, everyone who calls this policy's numbers hears that the line is not available, and nobody is rung.",
  ),
  turnOffConfirmButton: translationKey("Stop answering calls"),
  offBannerTitle: translationKey("Not answering calls"),
  startAnsweringButton: translationKey("Start answering calls"),
};

// The column the switch writes.
export type IncomingCallAnswerCallsColumn = "isEnabled";

export const INCOMING_CALL_ANSWER_CALLS_COLUMN: IncomingCallAnswerCallsColumn =
  "isEnabled";

// The data-testid of the "Answer calls to this policy's numbers" switch.
export const INCOMING_CALL_ANSWER_CALLS_TEST_ID: string =
  "incoming-call-answer-calls";

// The data-testids of the Overview's banner while calls are off.
export const INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID: string =
  "incoming-call-answer-calls-off";
export const INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID: string =
  "incoming-call-start-answering";
export const INCOMING_CALL_START_ANSWERING_ERROR_TEST_ID: string =
  "incoming-call-start-answering-error";

export interface IncomingCallVoiceMessageCopy {
  // The column the message is kept in.
  column: "greetingMessage" | "noAnswerMessage" | "noOneAvailableMessage";
  title: string;
  // When it is read out.
  description: string;
  // What callers hear while it is empty: OneUptime's own words, in English.
  defaultMessage: string;
}

export const IncomingCallVoiceMessagesCopy: {
  cardTitle: string;
  cardDescription: string;
  editButtonText: string;
  dialogTitle: string;
  greeting: IncomingCallVoiceMessageCopy;
  noAnswer: IncomingCallVoiceMessageCopy;
  noOneAvailable: IncomingCallVoiceMessageCopy;
  /*
   * Beside the words of an emptied message, which OneUptime reads out in its
   * place.
   */
  defaultPill: string;
} = {
  cardTitle: translationKey("Voice Messages"),
  cardDescription: translationKey(
    "What callers hear, read out by a text-to-speech voice.",
  ),
  editButtonText: translationKey("Edit Messages"),
  dialogTitle: translationKey("Edit Voice Messages"),
  greeting: {
    column: "greetingMessage",
    title: translationKey("Greeting Message"),
    description: translationKey(
      "Read out when someone calls, before anyone is rung.",
    ),
    defaultMessage: DEFAULT_INCOMING_CALL_GREETING_MESSAGE,
  },
  noAnswer: {
    column: "noAnswerMessage",
    title: translationKey("No Answer Message"),
    description: translationKey(
      "Read out when every rule rang and nobody answered, before the call ends.",
    ),
    defaultMessage: DEFAULT_INCOMING_CALL_NO_ANSWER_MESSAGE,
  },
  noOneAvailable: {
    column: "noOneAvailableMessage",
    title: translationKey("No One Available Message"),
    description: translationKey(
      "Read out when nobody can be rung, such as when nobody is on call.",
    ),
    defaultMessage: DEFAULT_INCOMING_CALL_NO_ONE_AVAILABLE_MESSAGE,
  },
  defaultPill: translationKey("Default"),
};

// The data-testid of the Default pill beside the words of an emptied message.
export const INCOMING_CALL_DEFAULT_MESSAGE_PILL_TEST_ID: string =
  "incoming-call-default-message";

// The three messages, in the order the card lists them.
export const INCOMING_CALL_VOICE_MESSAGES: ReadonlyArray<IncomingCallVoiceMessageCopy> =
  [
    IncomingCallVoiceMessagesCopy.greeting,
    IncomingCallVoiceMessagesCopy.noAnswer,
    IncomingCallVoiceMessagesCopy.noOneAvailable,
  ];

export default IncomingCallVoiceMessagesCopy;
