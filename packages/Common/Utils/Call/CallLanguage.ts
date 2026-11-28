import { CallRequestMessage } from "../../Types/Call/CallRequest";
import {
  CallVoice,
  SpokenCallVoice,
  getCallVoice,
  getCallVoiceForLanguage,
} from "../../Types/Call/CallVoice";
import {
  DEFAULT_READER_LANGUAGE,
  toReaderLanguage,
} from "../../Types/ReaderLanguage";

/*
 * WHICH OF A CALL'S WORDS ARE SPOKEN, AND BY WHICH VOICE (#11066).
 *
 * A call to a person who reads another language carries its words twice:
 * in English, as every call has, and in their language
 * (Types/Call/CallRequest's inLanguage). Which is spoken is decided where
 * the call is placed, by the voice the Twilio account that places it chose
 * (Types/Call/CallVoice):
 *
 *   - a voice chosen, and a voice of the person's language of its kind
 *     (getCallVoiceForLanguage): the person's language, by that voice;
 *   - no voice chosen - the account's default voice, which speaks English
 *     only - or a language no provider has a voice for (Persian): English,
 *     by the account's voice, as every call was spoken.
 *
 * One language's words are never given to another language's voice: the
 * words in the person's language go only with a voice of it, and English
 * with the account's voice or its default one.
 *
 * Pure, with no Node, browser or database APIs: the Notification service
 * places the call by it, and the tests read it.
 */

// A call's words as one voice speaks them.
export interface SpokenCall {
  data: CallRequestMessage["data"];
  /*
   * The voice that speaks them, as TwiML names it: one of OneUptime's.
   * Undefined for the account's default voice, which speaks English.
   */
  voice: string | undefined;
  // The language of the words, as OneUptime names it: "en", "de".
  language: string;
}

/*
 * The ways a call can be spoken, best first: in its person's language by a
 * voice of that language - when it carries its words in one, and the
 * account chose a voice that has one of its kind there - then in English,
 * by the voice the account chose or its default one. The call is built in
 * the first way that builds (Notification service, CallService): English
 * is always the last, so a call is always placed.
 */
export function getSpokenCalls(
  callRequest: CallRequestMessage,
  // The voice the account that places the call chose, or none.
  accountVoice: string | null | undefined,
): Array<SpokenCall> {
  const chosen: CallVoice | null = getCallVoice(accountVoice);

  const english: SpokenCall = {
    data: callRequest.data,
    voice: chosen?.value,
    language: DEFAULT_READER_LANGUAGE,
  };

  const inLanguage: CallRequestMessage["inLanguage"] = callRequest.inLanguage;

  if (
    !inLanguage ||
    typeof inLanguage !== "object" ||
    !Array.isArray(inLanguage.data) ||
    inLanguage.data.length === 0 ||
    typeof inLanguage.language !== "string"
  ) {
    return [english];
  }

  const language: string = toReaderLanguage(inLanguage.language);

  if (language === DEFAULT_READER_LANGUAGE) {
    return [english];
  }

  const voice: SpokenCallVoice | null = getCallVoiceForLanguage(
    chosen,
    language,
  );

  if (!voice || voice.readerLanguage !== language) {
    return [english];
  }

  return [{ data: inLanguage.data, voice: voice.value, language }, english];
}

// The way a call is spoken: the first of getSpokenCalls.
export function getSpokenCall(
  callRequest: CallRequestMessage,
  accountVoice: string | null | undefined,
): SpokenCall {
  return getSpokenCalls(callRequest, accountVoice)[0]!;
}
