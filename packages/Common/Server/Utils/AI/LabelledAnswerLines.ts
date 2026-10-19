import {
  isLineTerminatorCode,
  isWhiteSpaceCode,
} from "../../../Utils/RegExpCharacterClasses";

/*
 * ---------------------------------------------------------------------------
 * A MODEL'S "LABEL: VALUE" LINES, READ IN TIME IN LINE WITH ITS ANSWER.
 *
 * An AI run ends its answer with a line the server acts on -
 * "Classification: code-fault", "SelectedRunbook: <id>" - and the server
 * reads every such line, as the global, case-insensitive, multi-line pattern
 *
 *   ^\s*\**\s*<label>\s*\**\s*[:=]\s*\**\s*(<value>)\b
 *
 * found them, and acts on the last. The answer is what a model wrote, and a
 * model's answer can be steered by what it read; that pattern's white space
 * runs on across line breaks and sat on both sides of the "**", so a run of
 * blank lines was split every way at every line start: time that grew with
 * the cube of the run's length.
 *
 * Here the white space, the "**" and the white space are taken whole (each
 * can be followed by nothing they could also take), so every line start in
 * one run of white space reaches the same label: when it leads to no value
 * from one of them, it leads to none from the others, and they are not read
 * again. The values are found where the pattern found them, in the same
 * order.
 * ---------------------------------------------------------------------------
 */

const STAR: number = 0x2a;
const COLON: number = 0x3a;
const EQUALS: number = 0x3d;

type FromFunction = (text: string, from: number) => number;

// The end of the run of white space (\s) from `from`.
const whiteSpaceEnd: FromFunction = (text: string, from: number): number => {
  let index: number = from;

  while (index < text.length && isWhiteSpaceCode(text.charCodeAt(index))) {
    index++;
  }

  return index;
};

// \s*\**\s* taken whole from `from`: where it ends.
const afterWhiteSpaceAndStars: FromFunction = (
  text: string,
  from: number,
): number => {
  let index: number = whiteSpaceEnd(text, from);

  while (index < text.length && text.charCodeAt(index) === STAR) {
    index++;
  }

  return whiteSpaceEnd(text, index);
};

// The first line start (^ with the m flag) at or after `from`, or -1.
const lineStartAtOrAfter: FromFunction = (
  text: string,
  from: number,
): number => {
  if (from === 0) {
    return 0;
  }

  for (let index: number = from - 1; index < text.length; index++) {
    if (isLineTerminatorCode(text.charCodeAt(index))) {
      return index + 1;
    }
  }

  return -1;
};

type StartsWithLabelFunction = (
  text: string,
  at: number,
  label: string,
) => boolean;

/*
 * Whether `label` (lower case) is written at `at` in any case - an ASCII
 * letter in either case, as a case-insensitive pattern without the u flag
 * reads it.
 */
const startsWithLabel: StartsWithLabelFunction = (
  text: string,
  at: number,
  label: string,
): boolean => {
  if (at + label.length > text.length) {
    return false;
  }

  for (let index: number = 0; index < label.length; index++) {
    const code: number = text.charCodeAt(at + index);
    const lower: number = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;

    if (lower !== label.charCodeAt(index)) {
      return false;
    }
  }

  return true;
};

export type FindLabelledValuesFunction = (data: {
  text: string;
  // The label, in lower case: "classification".
  label: string;
  /*
   * The value, as a sticky (y) pattern whose group 1 is what the line
   * says, tried right where the value starts: /(none|[a-z0-9-]{8,64})\b/iy.
   */
  value: RegExp;
}) => Array<string>;

/*
 * Every value the pattern found, in order: group 1 of each match of
 * ^\s*\**\s*<label>\s*\**\s*[:=]\s*\**\s*(<value>) with the g, i and m
 * flags.
 */
export const findLabelledValues: FindLabelledValuesFunction = (data: {
  text: string;
  label: string;
  value: RegExp;
}): Array<string> => {
  const text: string = data.text;
  const values: Array<string> = [];
  // Sticky: tried right where a value starts (its lastIndex is set first).
  const value: RegExp = data.value;
  let searchFrom: number = 0;

  for (;;) {
    const lineStart: number = lineStartAtOrAfter(text, searchFrom);

    if (lineStart === -1) {
      return values;
    }

    const labelStart: number = afterWhiteSpaceAndStars(text, lineStart);

    if (startsWithLabel(text, labelStart, data.label)) {
      const separator: number = afterWhiteSpaceAndStars(
        text,
        labelStart + data.label.length,
      );
      const separatorCode: number = text.charCodeAt(separator);

      if (separatorCode === COLON || separatorCode === EQUALS) {
        const valueStart: number = afterWhiteSpaceAndStars(text, separator + 1);

        value.lastIndex = valueStart;

        const match: RegExpExecArray | null = value.exec(text);

        if (match && match.index === valueStart && match[1] !== undefined) {
          values.push(match[1]);
          searchFrom = valueStart + match[0].length;
          continue;
        }
      }
    }

    /*
     * No value from this line start - nor from any other in the run of white
     * space it is in, as each takes the rest of that run and goes on the
     * same way. Line starts after the run are read anew: one in the white
     * space after the "**" can take the next "**".
     */
    searchFrom = Math.max(lineStart + 1, whiteSpaceEnd(text, lineStart));
  }
};
