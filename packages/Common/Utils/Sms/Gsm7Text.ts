import { getGsm7Length } from "./SmsSegments";

/*
 * TEXT WRITTEN IN THE CHARACTERS AN SMS CARRIES CHEAPLY.
 *
 * A single character outside the GSM 7-bit alphabet makes a whole SMS go
 * out in UCS-2, whose parts hold 70 characters instead of 160 - so one
 * curly quote in an incident's title makes a page cost two, three or four
 * times as much (SmsSegments). Most such characters have a plain look-alike
 * the reader takes for the same thing, and the text OneUptime writes in an
 * SMS to a team member uses it:
 *
 *   - quotes, apostrophes, dashes, bullets and spaces of every kind are
 *     written as ' " - and a space, … as ..., arrows and comparisons as
 *     -> <- >= <= !=, × ÷ ± as x / +/-, © ® ™ as (c) (R) TM, ¢ as c, ‰ as
 *     per mille, and the micro sign of 500µs (or a Greek mu used as one,
 *     after a number) as u;
 *   - a letter with an accent or a mark GSM-7 does not have loses the mark
 *     (á ç ł ő ș become a c l o s), while one it has stays (é è à ñ ü ø å
 *     ß...); ligatures, full-width letters and the other compatibility
 *     forms are written as the letters and digits they stand for (ﬁ Ａ ² ½
 *     become fi A 2 1/2, and ℃ the C of °C) - after a digit, a fraction
 *     and a power stay apart from it (1½ is 1 1/2 and 10² is 10^2, never
 *     the numbers 11/2 and 102);
 *   - emoji, invisible formatting characters, symbols with no look-alike
 *     (° and the like) and private-use characters (an icon font's glyphs,
 *     which a phone shows as a box) are left out: they say nothing the
 *     words do not.
 *
 * Letters of another script - Cyrillic, Greek, Arabic, Hebrew, Devanagari,
 * Chinese, Japanese, Korean and the rest - are kept exactly as written,
 * marks and all: in Latin letters a title would no longer say what it says
 * to the people it was written for. A text with them goes out in UCS-2,
 * and what fits it to an SMS (OnCallPageSms) counts it that way.
 *
 * Pure, with no Node or browser APIs. Linear in the text's length.
 */

const SPACE: string = " ";

/*
 * Characters with a plain look-alike that Unicode's compatibility
 * decomposition (NFKD) does not give, and what each is written as. Checked
 * before anything is left out, so a sign that is also an emoji (© ® ™ ‼ ↔)
 * keeps its look-alike.
 */
export const GSM_7_LOOK_ALIKES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  // A tab is a space: GSM-7 has none.
  ["\t", SPACE],
  // Apostrophes, single quotes, primes and accents typed as apostrophes.
  ["\u{2018}", "'"],
  ["\u{2019}", "'"],
  ["\u{201A}", "'"],
  ["\u{201B}", "'"],
  ["\u{2032}", "'"],
  ["\u{2035}", "'"],
  ["\u{02B9}", "'"],
  ["\u{02BB}", "'"],
  ["\u{02BC}", "'"],
  ["\u{02BD}", "'"],
  ["\u{0060}", "'"],
  ["\u{00B4}", "'"],
  ["\u{2039}", "'"],
  ["\u{203A}", "'"],
  // Double quotes, double primes and guillemets.
  ["\u{201C}", '"'],
  ["\u{201D}", '"'],
  ["\u{201E}", '"'],
  ["\u{201F}", '"'],
  ["\u{2033}", '"'],
  ["\u{2036}", '"'],
  ["\u{02BA}", '"'],
  ["\u{00AB}", '"'],
  ["\u{00BB}", '"'],
  ["\u{301D}", '"'],
  ["\u{301E}", '"'],
  // Hyphens, dashes and the minus sign.
  ["\u{2010}", "-"],
  ["\u{2011}", "-"],
  ["\u{2012}", "-"],
  ["\u{2013}", "-"],
  ["\u{2014}", "-"],
  ["\u{2015}", "-"],
  ["\u{2043}", "-"],
  ["\u{2212}", "-"],
  ["\u{2E3A}", "-"],
  ["\u{2E3B}", "-"],
  // Bullets and middle dots, which part words the way a dash does.
  ["\u{2022}", "-"],
  ["\u{2023}", "-"],
  ["\u{2027}", "-"],
  ["\u{00B7}", "-"],
  ["\u{2219}", "-"],
  ["\u{25E6}", "-"],
  // Slashes.
  ["\u{2044}", "/"],
  ["\u{2215}", "/"],
  // Arithmetic and comparisons.
  ["\u{00D7}", "x"],
  ["\u{00F7}", "/"],
  ["\u{00B1}", "+/-"],
  ["\u{2264}", "<="],
  ["\u{2265}", ">="],
  ["\u{2260}", "!="],
  ["\u{2248}", "~"],
  // Arrows.
  ["\u{2192}", "->"],
  ["\u{2190}", "<-"],
  ["\u{2194}", "<->"],
  ["\u{21D2}", "=>"],
  ["\u{21D0}", "<="],
  ["\u{21D4}", "<=>"],
  ["\u{27F6}", "->"],
  ["\u{27F5}", "<-"],
  ["\u{2794}", "->"],
  ["\u{279C}", "->"],
  ["\u{27A1}", "->"],
  ["\u{2B05}", "<-"],
  // Signs a word says as well.
  ["\u{00A9}", "(c)"],
  ["\u{00AE}", "(R)"],
  ["\u{2122}", "TM"],
  ["\u{203C}", "!!"],
  ["\u{2049}", "!?"],
  ["\u{00A2}", "c"],
  ["\u{2030}", " per mille"],
  // The micro sign of a unit: 500µs is 500 microseconds.
  ["\u{00B5}", "u"],
  // Letters Unicode does not decompose into a plain letter and a mark.
  ["\u{0131}", "i"],
  ["\u{0142}", "l"],
  ["\u{0141}", "L"],
  ["\u{0111}", "d"],
  ["\u{0110}", "D"],
  ["\u{0127}", "h"],
  ["\u{0126}", "H"],
  ["\u{0153}", "oe"],
  ["\u{0152}", "OE"],
  ["\u{014B}", "n"],
  ["\u{014A}", "N"],
  ["\u{0167}", "t"],
  ["\u{0166}", "T"],
  ["\u{00FE}", "th"],
  ["\u{00DE}", "Th"],
  ["\u{00F0}", "d"],
  ["\u{00D0}", "D"],
  ["\u{0138}", "k"],
  ["\u{0192}", "f"],
  ["\u{0180}", "b"],
  ["\u{0268}", "i"],
  ["\u{0289}", "u"],
  ["\u{1E9E}", "SS"],
]);

