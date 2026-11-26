import PercentDecodedText from "../PercentDecodedText";

/*
 * A TEXT AS THE NAMES-AND-ADDRESSES MODEL READS IT (#11034).
 *
 * A name in a URL is written with its escapes - name=Jos%C3%A9%20Garc%C3%ADa,
 * full_name=Jane+Doe - and the model reads a run of escapes as one token, no
 * name: "Jos" at most, the given name before the first escape. So the model
 * reads a text as a URL is read: its percent-escapes read (PercentDecodedText,
 * a character's UTF-8 bytes too, #11032), and a "+" between two letters as
 * the space a query string means by it, which keeps every position where it
 * was. Each name it finds there is placed back on the characters the text
 * writes it with (toWritten), escapes and all, so it is hidden and masked
 * there; and what its finding counts as - a value the project allows, a
 * placeholder such as Jane Doe - is judged as it reads (readableForModel).
 *
 * A text with neither reads as it is written. In time in line with the
 * text's length: one decoding, one replacement.
 */

export interface ModelReading {
  // The text as the model reads it.
  text: string;
  // Where a position of that reading - a character's start, or the end - is written.
  toWritten: (position: number) => number;
}

// A "+" between two letters: the space a query string writes it for (Jane+Doe).
const PLUS_BETWEEN_LETTERS: RegExp = /(?<=[\p{L}\p{M}])\+(?=\p{L})/gu;

function samePosition(position: number): number {
  return position;
}

export function readingForModel(text: string): ModelReading {
  const decoded: PercentDecodedText | null =
    text.indexOf("%") === -1 ? null : PercentDecodedText.read(text);
  const readable: string = decoded ? decoded.readable : text;

  return {
    text:
      readable.indexOf("+") === -1
        ? readable
        : readable.replace(PLUS_BETWEEN_LETTERS, " "),
    toWritten: decoded
      ? (position: number): number => {
          return decoded.toWritten(position);
        }
      : samePosition,
  };
}

// A value as the model reads it: what a finding of it is judged by.
export function readableForModel(text: string): string {
  return readingForModel(text).text;
}
