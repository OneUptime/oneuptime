import { escapeRegExp } from "../Utils/RegExpEscape";

/*
 * WHERE A LINE MAY NOT BREAK.
 *
 * A browser may break a line at any plain space. Two kinds of space in
 * OneUptime's words read wrong when it does:
 *
 * - French sets its punctuation apart: it writes a space before » ? ! : and
 *   ; and after «. Every French text OneUptime writes puts a plain space
 *   there (as DashboardFrenchPunctuation holds it to), so a narrow line
 *   could start with the mark: the empty Archived Workflows page wrapped as
 *   "... dans la liste « Flux de travail" over "» et choisissez « Archiver
 *   »" (#8032). French typography writes a no-break space there: the narrow
 *   one (U+202F) before ; ! and ?, the full one (U+00A0) before : and »
 *   and after «.
 * - A number and its unit are one quantity. English writes "Uptime (24h)",
 *   German "Verfügbarkeit (24 Std.)", and on a phone the German tile's title
 *   broke inside its brackets: "Verfügbarkeit (24" over "Std.)" (#8043).
 *   Where the English text writes a number beside its unit - "{{hours}}h",
 *   "{{minutes}} min", "{{percent}}%", "24h", "10 MB" - the space a
 *   translation writes after that number is a no-break space (U+00A0),
 *   and so is the space English itself writes there: "Every 5 min" broke
 *   as "Every 5" over "min" on a narrow pill (#8302). A unit a language
 *   writes in two words - Arabic's milliseconds, "ملي ث" - is held
 *   together too (#8304).
 *
 * The locale files keep their plain spaces, as translators type them and as
 * the checks that read the files expect them. The words are set with
 * no-break spaces where they are drawn: the Translator sets every wording
 * a locale gives it, and every English template it fills
 * (Types/Translator, so the server's messages too), each frontend sets its
 * locale as i18next loads it (withNoBreakSpacesInLocale), and the docs set
 * their French pages and labels. Only OneUptime's own words are set: a
 * value - a monitor's name, a number someone typed - goes into a sentence
 * as it is written, and so does a text no locale words (translateText of
 * an untranslated text), which may be a value too.
 *
 * Code in backticks and an HTML tag are left as they are written: a space
 * there is the code's.
 *
 * Pure: no Node or browser APIs. Linear in the text's length.
 */

// A space no line breaks at.
export const NO_BREAK_SPACE: string = "\u00A0";

// A narrow space no line breaks at: French's before ; ! and ?.
export const NARROW_NO_BREAK_SPACE: string = "\u202F";

/*
 * A run of the spaces a line may break at: the space and the fixed-width
 * spaces, but not the figure space (U+2007), which already holds.
 */
const BREAKING_SPACES: string =
  "[\\u0020\\u2000-\\u2006\\u2008-\\u200A\\u205F]+";

const HAS_A_BREAKING_SPACE: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]/;

/*
 * What a text holds as it is written: code in backticks and an HTML tag.
 * A space inside one is left alone.
 */
