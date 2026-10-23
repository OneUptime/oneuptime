import { transliterateToAscii } from "./KeyFromName";

/*
 * NATURAL ORDER: names in the order people read them in.
 *
 * "Labels are not displayed in a predictable alphanumeric order" (OneUptime
 * issue #5183): a customer numbers their labels - "1. Category",
 * "2. SubCategory", "3. Item", "4. Business System" - and a monitor's labels
 * came back in whatever order the database joined them, "4." before "3.".
 * Sorted as plain text, "10. Owner" would still come before "2. SubCategory".
 *
 * Natural order is the order a person expects:
 *
 *   - a name that starts with a number comes first, in the order of that
 *     number: "1. Category", "2. SubCategory", "10. Owner";
 *   - every other name after them, alphabetically: "Claude", "eu-west",
 *     "Production";
 *   - a number anywhere else in a name is read by its value too: "Tier 2"
 *     before "Tier 10", "v9" before "v10";
 *   - case and accents do not move a name: "Église" sits with the e's,
 *     "production" with "Production" (Utils/KeyFromName folds them, as it
 *     does for every key OneUptime makes from a name);
 *   - spaces are read as one, and the ends of a name are not read at all.
 *
 * Two names that read the same once folded ("Cafe" and "Café") keep one
 * order between them, the name as it is written deciding, so the order is
 * total and never changes from one read to the next.
 *
 * The order is a sort key (getNaturalSortKey) compared code point by code
 * point. The server stores the key of every label (Label.nameSortKey) and
 * the database orders by it under the "C" collation, which compares code
 * points too, so a list the server pages through - Project Settings >
 * Labels, a label picker's search, the Slack and Teams pickers - is in
 * exactly the order the browser sorts a record's labels in.
 *
 * Pure, with no database or React import: the browser and the server read
 * this one file.
 */

/*
 * The longest key: the width of the column the server keeps it in
 * (Label.nameSortKey, ColumnLength.LongText), counted in UTF-16 units, which
 * is never fewer than the characters Postgres counts. A key that would be
 * longer is cut, never failed: a name is at most 100 characters, and only
 * pathological ones (a few compatibility characters that unfold into a dozen
 * letters each) come near.
 */
export const NATURAL_SORT_KEY_MAX_LENGTH: number = 500;

/*
 * The first character of a key: "0" for a name that starts with a number,
 * "1" for every other one, so numbered names come first whatever the
 * character after them - "#infra" and "(legacy)" included, which would
 * otherwise sort before the digits.
 */
export const NATURAL_SORT_KEY_NUMBERED_TIER: string = "0";
export const NATURAL_SORT_KEY_UNNUMBERED_TIER: string = "1";

/*
 * Between the folded name and the name as written. Lower than any character
 * a folded name can hold (control characters are taken out of it, and
 * whitespace is a space), so "ab" sorts before "abc" and before "ab c", and
 * the written name only decides between names that fold to the same text.
 */
export const NATURAL_SORT_KEY_SEPARATOR: string = "\u0001";

/*
 * A number is written into the key as its digit count (two digits) and then
 * its digits without leading zeros: 2 -> "012", 10 -> "0210", 007 -> "017".
 * A longer number has more digits, so comparing the count first and then the
 * digits compares the numbers. Ninety-nine digits are read, which is more
 * than any name holds.
 */
const NUMBER_LENGTH_WIDTH: number = 2;
const MAX_NUMBER_DIGITS: number = 99;

const DIGIT_ZERO: number = 48;
const DIGIT_NINE: number = 57;

const WHITESPACE_RUN_PATTERN: RegExp = /\s+/gu;
const CONTROL_CHARACTER_PATTERN: RegExp = /\p{Cc}/gu;

const isAsciiDigit: (code: number) => boolean = (code: number): boolean => {
  return code >= DIGIT_ZERO && code <= DIGIT_NINE;
};

/*
 * Spaces read as one and the ends not read: what a name says, as a person
 * would write it again.
 */
export const getWrittenName: (text: string | null | undefined) => string = (
  text: string | null | undefined,
): string => {
  return (typeof text === "string" ? text : "")
    .replace(WHITESPACE_RUN_PATTERN, " ")
    .trim();
};

/*
 * The name with case, accents and compatibility forms folded away
 * ("Église" -> "eglise", full-width "１" -> "1"), spaces as one and no
 * control characters.
 */
const foldName: (writtenName: string) => string = (
  writtenName: string,
): string => {
  return transliterateToAscii(writtenName.toLowerCase())
    .toLowerCase()
    .replace(WHITESPACE_RUN_PATTERN, " ")
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .trim();
};

const encodeNumber: (digits: string) => string = (digits: string): string => {
  let start: number = 0;

  // "007" is 7; "000" is 0.
  while (start < digits.length - 1 && digits[start] === "0") {
    start++;
  }

  const significant: string = digits.slice(start, start + MAX_NUMBER_DIGITS);

  return `${String(significant.length).padStart(
    NUMBER_LENGTH_WIDTH,
    "0",
  )}${significant}`;
};

