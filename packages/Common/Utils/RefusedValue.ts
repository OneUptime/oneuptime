/*
 * THE PART OF A REFUSED VALUE AN ERROR MESSAGE REPEATS.
 *
 * A validator says what it refused - "Email x is not in valid format." - so
 * whoever typed it can see what went wrong, and the message is sent back
 * with the error and written to the server's log. A value can be as long as
 * the request that carried it, so a message repeats its first
 * MAX_REFUSED_VALUE_LENGTH characters and then "…": enough to recognise it,
 * never the whole of a value of any length. A shorter value is repeated as
 * it always was.
 */

// As much of a refused value as its message repeats (as the ID filters do).
export const MAX_REFUSED_VALUE_LENGTH: number = 80;

// What a cut value ends with.
export const REFUSED_VALUE_CUT_MARK: string = "…";

type IsSurrogatePairAtFunction = (text: string, index: number) => boolean;

// Whether the characters at index and index + 1 are one astral character.
const isSurrogatePairAt: IsSurrogatePairAtFunction = (
  text: string,
  index: number,
): boolean => {
  const high: number = text.charCodeAt(index);
  const low: number = text.charCodeAt(index + 1);

  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
};

export type RefusedValueFunction = (value: unknown) => string;

export const refusedValue: RefusedValueFunction = (value: unknown): string => {
  let text: string;

  try {
    text = String(value);
  } catch {
    return "";
  }

  if (text.length <= MAX_REFUSED_VALUE_LENGTH) {
    return text;
  }

  // Never half of an astral character.
  const end: number = isSurrogatePairAt(text, MAX_REFUSED_VALUE_LENGTH - 1)
    ? MAX_REFUSED_VALUE_LENGTH - 1
    : MAX_REFUSED_VALUE_LENGTH;

  return text.slice(0, end) + REFUSED_VALUE_CUT_MARK;
};
