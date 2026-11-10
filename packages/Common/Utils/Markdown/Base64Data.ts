import { isBase64Character } from "./InlineImageDataUri";
import { HoldBackFunction } from "./OverLongText";

/*
 * BASE64 DATA IN MARKDOWN, KEPT FROM THE PARSER THAT READS IT.
 *
 * A synthetic monitor's screenshot reaches an incident's or an alert's
 * description as an image whose address is the image itself (see
 * InlineImageDataUri):
 *
 *   ![Home](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...)
 *
 * Its data is tens of thousands of characters (a JPEG) to millions (a PNG),
 * all on one line, and a Markdown parser has no use for any of it: the
 * address is judged and shown once the parser is done. Read anyway, it cost
 * twice:
 *
 *   - marked ran out of stack on a screenshot of a few megabytes, in a
 *     process that had run a while (see Server/Types/Markdown).
 *   - SlowMarkdown, which keeps text of a slow shape from a parser, reads
 *     the data as one word with a "+" or a "/" in every thirty characters -
 *     the shape of minified JSON, which takes a parser time that grows with
 *     its square. The dashboard held back the paragraph of every screenshot
 *     between about eleven and sixty-four thousand characters - a JPEG
 *     screenshot, most of the time - and showed it as text, base64 and all
 *     (issue #6010).
 *
 * So before a parser reads Markdown, each run of base64 right after a
 * ";base64," that is at least HELD_BASE64_MIN_LENGTH characters long is held
 * back, all but its last character, and the caller puts back what it held
 * where the parser put the token: into the address before anything judges
 * it, or into text. The last character stays so that whatever follows the
 * data reads exactly as it did. The email renderer (holdBackFromMarked) and
 * the dashboard's Markdown viewer (holdBackForViewer) both do.
 *
 * Pure, with no Node or browser APIs, and no regular expression runs over
 * the text: ";base64," is found with indexOf, the data with a loop, so this
 * reads megabytes on the same small stack (see isBase64 in
 * InlineImageDataUri).
 */

/*
 * Base64 data at least this long is held back. A screenshot runs to tens of
 * thousands of characters at the least; shorter data costs a parser nothing
 * and stays in place.
 */
export const HELD_BASE64_MIN_LENGTH: number = 1024;

// What comes right before the data of a data: URL that carries base64.
const BASE64_DATA_START: string = ";base64,";

// A run of base64 data after ";base64," in a text: where it starts and ends.
export interface Base64Run {
  // The first character of the data, right after ";base64,".
  start: number;
  // Right after its last base64 character: "=" padding is not part of it.
  end: number;
}

const isAsciiLowercaseLetter: (code: number) => boolean = (
  code: number,
): boolean => {
  return code >= 0x61 && code <= 0x7a;
};

/*
 * Whether ";base64," starts at text[index], its letters in either case, as a
 * data: URL may write them - in ASCII only, never a letter of another script
 * that a case mapping takes to one.
 */
const startsWithBase64DataStart: (text: string, index: number) => boolean = (
  text: string,
  index: number,
): boolean => {
  if (index + BASE64_DATA_START.length > text.length) {
    return false;
  }

  for (let offset: number = 0; offset < BASE64_DATA_START.length; offset++) {
    const expected: number = BASE64_DATA_START.charCodeAt(offset);
    const code: number = text.charCodeAt(index + offset);

    if (
      isAsciiLowercaseLetter(expected)
        ? (code | 0x20) !== expected
        : code !== expected
    ) {
      return false;
    }
  }

  return true;
};

/*
 * The runs of base64 data in `text` of at least `minLength` characters
 * (by default those long enough to hold back), each right after a
 * ";base64,", in order. A run is base64's standard alphabet only; it ends
 * at the first other character, "=" padding included.
 */
export const getBase64Runs: (
  text: string,
  minLength?: number,
) => Array<Base64Run> = (
  text: string,
  minLength: number = HELD_BASE64_MIN_LENGTH,
): Array<Base64Run> => {
  const runs: Array<Base64Run> = [];

  if (typeof text !== "string") {
    return runs;
  }

  let searchFrom: number = 0;

  for (;;) {
    const semicolon: number = text.indexOf(";", searchFrom);

    if (semicolon === -1) {
      return runs;
    }

    if (!startsWithBase64DataStart(text, semicolon)) {
      searchFrom = semicolon + 1;
      continue;
    }

    const start: number = semicolon + BASE64_DATA_START.length;
    let end: number = start;

    while (end < text.length && isBase64Character(text.charCodeAt(end))) {
      end++;
    }

    if (end - start >= minLength) {
      runs.push({ start: start, end: end });
    }

    // Base64 holds no ";": the next one is after the run.
    searchFrom = end;
  }
};

/*
 * `text` with each run of base64 data of at least HELD_BASE64_MIN_LENGTH
 * characters held back, all but its last character (see the top of this
 * file). The same as `text` when it has no such run.
 */
export const holdBackBase64Data: (
  text: string,
  hold: HoldBackFunction,
) => string = (text: string, hold: HoldBackFunction): string => {
  if (typeof text !== "string" || text.length < HELD_BASE64_MIN_LENGTH) {
    return text;
  }

  const runs: Array<Base64Run> = getBase64Runs(text);

  if (runs.length === 0) {
    return text;
  }

  const pieces: Array<string> = [];
  let copiedUpTo: number = 0;

  for (const run of runs) {
    const heldEnd: number = run.end - 1;

    pieces.push(
      text.slice(copiedUpTo, run.start),
      hold(text.slice(run.start, heldEnd)),
    );
    copiedUpTo = heldEnd;
  }

  pieces.push(text.slice(copiedUpTo));

  return pieces.join("");
};