const AS_WRITTEN_IN_TEXT: RegExp = /`[^`]*`|<\/?[A-Za-z][^<>]*>/g;

/*
 * What a page's HTML holds as it is written: its code, its preformatted
 * text, its scripts and styles, and every tag.
 */
const AS_WRITTEN_IN_HTML: RegExp =
  /<(pre|code|kbd|samp|script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/gi;

// The base of a language tag: "fr" for "fr-CA".
const getBaseLanguage: (language: string | null | undefined) => string = (
  language: string | null | undefined,
): string => {
  return (language || "").split(/[-_]/)[0]?.toLowerCase() || "";
};

/*
 * Whether `language` sets its punctuation apart with a space: French, in
 * every region it is written in.
 */
export const setsPunctuationApart: (
  language: string | null | undefined,
) => boolean = (language: string | null | undefined): boolean => {
  return getBaseLanguage(language) === "fr";
};

// The ranges of `text` that `asWritten` matches: [start, end) pairs, in order.
const findRanges: (
  text: string,
  asWritten: RegExp,
) => Array<[number, number]> = (
  text: string,
  asWritten: RegExp,
): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];

  for (const match of text.matchAll(asWritten)) {
    const start: number = match.index ?? 0;

    ranges.push([start, start + match[0].length]);
  }

  return ranges;
};

// Whether `at` falls inside one of `ranges`, which are in order and apart.
const isInside: (ranges: Array<[number, number]>, at: number) => boolean = (
  ranges: Array<[number, number]>,
  at: number,
): boolean => {
  let low: number = 0;
  let high: number = ranges.length - 1;

  while (low <= high) {
    const middle: number = (low + high) >> 1;
    const [start, end] = ranges[middle] as [number, number];

    if (at < start) {
      high = middle - 1;
    } else if (at >= end) {
      low = middle + 1;
    } else {
      return true;
    }
  }

  return false;
};

/*
 * `text` with each run of spaces `pattern` finds - its last group, which
 * ends its match - put in place by `replace` (null leaves it), unless it
 * is held as written (`asWritten`).
 */
const replaceSpaces: (
  text: string,
  pattern: RegExp,
  asWritten: RegExp,
  replace: (match: RegExpMatchArray) => string | null,
) => string = (
  text: string,
  pattern: RegExp,
  asWritten: RegExp,
  replace: (match: RegExpMatchArray) => string | null,
): string => {
  let ranges: Array<[number, number]> | null = null;
  let result: string = "";
  let at: number = 0;

  for (const match of text.matchAll(pattern)) {
    const spaces: string = match[match.length - 1] || "";
    const spacesStart: number =
      (match.index ?? 0) + match[0].length - spaces.length;

    ranges = ranges || findRanges(text, asWritten);

    if (isInside(ranges, spacesStart)) {
      continue;
    }

    const replacement: string | null = replace(match);

    if (replacement === null) {
      continue;
    }

    result += text.slice(at, spacesStart) + replacement;
    at = spacesStart + spaces.length;
  }

  return at === 0 ? text : result + text.slice(at);
};

// What a no-break space puts in place of every run of spaces it is handed.
const always: (space: string) => () => string = (
  space: string,
): (() => string) => {
  return (): string => {
    return space;
  };
};

/*
 * FRENCH'S MARKS.
 *
 * A question mark, an exclamation mark, a colon and a semicolon end the
 * word before them: a letter, a digit, a closing quote or bracket, a
 * placeholder's braces, Markdown's emphasis, code, an HTML tag or an
 * entity ("&quot;"). After the mark comes a space, the end, a closing mark
 * or more punctuation. Anything else is no French punctuation and keeps
 * its space: "MR !{{number}}" (a merge request), "à :{{minute}}" (a minute
 * past the hour), "Essayez !, @, # ou $" (what a password may hold),
 * "texte, ? un caractère" (a wildcard).
 */
const BEFORE_A_MARK: string =
  "(?<=[\\p{L}\\p{M}\\p{N}»›”’\"')\\]}*_`%….>]|&#?\\w+;)";

const AFTER_A_MARK: string = "(?:$|\\s|[»›”’\"')\\]*_<.…?!`])";

// The spaces before a question mark, an exclamation mark or a semicolon.
const SPACES_BEFORE_A_NARROW_MARK: RegExp = new RegExp(
  `${BEFORE_A_MARK}(${BREAKING_SPACES})(?=[?!;]${AFTER_A_MARK})`,
  "gu",
);

// The spaces before a colon.
const SPACES_BEFORE_A_COLON: RegExp = new RegExp(
  `${BEFORE_A_MARK}(${BREAKING_SPACES})(?=:${AFTER_A_MARK})`,
  "gu",
);

// The spaces before a closing guillemet, after the words it closes.
const SPACES_BEFORE_A_CLOSING_GUILLEMET: RegExp = new RegExp(
  `(?<=\\S)(${BREAKING_SPACES})(?=[»›])`,
  "gu",
);

