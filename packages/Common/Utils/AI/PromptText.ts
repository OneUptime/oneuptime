import { AIPromptOmissions } from "../../Types/AI/AIChatTypes";
import {
  getInlineImageTypeOfBase64,
  InlineImageMimeType,
  InlineImageType,
  isBase64Character,
} from "../Markdown/InlineImageDataUri";

/*
 * TEXT A MODEL IS GIVEN.
 *
 * Incidents, alerts and their notes carry text a model cannot read. A
 * synthetic monitor's screenshot reaches a description as an image that
 * carries itself (see Utils/Markdown/InlineImageDataUri):
 *
 *   ![Login page](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...)
 *
 * People see the screenshot - on the incident's page, in the emails, in
 * Slack and Microsoft Teams - but a model given the text reads hundreds of
 * kilobytes of base64: noise to it, and billed as more than a hundred
 * thousand tokens. An investigation sends its incident with every call to
 * the model, so one screenshot cost millions of tokens a run, and spent a
 * project's whole daily AI limit (issue #4587).
 *
 * So text from a record goes into a prompt through here:
 *
 *   - Every embedded file - a data: URL with base64 data, in Markdown, in
 *     HTML or on its own - and every run of at least MIN_ENCODED_RUN_LENGTH
 *     base64 characters is replaced by a short note that says what it was:
 *     "[image omitted: JPEG, 340 KB]", "[file omitted: application/pdf,
 *     12 KB]", "[encoded data omitted: 300 KB]". The model still sees the
 *     alt text and everything around it. An image is named by its bytes, as
 *     the emails name it, whatever its data: URL says.
 *   - A free-text field is held to a length - MAX_PROMPT_FIELD_LENGTH in
 *     what a run sends with every call, MAX_DRAFT_PROMPT_FIELD_LENGTH in a
 *     draft written in one call - ending with a note saying how much was
 *     left out, so no one field can crowd out the rest of the prompt.
 *
 * Only what the model is given changes: the record keeps its images.
 * Text with neither comes back exactly as it was, the same string.
 *
 * A data: URL whose data is not base64 ("data:,Hello", an SVG written out
 * as text) is text a model can read, and stays; so does base64url (with
 * "-" and "_"), which a data: URL never holds. The field's length bounds
 * both.
 *
 * LINEAR, AND NO REGULAR EXPRESSION READS THE TEXT. A screenshot is
 * megabytes on one line, and V8 matches a regular expression with a stack
 * that can grow with every character a quantifier takes (see
 * InlineImageDataUri.isBase64): the text is read once, with charCodeAt.
 *
 * Pure, with no Node or browser APIs.
 */

// The most one free-text field takes in what a run sends with every call.
export const MAX_PROMPT_FIELD_LENGTH: number = 4_000;

/*
 * The most one free-text field takes in a draft written in one call: a
 * postmortem, a note, a runbook step's answer.
 */
export const MAX_DRAFT_PROMPT_FIELD_LENGTH: number = 16_000;

/*
 * A run of base64 at least this long, with no data: URL around it, is
 * embedded data too: a screenshot placed without its "data:image/png;base64,"
 * prefix, a file in a response body. Text has no word this long; a hash, a
 * token or a key is far shorter.
 */
export const MIN_ENCODED_RUN_LENGTH: number = 1_024;

// The most read between "data:" and ";base64," - a media type and parameters.
const MAX_MEDIA_TYPE_LENGTH: number = 256;

// The longest media type a note names; a longer one is left unnamed.
const MAX_NAMED_MEDIA_TYPE_LENGTH: number = 64;

/*
 * The longest note this module writes: a "[file omitted: <type>, <size>]"
 * with the longest media type it names.
 */
const MAX_NOTE_LENGTH: number = MAX_NAMED_MEDIA_TYPE_LENGTH + 48;

/*
 * A text cut at its length ends at a word when one ends this close to the
 * cut, rather than in the middle of the word.
 */
const WORD_END_SEARCH_LENGTH: number = 64;

const IMAGE_NOTE_START: string = "[image omitted";
const FILE_NOTE_START: string = "[file omitted";
const ENCODED_DATA_NOTE_START: string = "[encoded data omitted";

const NOTE_STARTS: ReadonlyArray<string> = [
  IMAGE_NOTE_START,
  FILE_NOTE_START,
  ENCODED_DATA_NOTE_START,
];

const IMAGE_TYPE_NAMES: Record<InlineImageMimeType, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
};

