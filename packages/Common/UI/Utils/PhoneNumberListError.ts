import TwilioPhoneNumbers, {
  PHONE_NUMBER_LIST_EXAMPLE,
} from "../../Types/CallAndSMS/TwilioPhoneNumbers";
import Phone from "../../Types/Phone";
import { translateTemplate, translationKey } from "./TranslateTemplate";

/*
 * What a form says under a list of phone numbers that holds something that
 * is not one - a Twilio config's secondary numbers or its SMS numbers, in a
 * project's settings or the Admin Dashboard's. The rule is the server's
 * (TwilioPhoneNumbers.getListError): entries separated by commas, each a
 * phone number with its country code, so a list a form lets through is one
 * the server stores. Said in the reader's language, naming the entry, with
 * the server's example list ({{example}}: PHONE_NUMBER_LIST_EXAMPLE) - the
 * one the SMS numbers field shows - rather than numbers of its own that
 * every locale would have to repeat.
 */
export const PHONE_NUMBER_LIST_ERROR: string = translationKey(
  "{{entry}} is not a phone number. Write each number with its country code and separate them with commas, like {{example}}.",
);

export const getPhoneNumberListError: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  for (const entry of TwilioPhoneNumbers.getListEntries(value)) {
    try {
      new Phone(entry);
    } catch {
      return translateTemplate(PHONE_NUMBER_LIST_ERROR, {
        entry: `"${entry}"`,
        example: PHONE_NUMBER_LIST_EXAMPLE,
      });
    }
  }

  return null;
};
