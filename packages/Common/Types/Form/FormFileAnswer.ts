import {
  CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES,
  CUSTOM_FIELD_FILE_NAME_MAX_LENGTH,
  CUSTOM_FIELD_MAX_FILES,
} from "../CustomField/CustomFieldFile";

/*
 * A FORM'S FILE QUESTION: WHAT THE PUBLIC PAGE SENDS, AND THE LIMITS IT IS
 * HELD TO.
 *
 * Whoever fills a form in may have no OneUptime account, so nothing is
 * uploaded before the form is submitted: the page keeps the files in the
 * browser and sends them with the answers, each as
 *
 *     { "name": "outage.png", "fileType": "image/png", "data": "<base64>" }
 *
 * - one for a File question, a list for a Multiple files question. The
 * server stores them only once the submission has passed every check that
 * can refuse it - the captcha, the answers, the form's hourly ceilings - so
 * a file is never kept for a submission that is turned away, and the
 * submission's own limits are the files' too (FormRateLimit).
 *
 * Every file is held to what a file custom field takes (CustomFieldFile):
 * at most 10 MB, of a kind a field takes, holding what its type says
 * (FileContentCheck). A question holds at most CUSTOM_FIELD_MAX_FILES; a
 * whole submission at most FORM_SUBMISSION_MAX_FILES and
 * FORM_SUBMISSION_FILES_MAX_TOTAL_SIZE_IN_BYTES - which keeps its body well
 * inside the 50 MB the server reads, base64 and all.
 *
 * The bytes are read with the loops here, never a regular expression: a
 * file's text is megabytes on one line.
 *
 * Pure, with no Node or React imports: the server checks a submission with
 * it, and the public page packs one.
 */
export interface FormFileAnswer {
  name: string;
  fileType: string;
  // The file's bytes, base64.
  data: string;
}

// The largest file a form takes: what a file custom field takes.
export const FORM_FILE_MAX_SIZE_IN_BYTES: number =
  CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES;

// The most files one Multiple files question takes.
export const FORM_FILE_QUESTION_MAX_FILES: number = CUSTOM_FIELD_MAX_FILES;

// The most files one submission carries, every question together.
export const FORM_SUBMISSION_MAX_FILES: number = 10;

// The most a submission's files come to, together.
export const FORM_SUBMISSION_FILES_MAX_TOTAL_SIZE_IN_BYTES: number =
  20 * 1024 * 1024;

export const FORM_FILE_NAME_MAX_LENGTH: number =
  CUSTOM_FIELD_FILE_NAME_MAX_LENGTH;

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Each character's value, or -1 for one that is not in the alphabet.
const BASE64_VALUES: Int16Array = ((): Int16Array => {
  const values: Int16Array = new Int16Array(128).fill(-1);

  for (let index: number = 0; index < BASE64_ALPHABET.length; index++) {
    values[BASE64_ALPHABET.charCodeAt(index)] = index;
  }

  return values;
})();

export type EncodeBase64Function = (bytes: Uint8Array) => string;

/**
 * Bytes as base64, in one pass, in pieces small enough for a browser to
 * join a 10 MB file without running out of stack.
 */
export const encodeBase64: EncodeBase64Function = (
  bytes: Uint8Array,
): string => {
  const pieces: Array<string> = [];
  let piece: string = "";

  for (let index: number = 0; index < bytes.length; index += 3) {
    const first: number = bytes[index]!;
    const second: number | undefined = bytes[index + 1];
    const third: number | undefined = bytes[index + 2];

    piece += BASE64_ALPHABET[first >> 2]!;
    piece += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]!;
    piece +=
      second === undefined
        ? "="
        : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]!;
    piece += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f]!;

    if (piece.length >= 65536) {
      pieces.push(piece);
      piece = "";
    }
  }

  pieces.push(piece);

  return pieces.join("");
};

export type GetBase64DecodedLengthFunction = (text: string) => number | null;