// type/subtype, as a data: URL names it: "image/png", "application/pdf".
const MEDIA_TYPE_PATTERN: RegExp = /^[a-z0-9][a-z0-9.+_-]*\/[a-z0-9][a-z0-9.+_-]*$/;

// Digits a thousands separator goes before: 1234567 -> 1,234,567.
const THOUSANDS_PATTERN: RegExp = /\B(?=(\d{3})+(?!\d))/g;

const CHAR_SPACE: number = 0x20;
const CHAR_TAB: number = 0x09;
const CHAR_LINE_FEED: number = 0x0a;
const CHAR_CARRIAGE_RETURN: number = 0x0d;
const CHAR_PERCENT: number = 0x25;
const CHAR_COMMA: number = 0x2c;
const CHAR_COLON: number = 0x3a;
const CHAR_SEMICOLON: number = 0x3b;
const CHAR_EQUALS: number = 0x3d;
const CHAR_LEFT_BRACKET: number = 0x5b;

// Lower case of an ASCII letter: 0x20 set ("D" -> "d"); other codes never match.
const LOWER_CASE_BIT: number = 0x20;

// What a media type and its parameters may hold, besides letters and digits.
const MEDIA_TYPE_PUNCTUATION: ReadonlySet<number> = new Set<number>(
  Array.from("!#$&*+-.^_/;=").map((character: string): number => {
    return character.charCodeAt(0);
  }),
);

export interface PromptTextResult {
  text: string;
  omissions: AIPromptOmissions;
}

export interface FittedText {
  text: string;
  // How many characters the cut left out; 0 when the text fit.
  omittedCharacters: number;
}

export interface PromptFieldOptions {
  // The most the field takes; MAX_PROMPT_FIELD_LENGTH when not given.
  maxLength?: number | undefined;
  // Where to add up what was left out, for a run to say so.
  omissions?: AIPromptOmissions | undefined;
}

export interface PromptMessage {
  content: string;
}

export interface PromptMessagesResult<T extends PromptMessage> {
  messages: Array<T>;
  omissions: AIPromptOmissions;
}

interface EmbeddedDataUrl {
  // Where the URL ends: after its data and padding.
  end: number;
  // The media type it declares, lower case, without its parameters.
  declaredType: string;
  dataStart: number;
  dataEnd: number;
}

type CharacterTestFunction = (code: number) => boolean;

const isAsciiLetterOrDigit: CharacterTestFunction = (code: number): boolean => {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39)
  );
};

const isMediaTypeCharacter: CharacterTestFunction = (code: number): boolean => {
  return (
    isAsciiLetterOrDigit(code) ||
    code === CHAR_PERCENT ||
    MEDIA_TYPE_PUNCTUATION.has(code)
  );
};

const isWhitespace: CharacterTestFunction = (code: number): boolean => {
  return (
    code === CHAR_SPACE ||
    code === CHAR_TAB ||
    code === CHAR_LINE_FEED ||
    code === CHAR_CARRIAGE_RETURN
  );
};

const isHighSurrogate: CharacterTestFunction = (code: number): boolean => {
  return code >= 0xd800 && code <= 0xdbff;
};

type MatchesAtFunction = (
  text: string,
  start: number,
  lowerCase: string,
) => boolean;

/*
 * Whether `text` holds `lowerCase` at `start`, in any case. `lowerCase` is
 * lower-case ASCII letters, digits and punctuation.
 */
const matchesAt: MatchesAtFunction = (
  text: string,
  start: number,
  lowerCase: string,
): boolean => {
  if (start < 0 || start + lowerCase.length > text.length) {
    return false;
  }

  for (let offset: number = 0; offset < lowerCase.length; offset++) {
    const expected: number = lowerCase.charCodeAt(offset);
    const actual: number = text.charCodeAt(start + offset);

    if (actual === expected) {
      continue;
    }

    // An upper-case letter matches its lower case; nothing else does.
    if (
      expected >= 0x61 &&
      expected <= 0x7a &&
      (actual | LOWER_CASE_BIT) === expected
    ) {
      continue;
    }

    return false;
  }

  return true;
};

type ReadDataUrlFunction = (
  text: string,
  start: number,
) => EmbeddedDataUrl | null;

/*
 * The data: URL with base64 data that starts at `start` (where "data:" is),
 * or null when it is not one: no ";base64," after a media type of at most
 * MAX_MEDIA_TYPE_LENGTH characters, or no data after it - "data:,Hello" is
 * text, and "data:image/png;base64,{{screenshot}}" in a template is a
 * template.
 */
