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

// Each alphabet character's code, by its value.
const BASE64_CODES: Uint8Array = ((): Uint8Array => {
  const codes: Uint8Array = new Uint8Array(64);

  for (let index: number = 0; index < BASE64_ALPHABET.length; index++) {
    codes[index] = BASE64_ALPHABET.charCodeAt(index);
  }

  return codes;
})();

// The "=" a short last group is padded with.
const PADDING_CODE: number = 0x3d;

// How many characters are turned into text at a time: well inside a stack.
const TEXT_PIECE_LENGTH: number = 8192;

export type EncodeBase64Function = (bytes: Uint8Array) => string;

/**
 * Bytes as base64, in one pass: the characters' codes first, then turned
 * into text in pieces small enough for a browser to join a 10 MB file
 * without running out of stack.
 */
export const encodeBase64: EncodeBase64Function = (
  bytes: Uint8Array,
): string => {
  const codes: Uint8Array = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let written: number = 0;
  let index: number = 0;

  for (; index + 2 < bytes.length; index += 3) {
    const value: number =
      (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;

    codes[written++] = BASE64_CODES[(value >> 18) & 0x3f]!;
    codes[written++] = BASE64_CODES[(value >> 12) & 0x3f]!;
    codes[written++] = BASE64_CODES[(value >> 6) & 0x3f]!;
    codes[written++] = BASE64_CODES[value & 0x3f]!;
  }

  const left: number = bytes.length - index;

  if (left > 0) {
    const value: number =
      (bytes[index]! << 16) | (left > 1 ? bytes[index + 1]! << 8 : 0);

    codes[written++] = BASE64_CODES[(value >> 18) & 0x3f]!;
    codes[written++] = BASE64_CODES[(value >> 12) & 0x3f]!;
    codes[written++] =
      left > 1 ? BASE64_CODES[(value >> 6) & 0x3f]! : PADDING_CODE;
    codes[written++] = PADDING_CODE;
  }

  const pieces: Array<string> = [];

  for (
    let start: number = 0;
    start < codes.length;
    start += TEXT_PIECE_LENGTH
  ) {
    pieces.push(
      String.fromCharCode.apply(
        null,
        codes.subarray(
          start,
          start + TEXT_PIECE_LENGTH,
        ) as unknown as Array<number>,
      ),
    );
  }

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

type ValueOfFunction = (code: number) => number;

// A character's value in the alphabet, or -1 for one that is not in it.
const valueOf: ValueOfFunction = (code: number): number => {
  return code < 128 ? BASE64_VALUES[code]! : -1;
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
  // Every group but the last has no padding: it is read without asking.
  const fullGroupsEnd: number = text.length - 4;
  let written: number = 0;
  let index: number = 0;

  for (; index < fullGroupsEnd; index += 4) {
    const first: number = valueOf(text.charCodeAt(index));
    const second: number = valueOf(text.charCodeAt(index + 1));
    const third: number = valueOf(text.charCodeAt(index + 2));
    const fourth: number = valueOf(text.charCodeAt(index + 3));

    if ((first | second | third | fourth) < 0) {
      return null;
    }

    const value: number =
      (first << 18) | (second << 12) | (third << 6) | fourth;

    bytes[written++] = (value >> 16) & 0xff;
    bytes[written++] = (value >> 8) & 0xff;
    bytes[written++] = value & 0xff;
  }

  if (text.length === 0) {
    return bytes;
  }

  // The last group: "=" only in its last two places, and nothing after one.
  const codes: Array<number> = [
    text.charCodeAt(index),
    text.charCodeAt(index + 1),
    text.charCodeAt(index + 2),
    text.charCodeAt(index + 3),
  ];

  if (
    codes[0] === PADDING_CODE ||
    codes[1] === PADDING_CODE ||
    (codes[2] === PADDING_CODE && codes[3] !== PADDING_CODE)
  ) {
    return null;
  }

  const values: Array<number> = codes.map((code: number): number => {
    return code === PADDING_CODE ? 0 : valueOf(code);
  });

  if (
    values.some((value: number): boolean => {
      return value < 0;
    })
  ) {
    return null;
  }

  const value: number =
    (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!;

  bytes[written++] = (value >> 16) & 0xff;

  if (codes[2] !== PADDING_CODE) {
    bytes[written++] = (value >> 8) & 0xff;
  }

  if (codes[3] !== PADDING_CODE) {
    bytes[written++] = value & 0xff;
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
  const keep: number = FORM_FILE_NAME_MAX_LENGTH - Array.from(extension).length;

  return (
    Array.from(cleaned.slice(0, cleaned.length - extension.length))
      .slice(0, keep)
      .join("")
      .trimEnd() + extension
  );
};
