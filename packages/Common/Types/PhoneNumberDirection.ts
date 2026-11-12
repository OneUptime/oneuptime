import TwilioPhoneNumbers from "./CallAndSMS/TwilioPhoneNumbers";
import DatabaseProperty from "./Database/DatabaseProperty";
import { JSONObject, ObjectType } from "./JSON";
import {
  getReadingDirection,
  getTextReadingDirectionByMostLetters,
  LEFT_TO_RIGHT,
  POP_DIRECTIONAL_ISOLATE,
  ReadingDirection,
} from "./ReadingDirection";
import { getListSeparator } from "./Translator";

/*
 * A PHONE NUMBER READS +447700900123 IN EVERY LANGUAGE.
 *
 * A phone number is written left to right whatever the language around it:
 * its plus sign first, then the country code, then the rest. A number is a
 * run of digits after a "+" with no letter to say which way it reads, so on
 * a page read right to left (Persian, Arabic) it takes the page's way, and
 * the bidi algorithm puts the "+" at the visual end of the digits:
 * +447700900123 was drawn 447700900123+ in the Twilio Config table, and
 * "+1 ••• ••• 4821" was drawn "4821 ••• ••• 1+".
 *
 * So every number the product prints is set apart in an isolate that reads
 * left to right: drawn as an element, PhoneNumberText (Common/UI/Components/
 * PhoneNumber) - a <bdi dir="ltr">, as the IDs, hidden values and code are
 * drawn - and in a line that can only be text (a sentence's value, a native
 * tooltip, a dropdown's label), phoneNumberInLine below.
 *
 * A name given in a number's place - a Twilio number's friendly name,
 * "Support line" - reads the way most of its letters do, as any value
 * someone wrote (IsolatedText): only a value with no letter at all is a
 * number, and reads left to right.
 */

/*
 * LEFT-TO-RIGHT ISOLATE and RIGHT-TO-LEFT ISOLATE: what follows one, up to
 * its PDI, reads that way. Written here, not read from CodeInSentence: that
 * module loads only with Arabic or Persian words, and every table and
 * detail card loads this one (Tests/UI/SignInFirstLoadBuild).
 */
const LEFT_TO_RIGHT_ISOLATE: string = String.fromCharCode(0x2066);
const RIGHT_TO_LEFT_ISOLATE: string = String.fromCharCode(0x2067);

/*
 * The way a phone number reads: left to right - or, for a name in its
 * place, the way most of its letters do.
 */
export const getPhoneNumberDirection: (
  phoneNumber: string | null | undefined,
) => ReadingDirection = (
  phoneNumber: string | null | undefined,
): ReadingDirection => {
  return getTextReadingDirectionByMostLetters(phoneNumber) || LEFT_TO_RIGHT;
};

/*
 * The number a stored value holds, as text: a Phone (any DatabaseProperty),
 * a string, or the { _type: "Phone", value } a record carries before it is
 * read into its model. Empty for anything else - never "[object Object]".
 */
export const getPhoneNumberValueText: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (value instanceof DatabaseProperty) {
    return value.toString().trim();
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const json: JSONObject = value as JSONObject;

    if (
      json["_type"] === ObjectType.Phone &&
      typeof json["value"] === "string"
    ) {
      return json["value"].trim();
    }
  }

  return "";
};

/*
 * The numbers a stored value holds: one, or each of a list typed as one
 * value ("+6581234567, +447700900123" - a Twilio account's SMS numbers,
 * separated by commas, semicolons or lines). No phone number has one of
 * those in it, so a value with one is a list. None for an empty value.
 */
export const getPhoneNumbersOfValue: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  return TwilioPhoneNumbers.getListEntries(getPhoneNumberValueText(value));
};

/*
 * A phone number in a line that can only be text: a sentence's value
 * ("Twilio is calling from {{phoneNumber}}."), a native tooltip (title), a
 * dropdown's label. Where it reads the other way from the page - a number
 * on a Persian or Arabic page - it is set apart in an isolate of its way
 * (LRI ... PDI), so it reads +447700900123 inside the page's words. Where
 * it reads the page's way it is left exactly as it is, so a number copied
 * from an English page carries nothing it cannot be typed back in with.
 */
export const phoneNumberInLine: (
  phoneNumber: string | null | undefined,
  pageLanguage: string | null | undefined,
) => string = (
  phoneNumber: string | null | undefined,
  pageLanguage: string | null | undefined,
): string => {
  const text: string = (phoneNumber || "").trim();

  if (!text) {
    return "";
  }

  const direction: ReadingDirection = getPhoneNumberDirection(text);

  if (direction === getReadingDirection(pageLanguage)) {
    return text;
  }

  return `${
    direction === LEFT_TO_RIGHT ? LEFT_TO_RIGHT_ISOLATE : RIGHT_TO_LEFT_ISOLATE
  }${text}${POP_DIRECTIONAL_ISOLATE}`;
};

/*
 * Phone numbers listed in a line that can only be text - "+2 more"'s
 * tooltip - each set apart as phoneNumberInLine sets one, separated the
 * reader's way (", ", "، " in Persian and Arabic, "、" in Japanese and
 * Chinese). Joined into one plain string on a Persian page, every number's
 * "+" stood at its end and the list read from its last number.
 */
export const phoneNumberListInLine: (
  phoneNumbers: ReadonlyArray<string>,
  pageLanguage: string | null | undefined,
) => string = (
  phoneNumbers: ReadonlyArray<string>,
  pageLanguage: string | null | undefined,
): string => {
  return phoneNumbers
    .map((phoneNumber: string): string => {
      return phoneNumberInLine(phoneNumber, pageLanguage);
    })
    .filter((phoneNumber: string): boolean => {
      return phoneNumber.length > 0;
    })
    .join(getListSeparator(pageLanguage || undefined));
};