// The spaces after an opening guillemet, before the words it opens.
const SPACES_AFTER_AN_OPENING_GUILLEMET: RegExp = new RegExp(
  `(?<=[«‹])(${BREAKING_SPACES})(?=\\S)`,
  "gu",
);

// Whether a text has a space French may set with a no-break one.
const HAS_A_FRENCH_SPACE: RegExp = new RegExp(
  `${BREAKING_SPACES}[»›?!:;]|[«‹]${BREAKING_SPACES}`,
  "u",
);

// `text` with French's no-break spaces, leaving what `asWritten` matches.
const setFrenchSpacing: (text: string, asWritten: RegExp) => string = (
  text: string,
  asWritten: RegExp,
): string => {
  if (!text || !HAS_A_FRENCH_SPACE.test(text)) {
    return text;
  }

  let result: string = replaceSpaces(
    text,
    SPACES_BEFORE_A_NARROW_MARK,
    asWritten,
    always(NARROW_NO_BREAK_SPACE),
  );

  result = replaceSpaces(
    result,
    SPACES_BEFORE_A_COLON,
    asWritten,
    always(NO_BREAK_SPACE),
  );

  result = replaceSpaces(
    result,
    SPACES_BEFORE_A_CLOSING_GUILLEMET,
    asWritten,
    always(NO_BREAK_SPACE),
  );

  return replaceSpaces(
    result,
    SPACES_AFTER_AN_OPENING_GUILLEMET,
    asWritten,
    always(NO_BREAK_SPACE),
  );
};

/*
 * `words` - French - with a no-break space where French sets a mark apart:
 * a narrow one before ; ! and ?, a full one before : and » and after «.
 * A run of spaces there is one no-break space. Code in backticks and HTML
 * tags are left as written.
 */
export const withFrenchSpacing: (words: string) => string = (
  words: string,
): string => {
  return setFrenchSpacing(words, AS_WRITTEN_IN_TEXT);
};

/*
 * A French page's HTML with French's no-break spaces in its text: never in
 * a tag, its code, its preformatted text, a script or a style.
 */
export const withFrenchSpacingInHtml: (html: string) => string = (
  html: string,
): string => {
  return setFrenchSpacing(html, AS_WRITTEN_IN_HTML);
};

/*
 * NUMBERS AND THEIR UNITS.
 *
 * The units English writes beside a number, as their symbols: a share, a
 * time, a size, a rate, a signal, a temperature. A duration's word ("5
 * minutes", "3 days") is held to its number too, after its one space
 * (ENGLISH_DURATION_WORDS, #8770): "Alle 5 Minuten" broke as "Alle 5" over
 * "Minuten". Any other word ("5 hosts") is no unit: a line may break before
 * it as before any word.
 */
const ENGLISH_UNITS: ReadonlyArray<string> = [
  "%",
  "‰",
  "°C",
  "°F",
  "ns",
  "µs",
  "μs",
  "ms",
  "s",
  "sec",
  "secs",
  "m",
  "min",
  "mins",
  "h",
  "hr",
  "hrs",
  "d",
  "w",
  "wk",
  "wks",
  "mo",
  "y",
  "yr",
  "yrs",
  "B",
  "kB",
  "KB",
  "MB",
  "GB",
  "TB",
  "PB",
  "KiB",
  "MiB",
  "GiB",
  "TiB",
  "PiB",
  "bps",
  "Kbps",
  "Mbps",
  "Gbps",
  "dB",
  "dBm",
  "Hz",
  "kHz",
  "MHz",
  "GHz",
  "ppm",
  "rpm",
];

const UNIT_PATTERN: string = [...ENGLISH_UNITS]
  .sort((a: string, b: string): number => {
    return b.length - a.length;
  })
  .map((unit: string): string => {
    return escapeRegExp(unit);
  })
  .join("|");