// Every run of digits written so that comparing text compares numbers.
const encodeNumbers: (folded: string) => string = (folded: string): string => {
  let encoded: string = "";
  let index: number = 0;

  while (index < folded.length) {
    if (!isAsciiDigit(folded.charCodeAt(index))) {
      encoded += folded[index];
      index++;
      continue;
    }

    let end: number = index;

    while (end < folded.length && isAsciiDigit(folded.charCodeAt(end))) {
      end++;
    }

    encoded += encodeNumber(folded.slice(index, end));
    index = end;
  }

  return encoded;
};

// The key cut to its column, never between the two halves of a character.
const capKeyLength: (key: string) => string = (key: string): string => {
  if (key.length <= NATURAL_SORT_KEY_MAX_LENGTH) {
    return key;
  }

  let capped: string = "";

  for (const character of key) {
    if (capped.length + character.length > NATURAL_SORT_KEY_MAX_LENGTH) {
      break;
    }

    capped += character;
  }

  return capped;
};

/**
 * The key a name sorts by in natural order: compare two keys with
 * compareCodePoints (or a database's "C" collation) and the names come out
 * in natural order.
 *
 *   "2. SubCategory" -> "0012. subcategory\u00012. SubCategory"
 *   "Production"     -> "1production\u0001Production"
 */
export const getNaturalSortKey: (text: string | null | undefined) => string = (
  text: string | null | undefined,
): string => {
  const writtenName: string = getWrittenName(text);
  const folded: string = encodeNumbers(foldName(writtenName));
  const tier: string = isAsciiDigit(folded.charCodeAt(0))
    ? NATURAL_SORT_KEY_NUMBERED_TIER
    : NATURAL_SORT_KEY_UNNUMBERED_TIER;

  return capKeyLength(
    `${tier}${folded}${NATURAL_SORT_KEY_SEPARATOR}${writtenName}`,
  );
};

/*
 * Two strings in the order of their code points, as Postgres compares text
 * under the "C" collation (UTF-8 bytes, which are in code point order).
 * JavaScript's own < compares UTF-16 units, which puts a character beyond
 * U+FFFF (an emoji, a rare CJK character: two units from 0xD800-0xDFFF)
 * before one from 0xE000-0xFFFF; moving the units of those two ranges past
 * each other at the first difference gives code point order back.
 */
const toCodePointOrder: (unit: number) => number = (unit: number): number => {
  if (unit >= 0xd800 && unit <= 0xdfff) {
    return unit + 0x2000;
  }

  if (unit >= 0xe000) {
    return unit - 0x800;
  }

  return unit;
};

export const compareCodePoints: (first: string, second: string) => number = (
  first: string,
  second: string,
): number => {
  const length: number = Math.min(first.length, second.length);

  for (let index: number = 0; index < length; index++) {
    const firstUnit: number = first.charCodeAt(index);
    const secondUnit: number = second.charCodeAt(index);

    if (firstUnit !== secondUnit) {
      return toCodePointOrder(firstUnit) < toCodePointOrder(secondUnit)
        ? -1
        : 1;
    }
  }

  if (first.length === second.length) {
    return 0;
  }

  return first.length < second.length ? -1 : 1;
};

/**
 * Two names in natural order: negative when the first comes first, positive
 * when it comes after, 0 only for names that are written the same.
 */
export const compareNaturally: (
  first: string | null | undefined,
  second: string | null | undefined,
) => number = (
  first: string | null | undefined,
  second: string | null | undefined,
): number => {
  return compareCodePoints(getNaturalSortKey(first), getNaturalSortKey(second));
};

/**
 * Items in the natural order of a name each has, as a new array (the one
 * given is left as it is). Each name is read once, however long the list.
 * Items whose names read the same keep the order they were given in.
 */
export const sortByNaturalName: <T>(
  items: ReadonlyArray<T>,
  getName: (item: T) => string | null | undefined,
) => Array<T> = <T>(
  items: ReadonlyArray<T>,
  getName: (item: T) => string | null | undefined,
): Array<T> => {
  return items
    .map((item: T, index: number): { item: T; key: string; index: number } => {
      return { item: item, key: getNaturalSortKey(getName(item)), index };
    })
    .sort(
      (
        first: { key: string; index: number },
        second: { key: string; index: number },
      ): number => {
        return (
          compareCodePoints(first.key, second.key) || first.index - second.index
        );
      },
    )
    .map((entry: { item: T }): T => {
      return entry.item;
    });
};

/**
 * Names in natural order, as a new array.
 */
export const sortNaturally: (names: ReadonlyArray<string>) => Array<string> = (
  names: ReadonlyArray<string>,
): Array<string> => {
  return sortByNaturalName<string>(names, (name: string): string => {
    return name;
  });
};
