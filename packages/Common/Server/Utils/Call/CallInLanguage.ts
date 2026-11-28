import {
  CallInLanguage,
  CallRequestMessage,
} from "../../../Types/Call/CallRequest";
import {
  DEFAULT_READER_LANGUAGE,
  toReaderLanguage,
} from "../../../Types/ReaderLanguage";
import { Translator } from "../../../Types/Translator";
import { getCallTranslator } from "../ServerTranslation";

/*
 * A CALL'S WORDS IN THE LANGUAGE OF THE PERSON IT CALLS (#11066).
 *
 * A call is built in English, as every call has been (CallRequest's data),
 * and - for a person who reads OneUptime in another language - in theirs
 * too (CallRequest's inLanguage), with their call translator
 * (getCallTranslator). Every call to a person is: an on-call page and a
 * test page (#11066), the code that verifies their phone number and Send
 * Test Call (#11461).
 *
 * Which of the two is spoken is decided where the call is placed:
 *
 *   - through Twilio, by the voice the account chose (Utils/Call/
 *     CallLanguage's getSpokenCalls): the person's language by a voice of
 *     it, else English - an account that keeps its default voice speaks
 *     English only, and neither Amazon Polly nor Google has a Persian voice;
 *   - through the server's own call and SMS gateway (#11459), by the
 *     gateway, which is handed both and picks its own voice: one with a
 *     Persian voice speaks Persian.
 *
 * So the words go with the call for every language OneUptime writes in but
 * English - Persian included - and never for English, whose call is its
 * data alone, byte for byte as it always was. A language OneUptime does not
 * write in is English.
 */
export const getCallInLanguage: (
  // The person's language, as OneUptime names it ("de", "zh-TW"), or any tag.
  language: string | null | undefined,
  // The call's words, in the language the translator writes.
  build: (translator: Translator) => CallRequestMessage["data"],
) => CallInLanguage | undefined = (
  language: string | null | undefined,
  build: (translator: Translator) => CallRequestMessage["data"],
): CallInLanguage | undefined => {
  const code: string = toReaderLanguage(language);

  if (code === DEFAULT_READER_LANGUAGE) {
    return undefined;
  }

  return {
    language: code,
    data: build(getCallTranslator(code)),
  };
};

export default getCallInLanguage;