// Greek small mu, which people type for the micro sign: 500μs.
const GREEK_SMALL_MU: number = 0x03bc;

// What a vulgar fraction decomposes around: ½ is 1, this slash, and 2.
const FRACTION_SLASH: string = "\u{2044}";

// Superscript digits and signs: right after a digit, a power (10², 10⁻³).
const SUPERSCRIPTS: ReadonlySet<string> = new Set<string>([
  "\u{00B2}",
  "\u{00B3}",
  "\u{00B9}",
  "\u{2070}",
  "\u{2071}",
  "\u{2074}",
  "\u{2075}",
  "\u{2076}",
  "\u{2077}",
  "\u{2078}",
  "\u{2079}",
  "\u{207A}",
  "\u{207B}",
  "\u{207C}",
  "\u{207D}",
  "\u{207E}",
  "\u{207F}",
]);

const ASCII_LETTER: RegExp = /^[A-Za-z]$/;
const ASCII_DIGIT: RegExp = /^[0-9]$/;

// Joiners that shape the letters of some scripts (Persian, the Indic ones).
const ZERO_WIDTH_NON_JOINER: number = 0x200c;
const ZERO_WIDTH_JOINER: number = 0x200d;

// The parts of an emoji sequence besides the pictograph itself.
const EMOJI_PRESENTATION_SELECTORS: ReadonlySet<number> = new Set<number>([
  0xfe0e, 0xfe0f,
]);
const COMBINING_ENCLOSING_KEYCAP: number = 0x20e3;
const TAG_FIRST: number = 0xe0020;
const TAG_LAST: number = 0xe007f;

const PICTOGRAPH: RegExp = /\p{Extended_Pictographic}/u;
const EMOJI_MODIFIER: RegExp = /\p{Emoji_Modifier}/u;
const REGIONAL_INDICATOR: RegExp = /\p{Regional_Indicator}/u;
const FORMAT_CHARACTER: RegExp = /\p{Cf}/u;
const CONTROL_CHARACTER: RegExp = /\p{Cc}/u;
/*
 * A private-use character (an icon font's glyph, a box on a phone) or half
 * of a surrogate pair standing alone: neither is anything a reader can read.
 */
const UNREADABLE_CHARACTER: RegExp = /\p{Co}|\p{Cs}/u;
const SPACE_CHARACTER: RegExp = /\p{Zs}|\p{Zl}|\p{Zp}/u;
const WHITESPACE: RegExp = /\s/u;
const MARK: RegExp = /\p{M}/u;
const LETTER_OR_MARK: RegExp = /\p{L}|\p{M}/u;
const SYMBOL: RegExp = /\p{S}/u;

