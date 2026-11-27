import { getSpokenCallVoice } from "../../../Types/Call/CallVoice";
import { withDateDisplayLanguage } from "../../../Types/DateLanguage";
import {
  OnCallPassOnAnswer,
  OnCallPassOnResult,
  OnCallPassOnWording,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
  getOnCallPassOnTime,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  describeOnCallPassOnRefusalInLanguage,
  describeOnCallPassOnResultInLanguage,
} from "../../../Types/OnCallDutyPolicy/OnCallPassOnWords";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import { translationKey, Translator } from "../../../Types/Translator";
import { getCallWrongKeySentence } from "../../../Utils/Call/CallKeypad";
import { getCallTranslator } from "../ServerTranslation";

/*
 * WHAT A PAGE'S CALL ANSWERS A KEY WITH, IN THE CALL'S LANGUAGE (#11066).
 *
 * The keypad route (API/UserOnCallLogTimelineAPI) answers a key with what
 * the call itself said it would - its keypad token carries those words,
 * in the call's language already (OnCallKeypadToken). A few answers it
 * words itself, from what happened: what escalating did, once 2 is
 * pressed; that a 1 could not acknowledge the page; and "That key does
 * nothing." before it asks again. A call in its person's language says
 * those in that language too, which is the language its voice speaks: the
 * voice is in the token, and a voice is only ever one of OneUptime's
 * (Types/Call/CallVoice), each of one language. A call in English - the
 * account's default voice, an English voice, a call placed before this
 * release - is answered in English, word for word as it always was.
 *
 * Imports nothing that reads a database: the keypad route's middleware
 * (Server/Middleware/NotificationMiddleware) reads it too.
 */

/*
 * What a call says when its 1 could not acknowledge the page: the
 * notification kept changing under every try (OnCallNotificationStatus's
 * ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE, which is this sentence). The
 * call ends with it, so the person cannot press again there.
 */
export const CALL_NOT_ACKNOWLEDGED_SENTENCE: string = translationKey(
  "This page could not be acknowledged just now. Please acknowledge it from the dashboard. Good bye.",
);

// The language a call speaks, by the voice it speaks with: English for none.
export function getCallAnswerLanguage(voice: string | null | undefined): string {
  return getSpokenCallVoice(voice)?.readerLanguage || DEFAULT_READER_LANGUAGE;
}

// The translator of a call's answers, by the voice it speaks with.
export function getCallAnswerTranslator(
  voice: string | null | undefined,
): Translator {
  return getCallTranslator(getCallAnswerLanguage(voice));
}

// How a call's answer to 2 ends: the call ends with it.
export const ON_CALL_PAGE_CALL_GOOD_BYE: string = translationKey("Good bye.");

/*
 * What a call says first once 2 escalated its page, for each kind of
 * record it can be about - each whole, so a language words "this incident"
 * and "this alert" its own way - and for a page about none.
 */
const ESCALATED: Readonly<Record<string, string>> = {
  incident: translationKey("You escalated this incident."),
  alert: translationKey("You escalated this alert."),
  "incident episode": translationKey("You escalated this incident episode."),
  "alert episode": translationKey("You escalated this alert episode."),
  page: translationKey("You escalated this page."),
};

// A fixed sentence in a translator's language, or as written without one.
const say: (translator: Translator, sentence: string) => string = (
  translator: Translator,
  sentence: string,
): string => {
  return translator.translateText(sentence) || sentence;
};

const isEnglish: (translator: Translator) => boolean = (
  translator: Translator,
): boolean => {
  return translator.language === DEFAULT_READER_LANGUAGE;
};

/*
 * "That key does nothing.", before a call asks for its keys again
 * (Utils/Call/CallKeypad), in the language of the call's voice.
 */
export function getCallAnswerWrongKeySentence(
  voice: string | null | undefined,
): string {
  return getCallWrongKeySentence(getCallAnswerTranslator(voice));
}

/*
 * What a call says when its 1 could not acknowledge the page, before it
 * ends (OnCallNotificationStatus), in the language of the call's voice.
 */
export function getCallAnswerNotAcknowledged(
  voice: string | null | undefined,
): string {
  return say(getCallAnswerTranslator(voice), CALL_NOT_ACKNOWLEDGED_SENTENCE);
}

/*
 * What a call says once 2 escalated its page: that it did, what came of it
 * - "The policy is now paging Platform leads (Level 2 of 3): Sam Lee." -
 * and good bye, in the language of the call's voice. English says what the
 * server's pages say (getOnCallPassOnSentence); any other language what the
 * Dashboard's Escalate dialog says in it (OnCallPassOnWords). A time is the
 * person's own (`wording.timezone`), written in the call's language.
 */
export function getCallAnswerEscalated(data: {
  voice: string | null | undefined;
  // What the page is about: "incident", "alert episode" - or "page".
  noun: string;
  result: OnCallPassOnResult;
  wording?: OnCallPassOnWording | undefined;
}): string {
  const translator: Translator = getCallAnswerTranslator(data.voice);
  const wording: OnCallPassOnWording = data.wording || {};
  const escalated: string = ESCALATED[data.noun] || ESCALATED["page"]!;

  const sentence: string = isEnglish(translator)
    ? getOnCallPassOnSentence(data.result, wording)
    : withDateDisplayLanguage(translator.language, (): string => {
        return describeOnCallPassOnResultInLanguage(
          data.result,
          translator,
          (at: Date): string => {
            return getOnCallPassOnTime(at, wording);
          },
        );
      });

  return `${say(translator, escalated)} ${sentence} ${say(
    translator,
    ON_CALL_PAGE_CALL_GOOD_BYE,
  )}`;
}

/*
 * What a call says when 2 could not escalate its page - why, then good
 * bye - in the language of the call's voice: English as the server's pages
 * say it, `wording.recordLabel` naming the record ("This incident"), any
 * other language as the Dashboard's dialog says it.
 */
export function getCallAnswerNotEscalated(data: {
  voice: string | null | undefined;
  answer: OnCallPassOnAnswer;
  wording?: OnCallPassOnWording | undefined;
}): string {
  const translator: Translator = getCallAnswerTranslator(data.voice);

  const sentence: string = isEnglish(translator)
    ? getOnCallPassOnRefusalSentence(data.answer, data.wording)
    : describeOnCallPassOnRefusalInLanguage(data.answer, translator);

  return `${sentence} ${say(translator, ON_CALL_PAGE_CALL_GOOD_BYE)}`;
}