/*
 * A DURATION'S UNIT IN A WORD.
 *
 * English names a duration's unit in a word: moment's "5 hours ago", a
 * friendly duration's "1 min 47 secs", a table's "10 days, 23 hours", a
 * sentence's "Every {{count}} minutes". A line could end with "5" and start
 * the next with "hours ago" (#8669), or with "Alle 5" over "Minuten"
 * (#8770), as one could in what Intl writes before #8456. Each number
 * written right before a duration's word is held to it with a no-break
 * space: in English OneUptime writes itself (withDurationWordsHeld), and in
 * every wording of a sentence whose English writes one, whatever word the
 * language names the unit with (withNumbersKeptWithUnits). A number before
 * any other word ("5 hosts", "3 errors") is not, nor a duration's word with
 * no number before it ("a few seconds ago", "an hour ago").
 */
export const ENGLISH_DURATION_WORDS: ReadonlyArray<string> = [
  "second",
  "seconds",
  "sec",
  "secs",
  "minute",
  "minutes",
  "min",
  "mins",
  "hour",
  "hours",
  "hr",
  "hrs",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
];

// The duration's words, the longest first: "minutes" before "minute".
const DURATION_WORD_PATTERN: string = [...ENGLISH_DURATION_WORDS]
  .sort((a: string, b: string): number => {
    return b.length - a.length;
  })
  .join("|");

// A {{placeholder}}, or written digits that are no part of a longer name.
const ENGLISH_NUMBER: string =
  "(?:\\{\\{\\s*([\\w.]+)\\s*\\}\\}|(?<![\\p{L}\\p{N}_.,])(\\p{Nd}+(?:[.,]\\p{Nd}+)*))";

/*
 * A number beside a unit in an English text: a {{placeholder}} or written
 * digits, then a unit's symbol, joined or after one space, and not the
 * start of a longer word ("{{count}} more", "{{count}} days").
 */
const ENGLISH_NUMBER_WITH_UNIT: RegExp = new RegExp(
  `${ENGLISH_NUMBER}[ ]?(?:${UNIT_PATTERN})(?![\\p{L}\\p{N}_])`,
  "gu",
);

/*
 * The same, or a duration's word after one space ("{{count}} minutes",
 * "15 days"), and not the start of a longer word ("{{count}} dashboards",
 * "{{count}} daily").
 */
const ENGLISH_NUMBER_WITH_UNIT_OR_DURATION: RegExp = new RegExp(
  `${ENGLISH_NUMBER}(?:[ ]?(?:${UNIT_PATTERN})|[ ](?:${DURATION_WORD_PATTERN}))(?![\\p{L}\\p{N}_])`,
  "gu",
);

/*
 * How a text is set: a wording a page draws holds a duration's figure to
 * its word too (#8770); a text that may become a value - English OneUptime
 * writes into a record, a root cause, a status message it reads back by its
 * English - holds a unit's symbol only, as it did before.
 */
export interface NumbersKeptOptions {
  durationWords?: boolean | undefined;
}

// A placeholder, then the spaces after it, before more words.
const PLACEHOLDER_BEFORE_SPACES: RegExp = new RegExp(
  `\\{\\{\\s*([\\w.]+)\\s*\\}\\}(${BREAKING_SPACES})(?=\\S)`,
  "gu",
);

/*
 * Written digits, then the spaces after them, before more words. Not the
 * end of a name in Latin, Cyrillic or Greek letters ("p95", "v2"); a word
 * of another script may run into its number, as Arabic's "and" does
 * ("و10") and Chinese writes "超过5".
 */
const DIGITS_BEFORE_SPACES: RegExp = new RegExp(
  `(?<![\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{N}_.,\\u066B])(\\p{Nd}+(?:[.,\\u066B]\\p{Nd}+)*)(${BREAKING_SPACES})(?=\\S)`,
  "gu",
);

/*
 * The units a language writes in two words after a number: Arabic's
 * milliseconds, as Intl writes them short ("ملي ث", the Dashboard's
 * "{{value}} ms") and long ("ملي ثانية"), and as its sentences spell them
 * ("مللي ثانية", "ميلي ثانية"); its nanoseconds, long ("نانو ثانية").
 * Holding the number to the unit's first word left the unit itself to
 * break: "411 ملي" over "ث" (#8304). A unit a language joins with a
 * zero-width non-joiner (Persian's "میلی‌ثانیه") is one word already.
 */
