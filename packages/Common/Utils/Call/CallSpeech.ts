import { escapeRegExp } from "../RegExpEscape";

/*
 * HOW A CALL SAYS ITS WORDS.
 *
 * A call's words are written as text - the call's log shows them, a gateway
 * is sent them, and a Notification service of the release before speaks them
 * as they are - and they are spoken by Twilio's text-to-speech voice, from a
 * TwiML document. The voice reads some words wrong, and TwiML has no room for
 * some characters. This turns the written words into what the voice is given:
 *
 *   - text TwiML can carry (toTwimlText). XML 1.0 has no place for a control
 *     character, a lone surrogate, U+FFFE or U+FFFF, and Twilio's TwiML
 *     builder throws on one, so a title with a colour code from a log line
 *     (ESC [31m) stopped its call from being placed at all. Each becomes a
 *     space, and a terminal colour code goes whole;
 *   - a title cut for speech (cutForSpeech): at about 100 characters, at a
 *     word boundary - Intl.Segmenter's, so Chinese and Japanese, written
 *     without spaces, are cut between words too - and never inside an emoji
 *     or a letter with its accents;
 *   - a record's number (getRecordNumberSpeech). A voice reads "INC-42" as
 *     "Incorporated 42", so the letters of its prefix are said one by one:
 *     with SSML's <say-as interpret-as="characters"> for a voice that reads
 *     SSML, and as "I N C 42" for any other;
 *   - the product's own name, said as two words: "One Uptime". The text says
 *     OneUptime, so an installation that goes by its own name says that
 *     instead (ProductBrandingText), and only then is it spelled for the voice.
 *
 * SSML is read by Amazon Polly and Google voices only. OneUptime's calls name
 * no voice, so Twilio speaks them with the Twilio account's default voice -
 * Basic "man" unless the account's owner picked another in the Twilio
 * Console - and a Basic voice fails a <Say> that carries SSML. So a call
 * that names no voice is given spaced letters, which every voice reads alike
 * (isSsmlVoice).
 *
 * Pure, with no Node or browser APIs.
 */

// The longest title a call says, in characters - the "…" of a cut one included.
export const CALL_TITLE_MAX_LENGTH: number = 100;

// What a title cut for speech ends with: the rest is in OneUptime.
export const CALL_SPEECH_CUT_MARK: string = "…";

// What "#42" - a number without a prefix - is said as.
export const CALL_SPEECH_NUMBER_WORD: string = "number";

// The product's name as a voice is given it: two words, said as they are meant.
export const ONEUPTIME_SPOKEN_NAME: string = "One Uptime";

/*
 * A piece of what a voice is given: text it reads as written, or characters
 * it says one at a time.
 */
export type SpeechPart = { text: string } | { characters: string };

// A sentence of a call, as CallRequest carries one (Say).
export interface SpokenSentence {
  sayMessage: string;
  /*
   * A record's number in the sentence - "INC-42" - whose prefix is said
   * letter by letter.
   */
  recordNumber?: string | undefined;
}

/*
 * A terminal colour or cursor code - ESC, "[", its parameters, its final
 * character - which a title copied from a log line can carry. Matching ESC
 * is the point of it.
 */
// eslint-disable-next-line no-control-regex
const TERMINAL_CODE: RegExp = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;

const WHITESPACE_RUN: RegExp = /\s+/g;

const WHITESPACE: RegExp = /\s/;

// A record number: a prefix, then the number - "INC-42", "#42", "42".
const RECORD_NUMBER: RegExp = /^(.*?)([0-9]+)$/;

// The letters and digits of a prefix, in any script; the rest separates them.
const PREFIX_RUN: RegExp = /[\p{L}\p{M}\p{Nd}]+/gu;

const ENDS_WITH_DIGIT: RegExp = /\p{Nd}$/u;

/*
 * What a cut title does not end with before its "…": a space, or punctuation
 * that leads into what was cut - a comma, a colon, a dash, an opening bracket.
 */