const readDataUrl: ReadDataUrlFunction = (
  text: string,
  start: number,
): EmbeddedDataUrl | null => {
  const typeStart: number = start + "data:".length;
  const typeLimit: number = Math.min(
    text.length,
    typeStart + MAX_MEDIA_TYPE_LENGTH,
  );

  let comma: number = -1;

  for (let index: number = typeStart; index < typeLimit; index++) {
    const code: number = text.charCodeAt(index);

    if (code === CHAR_COMMA) {
      comma = index;
      break;
    }

    if (!isMediaTypeCharacter(code)) {
      return null;
    }
  }

  const markerStart: number = comma - ";base64".length;

  if (
    comma === -1 ||
    markerStart < typeStart ||
    !matchesAt(text, markerStart, ";base64")
  ) {
    return null;
  }

  const dataStart: number = comma + 1;
  let dataEnd: number = dataStart;

  while (dataEnd < text.length && isBase64Character(text.charCodeAt(dataEnd))) {
    dataEnd++;
  }

  if (dataEnd === dataStart) {
    return null;
  }

  let end: number = dataEnd;

  while (
    end - dataEnd < 2 &&
    end < text.length &&
    text.charCodeAt(end) === CHAR_EQUALS
  ) {
    end++;
  }

  // The media type ends at its first parameter.
  let typeEnd: number = typeStart;

  while (typeEnd < markerStart && text.charCodeAt(typeEnd) !== CHAR_SEMICOLON) {
    typeEnd++;
  }

  return {
    end: end,
    declaredType: text.slice(typeStart, typeEnd).toLowerCase(),
    dataStart: dataStart,
    dataEnd: dataEnd,
  };
};

type FormatFunction = (value: number) => string;

// 1234567 -> "1,234,567", the same on every server whatever its locale.
export const formatCount: FormatFunction = (value: number): string => {
  return String(Math.max(0, Math.round(value))).replace(THOUSANDS_PATTERN, ",");
};

// A size people read: "512 bytes", "340 KB", "2.4 MB".
export const formatSize: FormatFunction = (bytes: number): string => {
  const rounded: number = Math.max(0, Math.round(bytes));

  if (rounded < 1024) {
    return rounded === 1 ? "1 byte" : `${formatCount(rounded)} bytes`;
  }

  if (rounded < 1024 * 1024) {
    return `${formatCount(Math.round(rounded / 1024))} KB`;
  }

  return `${Math.round(rounded / 104857.6) / 10} MB`;
};

// How many bytes `length` characters of base64 decode to.
const decodedLength: FormatFunction = (length: number): number => {
  return Math.floor((length * 3) / 4);
};

type NamedMediaTypeFunction = (declaredType: string) => string | null;

// The media type a note names, or null when it is not one worth naming.
const namedMediaType: NamedMediaTypeFunction = (
  declaredType: string,
): string | null => {
  if (
    declaredType.length === 0 ||
    declaredType.length > MAX_NAMED_MEDIA_TYPE_LENGTH ||
    !MEDIA_TYPE_PATTERN.test(declaredType)
  ) {
    return null;
  }

  return declaredType;
};

type WriteNoteFunction = (
  start: string,
  kind: string | null,
  bytes: number,
) => string;

// "[image omitted: PNG, 340 KB]": what was left out, and its size.
const writeNote: WriteNoteFunction = (
  start: string,
  kind: string | null,
  bytes: number,
): string => {
  return `${start}: ${kind ? `${kind}, ` : ""}${formatSize(bytes)}]`;
};

export default class PromptText {
  // Nothing left out yet.
  public static noOmissions(): AIPromptOmissions {
    return {
      imageCount: 0,
      imageBytes: 0,
      encodedDataCount: 0,
      encodedDataBytes: 0,
      shortenedTextCount: 0,
      omittedCharacterCount: 0,
    };
  }

  // Whether anything was left out.
  public static hasOmissions(
    omissions: AIPromptOmissions | null | undefined,
  ): boolean {
    return Boolean(
      omissions &&
        (omissions.imageCount > 0 ||
          omissions.encodedDataCount > 0 ||
          omissions.shortenedTextCount > 0),
    );
  }

  // Adds what `from` left out to `into`.
  public static addOmissions(
    into: AIPromptOmissions,
    from: AIPromptOmissions,
  ): void {
    into.imageCount += from.imageCount;
    into.imageBytes += from.imageBytes;
    into.encodedDataCount += from.encodedDataCount;
    into.encodedDataBytes += from.encodedDataBytes;
    into.shortenedTextCount += from.shortenedTextCount;
    into.omittedCharacterCount += from.omittedCharacterCount;
  }

