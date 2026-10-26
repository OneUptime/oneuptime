/*
 * WHICH WAY A LANGUAGE IS READ.
 *
 * Persian - the one such language OneUptime is translated into today - is
 * written from right to left, like Arabic, Hebrew and Urdu; every other
 * language of the product from left to right. A page says which on <html
 * dir> (Common/UI/Utils/PageLanguage), and its layout follows: rows and
 * grids run from the right, and Tailwind's left and right utilities mean
 * the start and the end of the line (Common/UI/Styles/
 * TailwindReadingDirection.js).
 *
 * Read from the language tag alone, so a server, a test and every frontend
 * agree without Intl: the script when the tag names one ("az-Arab",
 * "ku-Latn"), the language otherwise.
 */

export type ReadingDirection = "ltr" | "rtl";

export const LEFT_TO_RIGHT: ReadingDirection = "ltr";

export const RIGHT_TO_LEFT: ReadingDirection = "rtl";

// Languages written from right to left, by their primary subtag.
export const RIGHT_TO_LEFT_LANGUAGES: ReadonlyArray<string> = [
  "ar", // Arabic
  "arc", // Aramaic
  "azb", // South Azerbaijani
  "ckb", // Central Kurdish (Sorani)
  "dv", // Dhivehi
  "fa", // Persian
  "glk", // Gilaki
  "he", // Hebrew
  "iw", // Hebrew, the old code
  "ks", // Kashmiri
  "lrc", // Northern Luri
  "mzn", // Mazanderani
  "nqo", // N'Ko
  "prs", // Dari
  "ps", // Pashto
  "sd", // Sindhi
  "syr", // Syriac
  "ug", // Uyghur
  "ur", // Urdu
  "yi", // Yiddish
];

// Scripts written from right to left, by their ISO 15924 code.
export const RIGHT_TO_LEFT_SCRIPTS: ReadonlyArray<string> = [
  "adlm", // Adlam
  "arab", // Arabic
  "hebr", // Hebrew
  "mand", // Mandaic
  "nkoo", // N'Ko
  "rohg", // Hanifi Rohingya
  "samr", // Samaritan
  "syrc", // Syriac
  "thaa", // Thaana
];

const SUBTAG_SEPARATOR_REGEX: RegExp = /[-_]/;

// A script subtag is four letters ("Arab", "Latn").
const SCRIPT_SUBTAG_REGEX: RegExp = /^[a-z]{4}$/;

// "fa", "fa-IR", "fa_IR", "az-Arab-IR": a language's subtags, lowercased.
const getSubtags: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  return language
    .trim()
    .toLowerCase()
    .split(SUBTAG_SEPARATOR_REGEX)
    .filter((subtag: string): boolean => {
      return subtag.length > 0;
    });
};

// Which way `language` is read: left to right unless it is written from the right.
export const getReadingDirection: (
  language: string | null | undefined,
) => ReadingDirection = (
  language: string | null | undefined,
): ReadingDirection => {
  if (!language) {
    return LEFT_TO_RIGHT;
  }

  const subtags: Array<string> = getSubtags(language);
  const primary: string | undefined = subtags[0];

  if (!primary) {
    return LEFT_TO_RIGHT;
  }

  // A script subtag, right after the language, decides.
  const script: string | undefined = subtags[1];

  if (script && SCRIPT_SUBTAG_REGEX.test(script)) {
    return RIGHT_TO_LEFT_SCRIPTS.includes(script)
      ? RIGHT_TO_LEFT
      : LEFT_TO_RIGHT;
  }

  return RIGHT_TO_LEFT_LANGUAGES.includes(primary)
    ? RIGHT_TO_LEFT
    : LEFT_TO_RIGHT;
};

export const isRightToLeftLanguage: (
  language: string | null | undefined,
) => boolean = (language: string | null | undefined): boolean => {
  return getReadingDirection(language) === RIGHT_TO_LEFT;
};

/*
 * WHICH WAY A TEXT SOMEONE WROTE IS READ.
 *
 * A team's note, a description or an answer from OneUptime AI is written
 * in whatever language its author wrote it in - an English note on a
 * Persian page, a Persian one on an English page. While it is being typed
 * it reads the way its first letter does, as a browser decides
 * dir="auto": a letter of a right-to-left script makes it right to left,
 * any other letter left to right, and the line does not turn round as the
 * words come. Digits, punctuation and Markdown's own marks ("## ", "- ",
 * "**") decide nothing. Null when there is no letter to go by, so the text
 * follows the page.
 *
 * Only the start of the text is read (TEXT_DIRECTION_SCAN_LENGTH): a log
 * of megabytes is decided by its first letter, not scanned to its end.
 */
export const TEXT_DIRECTION_SCAN_LENGTH: number = 4096;

const FIRST_LETTER_REGEX: RegExp = /\p{L}/u;

const RIGHT_TO_LEFT_LETTER_REGEX: RegExp =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Mandaic}\p{Script=Samaritan}]/u;

// One letter, of any script.
const LETTER_REGEX: RegExp = /^\p{L}$/u;

/*
 * WHICH WAY A TEXT SHOWN ON A PAGE IS READ: the way most of its letters
 * read. A name, a description or a paragraph of a note is shown, not typed,
 * so it can be read as a whole: "`kubectl` را اجرا کنید" and "API پرداخت از
 * کار افتاده" are Persian sentences that start with an English word, and
 * laid out from that first letter their Persian words came out in the
 * wrong order. "Checkout API (EU)" and "Rolled back v2.4.1." read left to
 * right, their full stop at their end. A tie goes to the first letter.
 * Null when there is no letter, so the text follows the page; only the
 * first TEXT_DIRECTION_SCAN_LENGTH characters are read.
 */
export const getTextReadingDirectionByMostLetters: (
  text: string | null | undefined,
) => ReadingDirection | null = (
  text: string | null | undefined,
): ReadingDirection | null => {
  if (!text) {
    return null;
  }

  let rightToLeftLetters: number = 0;
  let leftToRightLetters: number = 0;
  let firstLetterDirection: ReadingDirection | null = null;

  // By code point, so a letter outside the Basic Multilingual Plane counts once.
  for (const character of text.slice(0, TEXT_DIRECTION_SCAN_LENGTH)) {
    if (!LETTER_REGEX.test(character)) {
      continue;
    }

    const direction: ReadingDirection = RIGHT_TO_LEFT_LETTER_REGEX.test(
      character,
    )
      ? RIGHT_TO_LEFT
      : LEFT_TO_RIGHT;

    if (direction === RIGHT_TO_LEFT) {
      rightToLeftLetters++;
    } else {
      leftToRightLetters++;
    }

    firstLetterDirection = firstLetterDirection || direction;
  }

  if (rightToLeftLetters === leftToRightLetters) {
    return firstLetterDirection;
  }

  return rightToLeftLetters > leftToRightLetters
    ? RIGHT_TO_LEFT
    : LEFT_TO_RIGHT;
};

export const getTextReadingDirection: (
  text: string | null | undefined,
) => ReadingDirection | null = (
  text: string | null | undefined,
): ReadingDirection | null => {
  if (!text) {
    return null;
  }

  const start: string = text.slice(0, TEXT_DIRECTION_SCAN_LENGTH);
  const letter: RegExpExecArray | null = FIRST_LETTER_REGEX.exec(start);

  if (!letter) {
    return null;
  }

  return RIGHT_TO_LEFT_LETTER_REGEX.test(letter[0])
    ? RIGHT_TO_LEFT
    : LEFT_TO_RIGHT;
};