const DANGLING_END: RegExp = /[\s,;:.!?、。，；：\-–—([{/\\]+$/u;

// "OneUptime" as a word: "OneUptime's", "OneUptime." - never inside a longer word.
const PRODUCT_NAME_WORD: RegExp = /\bOneUptime\b/g;

// Whether the voice named reads SSML: Amazon Polly's and Google's do.
const SSML_VOICE: RegExp = /^(polly|google)\./i;

/*
 * Whether a code point is one a voice can be given: one XML 1.0 allows (its
 * Char production - tab, line feed, carriage return, and everything from
 * space up but the surrogates, U+FFFE and U+FFFF), and no control character
 * (DEL and the C1 controls, which XML allows but no voice says).
 */
const isSpeakable: (codePoint: number) => boolean = (
  codePoint: number,
): boolean => {
  if (codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd) {
    return true;
  }

  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
    return false;
  }

  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return false;
  }

  return codePoint !== 0xfffe && codePoint !== 0xffff;
};

/*
 * `text` in characters TwiML can carry, and its builder takes: a terminal
 * colour code goes whole, and every other character XML has no place for -
 * a control character, a lone surrogate, U+FFFE, U+FFFF - becomes a space.
 * Anything that is not text is no words at all. Everything else is kept as
 * it is, spacing included: a verification code is spaced out to be read
 * slower.
 */
export const toTwimlText: (text: unknown) => string = (
  text: unknown,
): string => {
  if (typeof text !== "string") {
    return "";
  }

  let result: string = "";

  for (const character of text.replace(TERMINAL_CODE, "")) {
    result += isSpeakable(character.codePointAt(0)!) ? character : " ";
  }

  return result;
};

// `text` as the voice is given it: in characters TwiML carries, the product's name as two words.
export const toSpokenText: (text: unknown) => string = (
  text: unknown,
): string => {
  return toTwimlText(text).replace(PRODUCT_NAME_WORD, ONEUPTIME_SPOKEN_NAME);
};

// Whether the voice named reads SSML. None - the account's default voice - may not.
export const isSsmlVoice: (voice: string | null | undefined) => boolean = (
  voice: string | null | undefined,
): boolean => {
  return typeof voice === "string" && SSML_VOICE.test(voice.trim());
};

/*
 * Intl.Segmenter: in Node and in every browser OneUptime supports, though not
 * in the TypeScript library this package compiles against (ES2018).
 */
interface Segment {
  segment: string;
  index: number;
  isWordLike?: boolean | undefined;
}

interface Segmenter {
  segment: (text: string) => Iterable<Segment>;
}

type SegmenterConstructor = new (
  locales: string | undefined,
  options: { granularity: "grapheme" | "word" },
) => Segmenter;

const segmenters: Map<string, Segmenter | null> = new Map();

const getSegmenter: (granularity: "grapheme" | "word") => Segmenter | null = (
  granularity: "grapheme" | "word",
): Segmenter | null => {
  if (!segmenters.has(granularity)) {
    const constructor: unknown = (Intl as unknown as { Segmenter?: unknown })
      .Segmenter;

    let segmenter: Segmenter | null = null;

    if (typeof constructor === "function") {
      try {
        segmenter = new (constructor as SegmenterConstructor)(undefined, {
          granularity: granularity,
        });
      } catch {
        segmenter = null;
      }
    }

    segmenters.set(granularity, segmenter);
  }

  return segmenters.get(granularity) || null;
};

/*
 * The characters of `text` as a reader counts them: an emoji with its
 * modifiers, a flag, a letter with its accents are one each. Without
 * Intl.Segmenter, code points.
 */
export const getSpeechCharacters: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const segmenter: Segmenter | null = getSegmenter("grapheme");

  if (!segmenter) {
    return Array.from(text);
  }

  return Array.from(segmenter.segment(text), (segment: Segment): string => {
    return segment.segment;
  });
};

/*
 * Where `text` may be cut between words, as offsets into it: after each word,
 * as Intl.Segmenter finds words - in every script, Chinese and Japanese among
 * them, which are written without spaces. Without it, before each space.
 */
const getWordEnds: (text: string) => Array<number> = (
  text: string,
): Array<number> => {
  const segmenter: Segmenter | null = getSegmenter("word");
  const ends: Array<number> = [];

  if (!segmenter) {
    for (let index: number = 1; index < text.length; index++) {
      if (WHITESPACE.test(text[index]!) && !WHITESPACE.test(text[index - 1]!)) {
        ends.push(index);
      }
    }

    return ends;
  }

  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) {
      ends.push(segment.index + segment.segment.length);
    }
  }

  return ends;
};