const UNITS_OF_TWO_WORDS: ReadonlyArray<[string, string]> = [
  ["ملي", "ث"],
  ["ملي", "ثانية"],
  ["مللي", "ثانية"],
  ["ميلي", "ثانية"],
  ["نانو", "ثانية"],
];

/*
 * The spaces between a unit's two words, right after a number held to it:
 * a {{placeholder}} or written digits, then a no-break space. The unit
 * ends where its second word does, not inside a longer word.
 */
const SPACES_INSIDE_A_UNIT_PATTERN: string = UNITS_OF_TWO_WORDS.map(
  ([first, second]: [string, string]): string => {
    return `(?<=(?:\\}\\}|\\p{Nd})\\u00A0${escapeRegExp(first)})${BREAKING_SPACES}(?=${escapeRegExp(second)}(?![\\p{L}\\p{M}\\p{N}]))`;
  },
).join("|");

const SPACES_INSIDE_A_HELD_UNIT: RegExp = new RegExp(
  `(${SPACES_INSIDE_A_UNIT_PATTERN})`,
  "gu",
);

// The first words of the units of two words, each once.
const FIRST_WORD_PATTERN: string = Array.from(
  new Set(
    UNITS_OF_TWO_WORDS.map(([first]: [string, string]): string => {
      return escapeRegExp(first);
    }),
  ),
).join("|");

// Whether a text may hold a unit of two words after a held number.
const HAS_A_UNIT_OF_TWO_WORDS: RegExp = new RegExp(
  `\\u00A0(?:${FIRST_WORD_PATTERN})${BREAKING_SPACES}`,
  "u",
);

// The zero of each run of digits a locale writes numbers in.
const DIGIT_ZEROS: ReadonlyArray<number> = [
  0x30, // 0
  0x660, // Arabic-Indic ٠
  0x6f0, // Persian ۰
  0x966, // Devanagari ०
  0x9e6, // Bengali ০
  0xff10, // Full-width ０
];

/*
 * A number as its digits alone, in Latin digits: "99,9", "99.9" and "۹۹٫۹"
 * are all "999", so a translation's number is found whichever digits and
 * decimal sign its language writes.
 */
const toDigits: (number: string) => string = (number: string): string => {
  let digits: string = "";

  for (const character of number) {
    const code: number = character.codePointAt(0) as number;
    const zero: number | undefined = DIGIT_ZEROS.find(
      (start: number): boolean => {
        return code >= start && code <= start + 9;
      },
    );

    if (zero !== undefined) {
      digits += String(code - zero);
    }
  }

  return digits;
};

interface NumbersWithUnits {
  placeholders: Set<string>;
  digits: Set<string>;
}

// The numbers an English text writes beside a unit, remembered per text and way.
const MOST_REMEMBERED_TEXTS: number = 5000;

const numbersWithUnitsOf: Map<string, NumbersWithUnits | null> = new Map<
  string,
  NumbersWithUnits | null
>();

const HAS_A_NUMBER: RegExp = /\}\}|\p{Nd}/u;

/*
 * The numbers `english` writes beside a unit: the placeholders by name,
 * written numbers by their digits. Null when it writes none.
 */
const findNumbersWithUnits: (
  english: string,
  durationWords: boolean,
) => NumbersWithUnits | null = (
  english: string,
  durationWords: boolean,
): NumbersWithUnits | null => {
  if (!english || !HAS_A_NUMBER.test(english)) {
    return null;
  }

  const cacheKey: string = `${durationWords ? "d" : "u"}|${english}`;
  const remembered: NumbersWithUnits | null | undefined =
    numbersWithUnitsOf.get(cacheKey);

  if (remembered !== undefined) {
    return remembered;
  }

  const placeholders: Set<string> = new Set<string>();
  const digits: Set<string> = new Set<string>();

  for (const match of english.matchAll(
    durationWords
      ? ENGLISH_NUMBER_WITH_UNIT_OR_DURATION
      : ENGLISH_NUMBER_WITH_UNIT,
  )) {
    if (match[1]) {
      placeholders.add(match[1]);
    } else if (match[2]) {
      digits.add(toDigits(match[2]));
    }
  }

  const found: NumbersWithUnits | null =
    placeholders.size > 0 || digits.size > 0 ? { placeholders, digits } : null;

  if (numbersWithUnitsOf.size >= MOST_REMEMBERED_TEXTS) {
    numbersWithUnitsOf.clear();
  }

  numbersWithUnitsOf.set(cacheKey, found);

  return found;
};