const codePointOf: (character: string) => number = (
  character: string,
): number => {
  return character.codePointAt(0) || 0;
};

const isGsm7Character: (character: string | undefined) => boolean = (
  character: string | undefined,
): boolean => {
  return character !== undefined && getGsm7Length(character) !== null;
};

// Whether the character is part of an emoji: a pictograph or what dresses one.
const isEmojiPart: (character: string) => boolean = (
  character: string,
): boolean => {
  const codePoint: number = codePointOf(character);

  return (
    PICTOGRAPH.test(character) ||
    EMOJI_MODIFIER.test(character) ||
    REGIONAL_INDICATOR.test(character) ||
    EMOJI_PRESENTATION_SELECTORS.has(codePoint) ||
    codePoint === COMBINING_ENCLOSING_KEYCAP ||
    (codePoint >= TAG_FIRST && codePoint <= TAG_LAST)
  );
};

/*
 * A letter (or mark) GSM-7 lacks, of a script the text keeps as written -
 * the neighbours a joiner shapes.
 */
const isKeptScriptLetter: (character: string | undefined) => boolean = (
  character: string | undefined,
): boolean => {
  return (
    character !== undefined &&
    LETTER_OR_MARK.test(character) &&
    !isGsm7Character(character) &&
    !isEmojiPart(character)
  );
};

/*
 * A character GSM-7 has, or the look-alike it is written as - null when it
 * has neither.
 */
const getPlainCharacter: (character: string) => string | null = (
  character: string,
): string | null => {
  if (isGsm7Character(character)) {
    return character;
  }

  const lookAlike: string | undefined = GSM_7_LOOK_ALIKES.get(character);

  if (lookAlike !== undefined) {
    return lookAlike;
  }

  if (SPACE_CHARACTER.test(character)) {
    return SPACE;
  }

  return null;
};

/*
 * The character written with GSM-7's characters through its compatibility
 * decomposition, its marks and the symbols with no look-alike left out (℃
 * is °C, and is written C) - null when that still needs others (a letter
 * of another script), or leaves nothing.
 */
const getDecomposedPlainText: (character: string) => string | null = (
  character: string,
): string | null => {
  let plain: string = "";

  for (const part of character.normalize("NFKD")) {
    if (MARK.test(part)) {
      continue;
    }

    const plainPart: string | null = getPlainCharacter(part);

    if (plainPart !== null) {
      plain += plainPart;
      continue;
    }

    if (SYMBOL.test(part)) {
      continue;
    }

    return null;
  }

  return plain || null;
};

/*
 * Whether a Greek mu stands for the micro sign: right after a number (or a
 * number and a space) and right before a unit's letter, as in 500μs or
 * 5 μm. In a Greek word it is a letter, and stays one.
 */
const isMuForMicro: (
  characters: ReadonlyArray<string>,
  index: number,
) => boolean = (characters: ReadonlyArray<string>, index: number): boolean => {
  const next: string | undefined = characters[index + 1];
  const previous: string | undefined = characters[index - 1];
  const beforePrevious: string | undefined = characters[index - 2];

  if (next === undefined || !ASCII_LETTER.test(next)) {
    return false;
  }

  if (previous !== undefined && ASCII_DIGIT.test(previous)) {
    return true;
  }

  return (
    previous === SPACE &&
    beforePrevious !== undefined &&
    ASCII_DIGIT.test(beforePrevious)
  );
};

/*
 * The text in GSM-7's characters wherever a character has a look-alike,
 * without emoji, invisible formatting and symbols that have none; letters of
 * other scripts as written. Line breaks are kept; a tab is a space.
 */
