import { CallRequestMessage, Say } from "../../Types/Call/CallRequest";
import { ONEUPTIME_PRODUCT_NAME } from "../../Types/Branding/ProductBranding";
import { translationKey, Translator } from "../../Types/Translator";
import { writeCodeForCall } from "./CallSpeech";
import { getOnCallPageCallOpening } from "./OnCallPageCall";

/*
 * THE CALL THAT READS A PERSON THE CODE THAT VERIFIES THEIR PHONE NUMBER
 * (Server/Services/UserCallService), IN THEIR LANGUAGE (#11461).
 *
 * Who calls, the code three times, and goodbye. In English as it always
 * was, word for word - what a Notification service of the release before,
 * an account that keeps its default voice, a person who reads English and
 * every call to someone whose language no voice of the account speaks hear
 * - and, for a person who reads another language, in theirs too
 * (CallRequest's inLanguage, Server/Utils/Call/CallInLanguage), said by a
 * voice of that language where the account has one, as an on-call page is.
 *
 * A code read in another language must stay unmistakable: in the person's
 * language each sentence carries its code (Say.code), whose digits a voice
 * says one at a time, with a pause between each, three times over
 * (Utils/Call/CallSpeech). The English keeps the spaced-out code it always
 * said, which its voices read digit by digit.
 *
 * Pure, with no Node, browser or database APIs.
 */

// How often the call says the code.
export const VERIFICATION_CALL_CODE_REPEATS: number = 3;

// The sentence that says the code, in each language: the code as the call writes it.
export const VERIFICATION_CALL_CODE_SENTENCE: string = translationKey(
  "Your verification code is {{code}}.",
);

// The goodbye, in each language.
export const VERIFICATION_CALL_GOODBYE: string = translationKey(
  "Thank you for using {{product}}. Good bye.",
);

/*
 * What the call says, in English - byte for byte the call every release
 * has made - or, with a translator, in its language: who calls, the code
 * VERIFICATION_CALL_CODE_REPEATS times, and goodbye. "OneUptime", which an
 * installation that goes by its own name says instead (ProductBrandingText),
 * and which a voice says as two words (CallSpeech).
 */
export const getVerificationCallData: (
  code: string,
  translator?: Translator | undefined,
) => CallRequestMessage["data"] = (
  code: string,
  translator?: Translator | undefined,
): CallRequestMessage["data"] => {
  // "4  8  2  9  1  3": spaced out, to be read slower.
  const writtenCode: string = writeCodeForCall(code);
  const sentences: Array<Say> = [];

  if (!translator) {
    sentences.push({
      sayMessage: `This is a call from ${ONEUPTIME_PRODUCT_NAME}.`,
    });

    for (
      let index: number = 0;
      index < VERIFICATION_CALL_CODE_REPEATS;
      index++
    ) {
      sentences.push({
        sayMessage: "Your verification code is " + writtenCode,
      });
    }

    sentences.push({
      sayMessage: `Thank you for using ${ONEUPTIME_PRODUCT_NAME}. Good bye.`,
    });

    return sentences;
  }

  sentences.push({
    sayMessage: getOnCallPageCallOpening(undefined, translator),
  });

  for (let index: number = 0; index < VERIFICATION_CALL_CODE_REPEATS; index++) {
    sentences.push({
      sayMessage: translator.translateTemplate(
        VERIFICATION_CALL_CODE_SENTENCE,
        {
          code: writtenCode,
        },
      ),
      // Said a digit at a time, with a pause between each, in any language.
      code: writtenCode,
    });
  }

  sentences.push({
    sayMessage: translator.translateTemplate(VERIFICATION_CALL_GOODBYE, {
      product: ONEUPTIME_PRODUCT_NAME,
    }),
  });

  return sentences;
};
