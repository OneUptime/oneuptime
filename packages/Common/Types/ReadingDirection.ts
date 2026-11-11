/*
 * WHICH WAY A LANGUAGE IS READ.
 *
 * Persian and Arabic - the two such languages OneUptime is translated into
 * today - are written from right to left, like Hebrew and Urdu; every other
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
  /[\u{0640}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Mandaic}\p{Script=Samaritan}]/u;

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
 *
 * What reads as it is written in any language decides nothing about the
 * words round it: what a text sets apart in a Unicode isolate (LRI, RLI or
 * FSI ... PDI) - the Unicode bidi algorithm itself skips an isolate when it
 * looks for a paragraph's first letter - and a web address. An Arabic
 * sentence that names a path, set apart to read as written
 * (Types/CodeInSentence), and an address has more Latin letters than
 * Arabic ones: counted, they turned the whole sentence round, laid out
 * from the left with its words in the wrong order. A text that is nothing
 * but isolates and addresses is read by the letters in them.
 */
interface LetterCount {
  rightToLeft: number;
  leftToRight: number;
  first: ReadingDirection | null;
}

// Each isolate's opening mark: LRI, RLI, FSI.
const ISOLATE_INITIATOR_REGEX: RegExp = /^[\u{2066}-\u{2068}]$/u;

/*
 * A web address: a scheme from the start of a word ("https://",
 * "s3://"), up to the next space or isolate mark.
 */
const WEB_ADDRESS_REGEX: RegExp =
  /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s\u{2066}-\u{2069}]*/gu;

const getDirectionByCount: (count: LetterCount) => ReadingDirection | null = (
  count: LetterCount,
): ReadingDirection | null => {
  if (count.rightToLeft === count.leftToRight) {
    return count.first;
  }

  return count.rightToLeft > count.leftToRight ? RIGHT_TO_LEFT : LEFT_TO_RIGHT;
};

interface LetterCounts {
  // The text's own words: its letters outside isolates and addresses.
  outside: LetterCount;
  // The letters inside them.
  inside: LetterCount;
}

const countLetters: (text: string) => LetterCounts = (
  text: string,
): LetterCounts => {
  const outside: LetterCount = { rightToLeft: 0, leftToRight: 0, first: null };
  const inside: LetterCount = { rightToLeft: 0, leftToRight: 0, first: null };
  // How many isolates the scan is in.
  let depth: number = 0;
  // Each address counted as if it were set apart.
  const scanned: string = text
    .slice(0, TEXT_DIRECTION_SCAN_LENGTH)
    .replace(WEB_ADDRESS_REGEX, (address: string): string => {
      return `${FIRST_STRONG_ISOLATE}${address}${POP_DIRECTIONAL_ISOLATE}`;
    });

  // By code point, so a letter outside the Basic Multilingual Plane counts once.
  for (const character of scanned) {
    if (ISOLATE_INITIATOR_REGEX.test(character)) {
      depth++;
      continue;
    }

    // A PDI with no isolate open closes nothing.
    if (character === POP_DIRECTIONAL_ISOLATE) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (!LETTER_REGEX.test(character)) {
      continue;
    }

    const direction: ReadingDirection = RIGHT_TO_LEFT_LETTER_REGEX.test(
      character,
    )
      ? RIGHT_TO_LEFT
      : LEFT_TO_RIGHT;
    const count: LetterCount = depth > 0 ? inside : outside;

    if (direction === RIGHT_TO_LEFT) {
      count.rightToLeft++;
    } else {
      count.leftToRight++;
    }

    count.first = count.first || direction;
  }

  return { outside, inside };
};

export const getTextReadingDirectionByMostLetters: (
  text: string | null | undefined,
) => ReadingDirection | null = (
  text: string | null | undefined,
): ReadingDirection | null => {
  if (!text) {
    return null;
  }

  const counts: LetterCounts = countLetters(text);

  return (
    getDirectionByCount(counts.outside) || getDirectionByCount(counts.inside)
  );
};