/*
 * `words` - the wording of `english` in any language, or `english` itself
 * - with a no-break space after each number `english` writes beside its
 * unit: "Verfügbarkeit ({{hours}} Std.)" for "Uptime ({{hours}}h)",
 * "Letzte 24 Std." for "Last 24h". A number is found by its placeholder,
 * or by its digits in whichever digits the language writes. Code in
 * backticks and HTML tags are left as written. With durationWords, a
 * number before a duration's word too: "Alle {{count}} Minuten" for "Every
 * {{count}} minutes" (#8770).
 */
export const withNumbersKeptWithUnits: (
  words: string,
  english: string,
  options?: NumbersKeptOptions,
) => string = (
  words: string,
  english: string,
  options?: NumbersKeptOptions,
): string => {
  if (!words || !HAS_A_BREAKING_SPACE.test(words)) {
    return words;
  }

  const numbers: NumbersWithUnits | null = findNumbersWithUnits(
    english,
    Boolean(options?.durationWords),
  );

  if (!numbers) {
    return words;
  }

  let result: string = words;

  if (numbers.placeholders.size > 0) {
    result = replaceSpaces(
      result,
      PLACEHOLDER_BEFORE_SPACES,
      AS_WRITTEN_IN_TEXT,
      (match: RegExpMatchArray): string | null => {
        return numbers.placeholders.has(match[1] || "") ? NO_BREAK_SPACE : null;
      },
    );
  }

  if (numbers.digits.size > 0) {
    result = replaceSpaces(
      result,
      DIGITS_BEFORE_SPACES,
      AS_WRITTEN_IN_TEXT,
      (match: RegExpMatchArray): string | null => {
        return numbers.digits.has(toDigits(match[1] || ""))
          ? NO_BREAK_SPACE
          : null;
      },
    );
  }

  return withUnitsOfTwoWordsHeld(result);
};

/*
 * `words` with each unit of two words that follows a number held to it
 * held together too: "411\u00A0ملي\u00A0ث". A unit only, and only after a
 * number: elsewhere its words are words a line may break between.
 */
const withUnitsOfTwoWordsHeld: (words: string) => string = (
  words: string,
): string => {
  if (!HAS_A_UNIT_OF_TWO_WORDS.test(words)) {
    return words;
  }

  return replaceSpaces(
    words,
    SPACES_INSIDE_A_HELD_UNIT,
    AS_WRITTEN_IN_TEXT,
    always(NO_BREAK_SPACE),
  );
};

// English OneUptime writes itself: the space after a number, before a duration's word.
const SPACES_BEFORE_A_DURATION_WORD: RegExp = new RegExp(
  `(?<=\\p{Nd})${BREAKING_SPACES}(?=(?:${ENGLISH_DURATION_WORDS.join("|")})(?![\\p{L}\\p{M}\\p{N}_]))`,
  "gu",
);

// `text` with each number held to the duration's word right after it.
export const withDurationWordsHeld: (text: string) => string = (
  text: string,
): string => {
  if (!text || !HAS_A_BREAKING_SPACE.test(text)) {
    return text;
  }

  return text.replace(SPACES_BEFORE_A_DURATION_WORD, NO_BREAK_SPACE);
};

/*
 * `text` with the spaces this module holds a line with - the no-break
 * space and French's narrow one - written as plain spaces: for a sentence
 * that becomes a value, not a line a page draws (#8770). A rule's name the
 * form fills in ("Remind every 15 minutes until resolved") is stored and
 * searched; held, it would be another name than the one somebody typed or
 * saved before, and a search for "15 minutes" would not find it.
 */
