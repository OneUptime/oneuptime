import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../Types/ReadingDirection";

/*
 * A sentence drawn on a page sets its values apart from its words in a
 * Unicode isolate where they could move them (Common/Types/ReadingDirection
 * setApartInSentence, TranslatedSentence): a Persian sentence's name in
 * Latin letters, its time and its count.
 */

// A value as a sentence holds it, set apart: FSI value PDI.
export const isolated: (value: string) => string = (value: string): string => {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
};

// LRI, RLI, FSI and PDI: every mark an isolate is made of.
const ISOLATE_MARKS_REGEX: RegExp = /[\u2066-\u2069]/g;

/*
 * The words of a text as a reader sees them, without the isolates' marks:
 * for a test about what a sentence says, not about how it is laid out.
 */
export const withoutIsolateMarks: (text: string) => string = (
  text: string,
): string => {
  return text.replace(ISOLATE_MARKS_REGEX, "");
};