/*
 * WHETHER A TEXT HAS WORDS OF A RIGHT-TO-LEFT SCRIPT OF ITS OWN: a letter
 * of one outside what it sets apart - an isolate, a web address - counted
 * as getTextReadingDirectionByMostLetters counts. An Arabic or Persian
 * sentence has, however many names, paths and commands it gives in Latin
 * letters ("Microsoft Teams غير متصل بعد!"); an English sentence has not,
 * nor one that sets a Persian name apart. Only the first
 * TEXT_DIRECTION_SCAN_LENGTH characters are read.
 */
export const hasRightToLeftWords: (
  text: string | null | undefined,
) => boolean = (text: string | null | undefined): boolean => {
  return Boolean(text) && countLetters(text as string).outside.rightToLeft > 0;
};

/*
 * WHETHER A TEXT HAS ENGLISH WORDS OF ITS OWN: whether it is an English
 * sentence, not a name or a label in Latin letters. An answer from the
 * server is English, and it may quote a name someone typed in Arabic or
 * Persian ("A custom channel named قناة الطوارئ already exists."), so it
 * has right-to-left letters of its own too (hasRightToLeftWords). What
 * tells it from an Arabic sentence that names products ("Microsoft Teams
 * غير متصل بعد!") are the small words an English sentence is made of: "is",
 * "the", "already", "not" (ENGLISH_SENTENCE_WORDS). One counts when it is
 * written in lower case outside what the text sets apart in an isolate,
 * quotes, marks as code or in bold, or leaves to a value ({{name}}), and
 * is not inside a name written in Title Case ("Red Hat OpenStack Services
 * on OpenShift", "Add an Integration"). Only the first
 * TEXT_DIRECTION_SCAN_LENGTH characters are read.
 */
const ENGLISH_SENTENCE_WORDS: ReadonlySet<string> = new Set<string>([
  "already",
  "also",
  "an",
  "and",
  "another",
  "any",
  "are",
  "aren't",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "can't",
  "cannot",
  "could",
  "couldn't",
  "did",
  "do",
  "does",
  "doesn't",
  "don't",
  "each",
  "every",
  "for",
  "from",
  "had",
  "has",
  "have",
  "here",
  "how",
  "if",
  "in",
  "into",
  "is",
  "isn't",
  "it",
  "it's",
  "its",
  "may",
  "must",
  "no",
  "not",
  "of",
  "on",
  "only",
  "or",
  "other",
  "our",
  "please",
  "should",
  "so",
  "some",
  "than",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "was",
  "wasn't",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "won't",
  "would",
  "yet",
  "you",
  "your",
]);

/*
 * What a text quotes, marks as code or in bold, or leaves to a value: not
 * its own words. Each kind opens with its own sign and is read no further
 * than 256 characters for its close.
 */