const HELD_SPACES: RegExp = /[\u00A0\u202F]/g;

export const withPlainSpaces: (text: string) => string = (
  text: string,
): string => {
  return text ? text.replace(HELD_SPACES, " ") : text;
};

/*
 * `words`, a wording of `english` in `language`, as the language sets a
 * line: each number with its unit, a duration's word too (#8770), and
 * French's marks with the words before and after them. A wording is what a
 * page or a message draws in the reader's language; what OneUptime stores
 * and reads back is its English.
 */
export const withNoBreakSpaces: (
  words: string,
  english: string,
  language: string | null | undefined,
) => string = (
  words: string,
  english: string,
  language: string | null | undefined,
): string => {
  const kept: string = withNumbersKeptWithUnits(words, english, {
    durationWords: true,
  });

  return setsPunctuationApart(language) ? withFrenchSpacing(kept) : kept;
};

/*
 * DICTIONARIES.
 *
 * A locale file as i18next is handed it: an object of strings, some of
 * them nested ("navbar": { "items": ... }).
 */
export type NoBreakLocaleTree = { [key: string]: unknown };

// The suffixes a plural form's key carries: "_one", and a form's mark.
const PLURAL_SUFFIX: RegExp =
  /(?:_(?:zero|one|two|few|many|other))?(?:_sameAsEnglish)?$/;

const isLocaleTree: (node: unknown) => node is NoBreakLocaleTree = (
  node: unknown,
): node is NoBreakLocaleTree => {
  return typeof node === "object" && node !== null && !Array.isArray(node);
};

export interface NoBreakLocaleInput {
  // The locale's strings.
  locale: NoBreakLocaleTree;
  // The language they are written in.
  language: string;
  /*
   * The English locale, where it holds an entry's English text: a nested
   * entry's ("uptimeHistory.dayLabel"), whose key is no English. A flat
   * entry's key is its English text, plural suffix aside.
   */
  english?: NoBreakLocaleTree | undefined;
}

/*
 * A locale with each of its own wordings set as its language sets a line
 * (withNoBreakSpaces). An entry that is still the English - a placeholder
 * for a translation to come - is left as it is: the lookup reads it as no
 * translation at all, and so it stays. English itself, and a locale with
 * nothing to set, come back as they went in; any other comes back a new
 * object, the one handed in unchanged.
 */
export const withNoBreakSpacesInLocale: (
  input: NoBreakLocaleInput,
) => NoBreakLocaleTree = (input: NoBreakLocaleInput): NoBreakLocaleTree => {
  const language: string = input.language;

  if (getBaseLanguage(language) === "en" || !isLocaleTree(input.locale)) {
    return input.locale;
  }

  const setTree: (
    tree: NoBreakLocaleTree,
    english: NoBreakLocaleTree | undefined,
  ) => NoBreakLocaleTree = (
    tree: NoBreakLocaleTree,
    english: NoBreakLocaleTree | undefined,
  ): NoBreakLocaleTree => {
    let result: NoBreakLocaleTree | null = null;

    for (const key of Object.keys(tree)) {
      const value: unknown = tree[key];
      const englishValue: unknown =
        english && Object.prototype.hasOwnProperty.call(english, key)
          ? english[key]
          : undefined;
      let set: unknown = value;

      if (isLocaleTree(value)) {
        set = setTree(
          value,
          isLocaleTree(englishValue) ? englishValue : undefined,
        );
      } else if (typeof value === "string") {
        const englishText: string =
          typeof englishValue === "string"
            ? englishValue
            : key.replace(PLURAL_SUFFIX, "");

        set =
          value === englishText || value === key
            ? value
            : withNoBreakSpaces(value, englishText, language);
      }

      if (set !== value && !result) {
        result = { ...tree };
      }

      if (result) {
        result[key] = set;
      }
    }

    return result || tree;
  };

  return setTree(input.locale, input.english);
};
