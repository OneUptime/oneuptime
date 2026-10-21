/*
 * HOW MANY PARTS AN SMS GOES OUT IN.
 *
 * An SMS travels in parts (segments), and the provider bills every part.
 * A part holds 160 characters of the GSM 7-bit alphabet (GSM-7), the one
 * every phone reads: English letters, digits, the common punctuation and a
 * few accented and Greek letters. A text with a single character outside
 * it - a curly quote, an emoji, a letter of another script - goes out in
 * UCS-2 instead, and a part then holds 70. A longer text is split into
 * parts that each give a few places to saying how they join: 153 in GSM-7,
 * 67 in UCS-2.
 *
 * In GSM-7 the characters of its extension table (^ { } \ [ ~ ] | € and
 * form feed) are sent as an escape and the character, so each takes two
 * places, and a part never ends between the two. In UCS-2 a character
 * beyond the Basic Multilingual Plane (most emoji) takes two places, and is
 * never split either. That is how Twilio counts and bills them.
 *
 * Pure, with no Node or browser APIs.
 */

export enum SmsEncoding {
  Gsm7 = "GSM-7",
  Ucs2 = "UCS-2",
}

// What one part holds when the text fits in one.
export const GSM_7_SINGLE_SEGMENT_LENGTH: number = 160;
export const UCS_2_SINGLE_SEGMENT_LENGTH: number = 70;

// What each part of a longer text holds.
export const GSM_7_MULTI_SEGMENT_LENGTH: number = 153;
export const UCS_2_MULTI_SEGMENT_LENGTH: number = 67;

/*
 * The GSM 03.38 basic character set, in table order, without the escape
 * (0x1B) that starts an extension character.
 */
export const GSM_7_BASIC_CHARACTERS: string =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

// Its extension table: each is sent as the escape and the character.
export const GSM_7_EXTENSION_CHARACTERS: string = "\f^{}\\[~]|€";

const BASIC_CHARACTERS: ReadonlySet<string> = new Set<string>(
  Array.from(GSM_7_BASIC_CHARACTERS),
);

const EXTENSION_CHARACTERS: ReadonlySet<string> = new Set<string>(
  Array.from(GSM_7_EXTENSION_CHARACTERS),
);

/*
 * The places one character (a code point) takes in a GSM-7 part: 1 for the
 * basic set, 2 for the extension table, null when GSM-7 does not have it.
 */
export const getGsm7Length: (character: string) => number | null = (
  character: string,
): number | null => {
  if (BASIC_CHARACTERS.has(character)) {
    return 1;
  }

  if (EXTENSION_CHARACTERS.has(character)) {
    return 2;
  }

  return null;
};

// Whether every character of the text is one GSM-7 has.
export const isGsm7Text: (text: string) => boolean = (
  text: string,
): boolean => {
  for (const character of text) {
    if (getGsm7Length(character) === null) {
      return false;
    }
  }

  return true;
};

// The encoding a provider sends the text in.
export const getSmsEncoding: (text: string) => SmsEncoding = (
  text: string,
): SmsEncoding => {
  return isGsm7Text(text) ? SmsEncoding.Gsm7 : SmsEncoding.Ucs2;
};

export interface SmsSegmentCount {
  encoding: SmsEncoding;
  /*
   * The places the text takes: septets in GSM-7 (an extension character
   * counts twice), UTF-16 code units in UCS-2 (a character beyond the Basic
   * Multilingual Plane counts twice).
   */
  length: number;
  // The parts it goes out in, and is billed for: at least one.
  segments: number;
}

/*
 * How many parts of `partLength` places the characters fill, each taking
 * its own number of places and never split between two parts.
 */
const countParts: (
  characterLengths: ReadonlyArray<number>,
  partLength: number,
) => number = (
  characterLengths: ReadonlyArray<number>,
  partLength: number,
): number => {
  let parts: number = 1;
  let used: number = 0;

  for (const characterLength of characterLengths) {
    if (used + characterLength > partLength) {
      parts++;
      used = 0;
    }

    used += characterLength;
  }

  return parts;
};

// How a provider sends the text: its encoding, the places it takes and its parts.
export const countSmsSegments: (text: string) => SmsSegmentCount = (
  text: string,
): SmsSegmentCount => {
  const characters: Array<string> = Array.from(text);
  const gsm7Lengths: Array<number | null> = characters.map(
    (character: string): number | null => {
      return getGsm7Length(character);
    },
  );
  const isGsm7: boolean = gsm7Lengths.every(
    (characterLength: number | null): boolean => {
      return characterLength !== null;
    },
  );

  const characterLengths: Array<number> = isGsm7
    ? (gsm7Lengths as Array<number>)
    : characters.map((character: string): number => {
        // A character beyond the Basic Multilingual Plane is two code units.
        return character.length;
      });

  const length: number = characterLengths.reduce(
    (total: number, characterLength: number): number => {
      return total + characterLength;
    },
    0,
  );

  const singleSegmentLength: number = isGsm7
    ? GSM_7_SINGLE_SEGMENT_LENGTH
    : UCS_2_SINGLE_SEGMENT_LENGTH;
  const multiSegmentLength: number = isGsm7
    ? GSM_7_MULTI_SEGMENT_LENGTH
    : UCS_2_MULTI_SEGMENT_LENGTH;

  return {
    encoding: isGsm7 ? SmsEncoding.Gsm7 : SmsEncoding.Ucs2,
    length: length,
    segments:
      length <= singleSegmentLength
        ? 1
        : countParts(characterLengths, multiSegmentLength),
  };
};

// Whether the text goes out in at most `segments` parts.
export const fitsInSmsSegments: (text: string, segments: number) => boolean = (
  text: string,
  segments: number,
): boolean => {
  return countSmsSegments(text).segments <= segments;
};