/*
 * `text` as a call says it: on one line, and - when it has more than
 * `maxLength` characters (getSpeechCharacters) - cut to at most that many,
 * "…" included: after the last whole word that fits, when that leaves at
 * least half of them, else between two characters, so a text with no spaces
 * - a URL, a long identifier - still says its first part. Never inside an
 * emoji or a letter with its accents. A text that fits is said whole.
 */
export const cutForSpeech: (text: unknown, maxLength?: number) => string = (
  text: unknown,
  maxLength: number = CALL_TITLE_MAX_LENGTH,
): string => {
  if (typeof text !== "string") {
    return "";
  }

  const oneLine: string = text.replace(WHITESPACE_RUN, " ").trim();
  const characters: Array<string> = getSpeechCharacters(oneLine);

  if (characters.length <= maxLength) {
    return oneLine;
  }

  // The characters that fit beside the mark, and where they end in the text.
  const kept: number = Math.max(0, maxLength - CALL_SPEECH_CUT_MARK.length);
  const keptLength: number = characters.slice(0, kept).join("").length;

  const lastWordEnd: number = getWordEnds(oneLine)
    .filter((end: number): boolean => {
      return end <= keptLength;
    })
    .reduce((last: number, end: number): number => {
      return Math.max(last, end);
    }, 0);

  const cutAt: number =
    lastWordEnd >= keptLength / 2 ? lastWordEnd : keptLength;
  const cut: string = oneLine.slice(0, cutAt).replace(DANGLING_END, "");

  return `${cut}${CALL_SPEECH_CUT_MARK}`;
};

/*
 * How a voice says a record's number: the letters and digits of its prefix
 * one at a time, and its number as a number - "INC-42" as I N C 42. A
 * prefix's separators are not said; "#42", a number without a prefix, is
 * "number 42". A prefix whose letters end in a digit ("P1-42") is kept
 * apart from the number by a comma. Anything that does not end in a number
 * is said as it is written.
 */
export const getRecordNumberSpeech: (
  recordNumber: string,
) => Array<SpeechPart> = (recordNumber: string): Array<SpeechPart> => {
  const value: string =
    typeof recordNumber === "string" ? recordNumber.trim() : "";
  const match: RegExpMatchArray | null = value.match(RECORD_NUMBER);

  if (!match) {
    return value ? [{ text: value }] : [];
  }

  const prefix: string = match[1] || "";
  const digits: string = match[2] || "";
  const runs: Array<string> = prefix.match(PREFIX_RUN) || [];

  if (runs.length === 0) {
    return [
      {
        text: prefix.includes("#")
          ? `${CALL_SPEECH_NUMBER_WORD} ${digits}`
          : digits,
      },
    ];
  }

  const parts: Array<SpeechPart> = [];

  runs.forEach((run: string, index: number) => {
    if (index > 0) {
      parts.push({ text: " " });
    }

    parts.push({ characters: run.toUpperCase() });
  });

  parts.push({
    text: `${ENDS_WITH_DIGIT.test(runs[runs.length - 1]!) ? "," : ""} ${digits}`,
  });

  return parts;
};

// A piece of a sentence: text as written, or a record's number to spell.
type SentencePiece = { text: string } | { recordNumber: string };

/*
 * The pattern of a number written with one of `prefixes` - a project's own
 * number prefixes, "INC-", "ALT-", or "#" for a number without one - that
 * stands on its own: "INC-42" in "New incident created: INC-42 (Checkout is
 * down).", never in "XINC-42" or "INC-42b". The character before the number
 * is captured rather than looked behind for, as the frontends' engines need.
 * Null without a prefix.
 */
