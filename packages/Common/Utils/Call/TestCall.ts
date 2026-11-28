import { CallRequestMessage } from "../../Types/Call/CallRequest";
import { ONEUPTIME_PRODUCT_NAME } from "../../Types/Branding/ProductBranding";
import { translationKey, Translator } from "../../Types/Translator";

/*
 * WHAT SEND TEST CALL SAYS, IN THE LANGUAGE OF THE PERSON WHO SENT IT
 * (#11461).
 *
 * Two buttons make a test call, to the number the person sending it typed
 * - their own phone:
 *
 *   - Make test call, on Admin Dashboard > Settings > Call and SMS: through
 *     the server's own settings, by a master admin (Notification
 *     ServerTestSendService);
 *   - Send Test Call, on a project's Twilio config: through the project's
 *     own account, by a member who may add one (Notification API/Call.ts).
 *
 * Each says one sentence: in English as it always did, word for word, and -
 * for a person who reads another language - in theirs too (CallRequest's
 * inLanguage, Server/Utils/Call/CallInLanguage), said by a voice of that
 * language where the account has one, as an on-call page is. So the test
 * tests the call a page is.
 *
 * "OneUptime", which an installation that goes by its own name says instead
 * (ProductBrandingText), and which a voice says as two words (CallSpeech).
 *
 * Pure, with no Node, browser or database APIs.
 */

// What the server's test call says, in English: SERVER_TEST_CALL_TEXT.
export const SERVER_TEST_CALL_ENGLISH: string = `This is a test call from ${ONEUPTIME_PRODUCT_NAME}. Calls from this server work.`;

// What a project's Twilio config's test call says, in English.
export const PROJECT_TEST_CALL_ENGLISH: string = `This is a test call from ${ONEUPTIME_PRODUCT_NAME}.`;

// The same, in each language.
export const SERVER_TEST_CALL_SENTENCE: string = translationKey(
  "This is a test call from {{product}}. Calls from this server work.",
);

export const PROJECT_TEST_CALL_SENTENCE: string = translationKey(
  "This is a test call from {{product}}.",
);

// What the server's test call says: in English, or in a translator's language.
export const getServerTestCallData: (
  translator?: Translator | undefined,
) => CallRequestMessage["data"] = (
  translator?: Translator | undefined,
): CallRequestMessage["data"] => {
  return [
    {
      sayMessage: translator
        ? translator.translateTemplate(SERVER_TEST_CALL_SENTENCE, {
            product: ONEUPTIME_PRODUCT_NAME,
          })
        : SERVER_TEST_CALL_ENGLISH,
    },
  ];
};

// What a project's Twilio config's test call says: in English, or in a translator's language.
export const getProjectTestCallData: (
  translator?: Translator | undefined,
) => CallRequestMessage["data"] = (
  translator?: Translator | undefined,
): CallRequestMessage["data"] => {
  return [
    {
      sayMessage: translator
        ? translator.translateTemplate(PROJECT_TEST_CALL_SENTENCE, {
            product: ONEUPTIME_PRODUCT_NAME,
          })
        : PROJECT_TEST_CALL_ENGLISH,
    },
  ];
};