export const toGsm7Text: (text: string) => string = (text: string): string => {
  // Precomposed first, so an é typed as e and an accent is the é GSM-7 has.
  const characters: Array<string> = Array.from(text.normalize("NFC"));
  let written: string = "";
  // The last character written: none before the first.
  let lastWritten: string | undefined;

  const write: (plain: string) => void = (plain: string): void => {
    written += plain;
    lastWritten = Array.from(plain).pop();
  };

  for (let index: number = 0; index < characters.length; index++) {
    const character: string = characters[index]!;
    const codePoint: number = codePointOf(character);

    const plain: string | null = getPlainCharacter(character);

    if (plain !== null) {
      write(plain);
      continue;
    }

    if (codePoint === GREEK_SMALL_MU && isMuForMicro(characters, index)) {
      write("u");
      continue;
    }

    if (
      codePoint === ZERO_WIDTH_JOINER ||
      codePoint === ZERO_WIDTH_NON_JOINER
    ) {
      // Kept only between two letters of a script that is kept as written.
      if (
        isKeptScriptLetter(characters[index - 1]) &&
        isKeptScriptLetter(characters[index + 1])
      ) {
        written += character;
      }

      continue;
    }

    if (
      isEmojiPart(character) ||
      FORMAT_CHARACTER.test(character) ||
      CONTROL_CHARACTER.test(character) ||
      UNREADABLE_CHARACTER.test(character)
    ) {
      continue;
    }

    /*
     * A mark NFC could not join to the letter before it: kept on a letter
     * of another script, and left out everywhere else - after a letter
     * written in GSM-7, as the marks of every other such letter are, and
     * with nothing written before it to carry it.
     */
    if (MARK.test(character)) {
      if (lastWritten !== undefined && !isGsm7Character(lastWritten)) {
        written += character;
      }

      continue;
    }

    const decomposed: string | null = getDecomposedPlainText(character);

    if (decomposed !== null) {
      /*
       * After a digit, a fraction or a power is not more of the same
       * number: 1½ is 1 1/2 (not 11/2), 10² is 10^2 (not 102).
       */
      if (lastWritten !== undefined && ASCII_DIGIT.test(lastWritten)) {
        if (character.normalize("NFKD").includes(FRACTION_SLASH)) {
          write(SPACE);
        } else if (
          SUPERSCRIPTS.has(character) &&
          !SUPERSCRIPTS.has(characters[index - 1] || "")
        ) {
          write("^");
        }
      }

      write(decomposed);
      continue;
    }

    // A symbol with no look-alike says nothing the words around it do not.
    if (SYMBOL.test(character)) {
      continue;
    }

    // A letter, digit or punctuation mark of another script: as written.
    write(character);
  }

  return written;
};

/*
 * The text on one line: every run of spaces, tabs and line breaks one
 * space, and none at either end - a name or a title placed in a sentence.
 */
export const toOneLine: (text: string) => string = (text: string): string => {
  let line: string = "";
  let pendingSpace: boolean = false;

  for (const character of text) {
    if (WHITESPACE.test(character) || SPACE_CHARACTER.test(character)) {
      pendingSpace = line.length > 0;
      continue;
    }

    if (pendingSpace) {
      line += SPACE;
      pendingSpace = false;
    }

    line += character;
  }

  return line;
};

const LINK_SCHEMES: ReadonlyArray<string> = ["https://", "http://"];

// What may stand before a link in a sentence: an opening bracket or quote.
const BEFORE_LINK: ReadonlySet<string> = new Set<string>([
  "(",
  "<",
  "[",
  '"',
  "'",
]);

// Whether a word of a message is (or starts with) a link.
const isLinkWord: (word: string) => boolean = (word: string): boolean => {
  let start: number = 0;

  while (start < word.length && BEFORE_LINK.has(word[start]!)) {
    start++;
  }

  const rest: string = word.slice(start).toLowerCase();

  return LINK_SCHEMES.some((scheme: string): boolean => {
    return rest.startsWith(scheme);
  });
};

/*
 * The text with every run of spaces one space, and no space at the start or
 * end of a line: what is left where characters were left out (the emoji of
 * "API 🔥 down") or written as a word (5 ‰).
 */
const collapseSpaces: (text: string) => string = (text: string): string => {
  let collapsed: string = "";
  // A space is written only once the next character shows it parts words.
  let pendingSpace: boolean = false;
  /*
   * The last character written, kept apart: reading it back from the string
   * (collapsed[collapsed.length - 1]) made V8 flatten the string being
   * built at every space, copying all of it - time that grew with the
   * square of the text (400,000 characters of words took 12 seconds).
   */
  let last: string | undefined;

  for (const character of text) {
    if (character === SPACE) {
      pendingSpace = true;
      continue;
    }

    if (character === "\n" || character === "\r") {
      pendingSpace = false;
      collapsed += character;
      last = character;
      continue;
    }

    if (pendingSpace) {
      if (last !== undefined && last !== "\n" && last !== "\r") {
        collapsed += SPACE;
      }

      pendingSpace = false;
    }

    collapsed += character;
    last = character;
  }

  return collapsed;
};

/*
 * A whole message in GSM-7's characters (toGsm7Text), but for its links,
 * which go out exactly as written: a link is an address, and a look-alike
 * would lead somewhere else. Line breaks are kept; spaces are single, and
 * none is left where a character was left out.
 */
export const toGsm7Message: (text: string) => string = (
  text: string,
): string => {
  let written: string = "";
  let word: string = "";

  const flushWord: () => void = (): void => {
    written += isLinkWord(word) ? word : toGsm7Text(word);
    word = "";
  };

  for (const character of text) {
    if (WHITESPACE.test(character)) {
      flushWord();
      written += toGsm7Text(character);
      continue;
    }

    word += character;
  }

  flushWord();

  return collapseSpaces(written);
};