  /**
   * `text` with every embedded file and every long run of base64 replaced
   * by a note saying what it was (see above), and what was left out. Text
   * with neither comes back as the same string.
   */
  public static omitEmbeddedData(text: string): PromptTextResult {
    const omissions: AIPromptOmissions = PromptText.noOmissions();

    if (typeof text !== "string" || text.length === 0) {
      return { text: text, omissions: omissions };
    }

    const pieces: Array<string> = [];
    const length: number = text.length;
    let copiedUpTo: number = 0;
    let runStart: number = -1;
    let index: number = 0;

    // Replaces text[start, end) with `note`.
    const replace: (start: number, end: number, note: string) => void = (
      start: number,
      end: number,
      note: string,
    ): void => {
      pieces.push(text.slice(copiedUpTo, start), note);
      copiedUpTo = end;
    };

    /*
     * A run of base64 characters, text[start, end), and the padding after
     * it: replaced when it is long enough to be embedded data. Returns
     * where the text goes on.
     */
    const endRun: (start: number, end: number) => number = (
      start: number,
      end: number,
    ): number => {
      if (end - start < MIN_ENCODED_RUN_LENGTH) {
        return end;
      }

      let paddedEnd: number = end;

      while (
        paddedEnd - end < 2 &&
        paddedEnd < length &&
        text.charCodeAt(paddedEnd) === CHAR_EQUALS
      ) {
        paddedEnd++;
      }

      const image: InlineImageType | null = getInlineImageTypeOfBase64(
        text.slice(start, start + 16),
      );

      if (image) {
        const bytes: number = decodedLength(end - start);

        omissions.imageCount++;
        omissions.imageBytes += bytes;
        replace(
          start,
          paddedEnd,
          writeNote(IMAGE_NOTE_START, IMAGE_TYPE_NAMES[image.mimeType], bytes),
        );
      } else {
        const characters: number = paddedEnd - start;

        omissions.encodedDataCount++;
        omissions.encodedDataBytes += characters;
        replace(
          start,
          paddedEnd,
          writeNote(ENCODED_DATA_NOTE_START, null, characters),
        );
      }

      return paddedEnd;
    };

    while (index < length) {
      const code: number = text.charCodeAt(index);

      if (isBase64Character(code)) {
        if (runStart === -1) {
          runStart = index;
        }

        index++;
        continue;
      }

      /*
       * "data:" ends at a colon, after four characters that were part of a
       * run - the run is the text before the URL.
       */
      if (code === CHAR_COLON && matchesAt(text, index - 4, "data")) {
        const url: EmbeddedDataUrl | null = readDataUrl(text, index - 4);

        if (url) {
          if (runStart !== -1 && runStart < index - 4) {
            endRun(runStart, index - 4);
          }

          runStart = -1;

          const image: InlineImageType | null = getInlineImageTypeOfBase64(
            text.slice(url.dataStart, url.dataStart + 16),
          );
          const bytes: number = decodedLength(url.dataEnd - url.dataStart);
          const mediaType: string | null = namedMediaType(url.declaredType);

          if (image || url.declaredType.startsWith("image/")) {
            omissions.imageCount++;
            omissions.imageBytes += bytes;
            replace(
              index - 4,
              url.end,
              writeNote(
                IMAGE_NOTE_START,
                image ? IMAGE_TYPE_NAMES[image.mimeType] : mediaType,
                bytes,
              ),
            );
          } else {
            omissions.encodedDataCount++;
            omissions.encodedDataBytes += bytes;
            replace(
              index - 4,
              url.end,
              writeNote(FILE_NOTE_START, mediaType, bytes),
            );
          }

          index = url.end;
          continue;
        }
      }

      if (runStart !== -1) {
        const next: number = endRun(runStart, index);

        runStart = -1;

        if (next > index) {
          index = next;
          continue;
        }
      }

      index++;
    }

    if (runStart !== -1) {
      endRun(runStart, length);
    }

    if (pieces.length === 0) {
      return { text: text, omissions: omissions };
    }

    pieces.push(text.slice(copiedUpTo));

    return { text: pieces.join(""), omissions: omissions };
  }