const QUOTED_OR_CODE_REGEX: RegExp =
  /\{\{[^{}]{0,256}\}\}|`[^`]{0,256}`|\*\*[^*]{0,256}\*\*|\u{00AB}[^\u{00AB}\u{00BB}]{0,256}\u{00BB}|\u{201C}[^\u{201C}\u{201D}]{0,256}\u{201D}|"[^"]{0,256}"/gu;

const SPACES_REGEX: RegExp = /\s+/u;

const CURLY_APOSTROPHE_REGEX: RegExp = /\u{2019}/gu;

// A Latin letter, or an apostrophe inside a word ("isn't", "it’s").
const isWordCharacter: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    character === "'" ||
    character === "\u{2019}"
  );
};

// A piece of text between spaces without the signs round it: "exists." is "exists".
const getWordOf: (piece: string) => string = (piece: string): string => {
  let start: number = 0;
  let end: number = piece.length;

  while (start < end && !isWordCharacter(piece.charAt(start))) {
    start++;
  }

  while (end > start && !isWordCharacter(piece.charAt(end - 1))) {
    end--;
  }

  return piece.slice(start, end).replace(CURLY_APOSTROPHE_REGEX, "'");
};

const isTitleCaseWord: (word: string | undefined) => boolean = (
  word: string | undefined,
): boolean => {
  const first: string = word ? word.charAt(0) : "";

  return first >= "A" && first <= "Z";
};

export const hasEnglishWords: (text: string | null | undefined) => boolean = (
  text: string | null | undefined,
): boolean => {
  if (!text) {
    return false;
  }

  /*
   * The text outside its isolates, with a space where each was. A web
   * address holds no word of its own: it runs to the next space.
   */
  let ownText: string = "";
  let depth: number = 0;

  for (const character of text.slice(0, TEXT_DIRECTION_SCAN_LENGTH)) {
    if (ISOLATE_INITIATOR_REGEX.test(character)) {
      ownText += depth === 0 ? " " : "";
      depth++;
      continue;
    }

    if (character === POP_DIRECTIONAL_ISOLATE) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      ownText += character;
    }
  }

  const words: Array<string> = ownText
    .replace(QUOTED_OR_CODE_REGEX, " ")
    .split(SPACES_REGEX)
    .map(getWordOf);

  return words.some((word: string, index: number): boolean => {
    return (
      ENGLISH_SENTENCE_WORDS.has(word) &&
      !(isTitleCaseWord(words[index - 1]) && isTitleCaseWord(words[index + 1]))
    );
  });
};

/*
 * A VALUE PUT INTO A SENTENCE, SET APART FROM IT.
 *
 * A sentence the product writes around a value - "Read from the Meraki
 * dashboard ({{name}}), {{time}}." - is laid out by the Unicode bidi
 * algorithm as one paragraph. In a Persian sentence a name in Latin letters
 * is a left-to-right run, and a number after it joins that run: the
 * digit and the comma of "... (Acme Retail)، ۴ دقیقه پیش." were drawn
 * beside the name, before the words they belong with. Set apart in a
 * Unicode isolate (FSI ... PDI) a value reads as one piece where the
 * sentence puts it, the way its own first letter reads, and nothing
 * around it moves.
 *
 * Only a value that could move its neighbours is set apart: in a sentence
 * read right to left, one with a letter of a left-to-right script or a
 * digit in it - a name, an address, a time, a count; in a sentence read
 * left to right, one with a letter of a right-to-left script - a Persian
 * name on an English page. A value of the sentence's own script (a Persian
 * word in a Persian sentence) is left as it is. Only the start of a value
 * is read (TEXT_DIRECTION_SCAN_LENGTH).
 */
export const FIRST_STRONG_ISOLATE: string = String.fromCharCode(0x2068);

export const POP_DIRECTIONAL_ISOLATE: string = String.fromCharCode(0x2069);

// One decimal digit, of any script: "4", "۴".
const DIGIT_REGEX: RegExp = /^\p{Nd}$/u;

export const isSetApartInSentence: (
  value: string,
  sentenceDirection: ReadingDirection,
) => boolean = (
  value: string,
  sentenceDirection: ReadingDirection,
): boolean => {
  if (!value) {
    return false;
  }

  for (const character of value.slice(0, TEXT_DIRECTION_SCAN_LENGTH)) {
    if (LETTER_REGEX.test(character)) {
      const isRightToLeftLetter: boolean =
        RIGHT_TO_LEFT_LETTER_REGEX.test(character);

      if (isRightToLeftLetter !== (sentenceDirection === RIGHT_TO_LEFT)) {
        return true;
      }

      continue;
    }

    if (sentenceDirection === RIGHT_TO_LEFT && DIGIT_REGEX.test(character)) {
      return true;
    }
  }

  return false;
};

// The value as a sentence read `sentenceDirection` holds it (isSetApartInSentence).
export const setApartInSentence: (
  value: string,
  sentenceDirection: ReadingDirection,
) => string = (value: string, sentenceDirection: ReadingDirection): string => {
  return isSetApartInSentence(value, sentenceDirection)
    ? `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`
    : value;
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