/**
 * How many bytes a base64 text holds, from its length and its padding,
 * before anything is decoded - so a text too large for its limit is refused
 * unread. Null for a length no base64 text has.
 */
export const getBase64DecodedLength: GetBase64DecodedLengthFunction = (
  text: string,
): number | null => {
  if (text.length % 4 !== 0) {
    return null;
  }

  let padding: number = 0;

  if (text.endsWith("==")) {
    padding = 2;
  } else if (text.endsWith("=")) {
    padding = 1;
  }

  return (text.length / 4) * 3 - padding;
};

export type DecodeBase64Function = (
  text: string,
  maxBytes: number,
) => Uint8Array | null;

/**
 * The bytes of a base64 text, read strictly - the standard alphabet, padded
 * to a whole number of four characters, padding only at the end - in one
 * pass. Null for anything else, and for a text holding more than maxBytes,
 * which is refused before it is read.
 */
export const decodeBase64: DecodeBase64Function = (
  text: string,
  maxBytes: number,
): Uint8Array | null => {
  if (typeof text !== "string") {
    return null;
  }

  const length: number | null = getBase64DecodedLength(text);

  if (length === null || length > maxBytes) {
    return null;
  }

  const bytes: Uint8Array = new Uint8Array(length);
  let written: number = 0;

  for (let index: number = 0; index < text.length; index += 4) {
    const isLast: boolean = index + 4 === text.length;
    const quad: Array<number> = [0, 0, 0, 0];
    let padded: number = 0;

    for (let offset: number = 0; offset < 4; offset++) {
      const code: number = text.charCodeAt(index + offset);

      if (code === 0x3d) {
        // "=": only in the last two places of the last four characters.
        if (!isLast || offset < 2) {
          return null;
        }

        padded++;
        continue;
      }

      // A character after padding, or one outside the alphabet.
      if (padded > 0 || code >= 128 || BASE64_VALUES[code]! < 0) {
        return null;
      }

      quad[offset] = BASE64_VALUES[code]!;
    }

    const value: number =
      (quad[0]! << 18) | (quad[1]! << 12) | (quad[2]! << 6) | quad[3]!;

    bytes[written++] = (value >> 16) & 0xff;

    if (padded < 2) {
      bytes[written++] = (value >> 8) & 0xff;
    }

    if (padded < 1) {
      bytes[written++] = value & 0xff;
    }
  }

  return bytes;
};

export type CleanFormFileNameFunction = (name: unknown) => string;

/*
 * A file's name as it is kept: its last part only (a browser may send
 * "C:\\fakepath\\report.pdf"), without control characters, runs of spaces as
 * one, trimmed, and cut to FORM_FILE_NAME_MAX_LENGTH keeping its extension.
 * "" for a name that holds nothing.
 */
export const cleanFormFileName: CleanFormFileNameFunction = (
  name: unknown,
): string => {
  if (typeof name !== "string") {
    return "";
  }

  let lastPart: string = name;
  const lastSlash: number = Math.max(
    name.lastIndexOf("/"),
    name.lastIndexOf("\\"),
  );

  if (lastSlash !== -1) {
    lastPart = name.slice(lastSlash + 1);
  }

  let cleaned: string = "";
  let lastWasSpace: boolean = false;

  for (const character of lastPart) {
    const code: number = character.codePointAt(0)!;

    // Control characters, line breaks and tabs.
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0)) {
      continue;
    }

    if (character === " ") {
      if (lastWasSpace) {
        continue;
      }

      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }

    cleaned += character;
  }

  cleaned = cleaned.trim();

  const characters: Array<string> = Array.from(cleaned);

  if (characters.length <= FORM_FILE_NAME_MAX_LENGTH) {
    return cleaned;
  }

  const dot: number = cleaned.lastIndexOf(".");
  const extension: string =
    dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  const keep: number =
    FORM_FILE_NAME_MAX_LENGTH - Array.from(extension).length;

  return (
    Array.from(cleaned.slice(0, cleaned.length - extension.length))
      .slice(0, keep)
      .join("")
      .trimEnd() + extension
  );
};