const getPrefixedNumberPattern: (
  prefixes: ReadonlyArray<string>,
) => RegExp | null = (prefixes: ReadonlyArray<string>): RegExp | null => {
  const usable: Array<string> = Array.from(
    new Set(
      prefixes
        .map((prefix: string): string => {
          return typeof prefix === "string" ? prefix.trim() : "";
        })
        .filter((prefix: string): boolean => {
          return prefix !== "";
        }),
    ),
  ).sort((first: string, second: string): number => {
    return second.length - first.length;
  });

  if (usable.length === 0) {
    return null;
  }

  return new RegExp(
    `(^|[^\\p{L}\\p{M}\\p{N}])((?:${usable.map(escapeRegExp).join("|")})[0-9]+)(?![\\p{L}\\p{M}\\p{N}])`,
    "gu",
  );
};

// `text` cut at every place it says `recordNumber`.
const splitOnRecordNumber: (
  text: string,
  recordNumber: string,
) => Array<SentencePiece> = (
  text: string,
  recordNumber: string,
): Array<SentencePiece> => {
  return text
    .split(recordNumber)
    .flatMap((between: string, index: number): Array<SentencePiece> => {
      return index === 0
        ? [{ text: between }]
        : [{ recordNumber: recordNumber }, { text: between }];
    });
};

// `text` cut at every number `pattern` finds.
const splitOnPrefixedNumbers: (
  text: string,
  pattern: RegExp,
) => Array<SentencePiece> = (
  text: string,
  pattern: RegExp,
): Array<SentencePiece> => {
  const pieces: Array<SentencePiece> = [];
  let from: number = 0;

  for (const match of text.matchAll(pattern)) {
    const start: number = (match.index || 0) + (match[1] || "").length;
    const number: string = match[2] || "";

    pieces.push({ text: text.slice(from, start) });
    pieces.push({ recordNumber: number });
    from = start + number.length;
  }

  pieces.push({ text: text.slice(from) });

  return pieces;
};

/*
 * What a voice is given for a sentence: its text as written, and each
 * record number in it as getRecordNumberSpeech says it - the number the
 * sentence carries (Say.recordNumber), wherever it names it, and every
 * number written with one of `recordNumberPrefixes`, the project's own
 * prefixes, so a title or an owner's message that names "INC-41" says it
 * right too. A sentence that no longer names the number it carries (a cut
 * one) is said as written. No empty text.
 */
export const getSpeechParts: (
  sentence: SpokenSentence,
  recordNumberPrefixes?: ReadonlyArray<string>,
) => Array<SpeechPart> = (
  sentence: SpokenSentence,
  recordNumberPrefixes: ReadonlyArray<string> = [],
): Array<SpeechPart> => {
  const text: string =
    typeof sentence.sayMessage === "string" ? sentence.sayMessage : "";
  const recordNumber: string =
    typeof sentence.recordNumber === "string"
      ? sentence.recordNumber.trim()
      : "";
  const pattern: RegExp | null = getPrefixedNumberPattern(recordNumberPrefixes);

  let pieces: Array<SentencePiece> = [{ text: text }];

  if (recordNumber) {
    pieces = pieces.flatMap((piece: SentencePiece): Array<SentencePiece> => {
      return "text" in piece
        ? splitOnRecordNumber(piece.text, recordNumber)
        : [piece];
    });
  }

  if (pattern) {
    pieces = pieces.flatMap((piece: SentencePiece): Array<SentencePiece> => {
      return "text" in piece
        ? splitOnPrefixedNumbers(piece.text, pattern)
        : [piece];
    });
  }

  return pieces
    .flatMap((piece: SentencePiece): Array<SpeechPart> => {
      return "text" in piece
        ? [{ text: piece.text }]
        : getRecordNumberSpeech(piece.recordNumber);
    })
    .filter((part: SpeechPart): boolean => {
      return "characters" in part ? part.characters !== "" : part.text !== "";
    });
};

// Characters said one at a time, for a voice that reads no SSML: "I N C".
export const spellOut: (characters: string) => string = (
  characters: string,
): string => {
  return getSpeechCharacters(characters).join(" ");
};

/*
 * The parts as one text, for a voice that reads no SSML: characters said one
 * at a time are spaced apart - "A new incident: I N C 42.".
 */
export const renderSpeechAsText: (parts: Array<SpeechPart>) => string = (
  parts: Array<SpeechPart>,
): string => {
  return parts
    .map((part: SpeechPart): string => {
      return "characters" in part ? spellOut(part.characters) : part.text;
    })
    .join("");
};