  /**
   * `text` held to `maxLength` characters, ending with a note saying how
   * many more there were. The cut never splits a character, nor a note
   * omitEmbeddedData wrote, and ends at a word when one ends close by.
   */
  public static fitToLength(text: string, maxLength: number): FittedText {
    if (typeof text !== "string" || text.length <= Math.max(0, maxLength)) {
      return { text: text, omittedCharacters: 0 };
    }

    let cut: number = Math.max(0, Math.floor(maxLength));

    // A pair of UTF-16 code units is one character: never keep half of it.
    if (cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1))) {
      cut--;
    }

    // Never keep half of a note: "[image omitted: PN".
    const noteStart: number = text.lastIndexOf(
      String.fromCharCode(CHAR_LEFT_BRACKET),
      cut - 1,
    );

    if (
      noteStart !== -1 &&
      cut - noteStart < MAX_NOTE_LENGTH &&
      text.indexOf("]", noteStart) >= cut &&
      NOTE_STARTS.some((start: string): boolean => {
        return text.startsWith(start, noteStart);
      })
    ) {
      cut = noteStart;
    }

    // End at a word when one ends close by.
    for (
      let index: number = cut;
      index > 0 && cut - index < WORD_END_SEARCH_LENGTH;
      index--
    ) {
      if (isWhitespace(text.charCodeAt(index))) {
        cut = index;
        break;
      }
    }

    let kept: number = cut;

    while (kept > 0 && isWhitespace(text.charCodeAt(kept - 1))) {
      kept--;
    }

    const omittedCharacters: number = text.length - kept;

    return {
      text: `${text.slice(0, kept)}… [${formatCount(omittedCharacters)} more characters omitted]`,
      omittedCharacters: omittedCharacters,
    };
  }

  /**
   * A free-text field of a record - a description, a root cause, a note -
   * as a prompt carries it: embedded data left out, and held to a length
   * (MAX_PROMPT_FIELD_LENGTH unless `maxLength` says otherwise). Nothing
   * becomes "". What was left out is added to `omissions` when given.
   */
  public static field(
    value: string | null | undefined,
    options: PromptFieldOptions = {},
  ): string {
    if (value === null || value === undefined) {
      return "";
    }

    const text: string = typeof value === "string" ? value : String(value);
    const withoutData: PromptTextResult = PromptText.omitEmbeddedData(text);
    const fitted: FittedText = PromptText.fitToLength(
      withoutData.text,
      options.maxLength ?? MAX_PROMPT_FIELD_LENGTH,
    );

    if (options.omissions) {
      PromptText.addOmissions(options.omissions, withoutData.omissions);

      if (fitted.omittedCharacters > 0) {
        options.omissions.shortenedTextCount++;
        options.omissions.omittedCharacterCount += fitted.omittedCharacters;
      }
    }

    return fitted.text;
  }

  /**
   * The messages of a model call with the embedded data in each left out,
   * and what was. Messages that had none are the same objects; when none
   * had any, the same array comes back.
   */
  public static omitEmbeddedDataFromMessages<T extends PromptMessage>(
    messages: Array<T>,
  ): PromptMessagesResult<T> {
    const omissions: AIPromptOmissions = PromptText.noOmissions();
    let changed: Array<T> | null = null;

    for (let index: number = 0; index < messages.length; index++) {
      const message: T | undefined = messages[index];

      if (!message || typeof message.content !== "string") {
        continue;
      }

      const result: PromptTextResult = PromptText.omitEmbeddedData(
        message.content,
      );

      if (result.text === message.content) {
        continue;
      }

      changed = changed || messages.slice();
      changed[index] = { ...message, content: result.text };
      PromptText.addOmissions(omissions, result.omissions);
    }

    return { messages: changed || messages, omissions: omissions };
  }

  /**
   * What was left out, in English, for a log line - or null when nothing
   * was. It names no product: an installation can rename it.
   */
  public static describeOmissions(
    omissions: AIPromptOmissions | null | undefined,
  ): string | null {
    if (!omissions || !PromptText.hasOmissions(omissions)) {
      return null;
    }

    const sentences: Array<string> = [];

    if (omissions.imageCount > 0) {
      sentences.push(
        `Left out ${formatCount(omissions.imageCount)} embedded ${
          omissions.imageCount === 1 ? "image" : "images"
        } (${formatSize(omissions.imageBytes)}): AI reads text, not images.`,
      );
    }

    if (omissions.encodedDataCount > 0) {
      sentences.push(
        `Left out ${formatSize(omissions.encodedDataBytes)} of encoded data: AI reads text only.`,
      );
    }

    if (omissions.shortenedTextCount > 0) {
      sentences.push(
        `Shortened ${formatCount(omissions.shortenedTextCount)} long ${
          omissions.shortenedTextCount === 1 ? "text" : "texts"
        }: ${formatCount(omissions.omittedCharacterCount)} characters left out.`,
      );
    }

    return sentences.join(" ");
  }
}
