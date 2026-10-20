import {
  isLineTerminatorCode,
  isWhiteSpaceCode,
} from "../../../Utils/RegExpCharacterClasses";

/*
 * ---------------------------------------------------------------------------
 * A HEADING LINE OF THE MARKDOWN EDITOR, READ IN TIME IN LINE WITH ITS
 * LENGTH.
 *
 * The editor read a heading with /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/: up to
 * three characters of white space, one to six hashes, white space, then the
 * fewest characters of text after which the line ends in white space,
 * closing hashes and white space. Each length of the text was tried in
 * turn, and each try read the white space after it again for every way the
 * two runs of white space around the closing hashes could share it: on a
 * line built for it the time grew with the cube of its length, and faster
 * still with a line terminator in it (a line of 1,200 characters took over
 * a minute). The editor reads every line of a note, description or
 * postmortem it opens, written by whoever wrote it.
 *
 * readHeadingLine reads the line once from its start and once from its end,
 * and gives exactly what the pattern gave: how many hashes open the line and
 * the text, or null where the pattern did not match.
 *
 * In the pattern, \s is white space, line terminators included, "." is any
 * character but a line terminator (\n, \r, U+2028, U+2029), and $ is the end
 * of the line (no m flag).
 * ---------------------------------------------------------------------------
 */

export interface HeadingLine {
  // How many hashes open the line: 1 to 6.
  level: number;
  // The heading's text: the pattern's second group.
  text: string;
}

const HASH: number = 0x23;

// How many characters of white space the hashes may come after.
const MOST_LEADING_WHITE_SPACE: number = 3;

// How many hashes a heading opens with at most.
const MOST_HASHES: number = 6;

export type ReadHeadingLineFunction = (line: string) => HeadingLine | null;

export const readHeadingLine: ReadHeadingLineFunction = (
  line: string,
): HeadingLine | null => {
  const length: number = line.length;

  /*
   * \s{0,3}(#{1,6}): a hash cannot be white space, so the white space is
   * the line's whole leading run, and the hashes its whole run of hashes.
   */
  let index: number = 0;

  while (index < length && isWhiteSpaceCode(line.charCodeAt(index))) {
    if (index === MOST_LEADING_WHITE_SPACE) {
      return null;
    }

    index++;
  }

  const hashesStart: number = index;

  while (index < length && line.charCodeAt(index) === HASH) {
    index++;
  }

  const level: number = index - hashesStart;

  if (level === 0 || level > MOST_HASHES) {
    return null;
  }

  // \s+: at least one character of white space after the hashes.
  if (index === length || !isWhiteSpaceCode(line.charCodeAt(index))) {
    return null;
  }

  /*
   * The text starts after the whole run of white space: the pattern takes
   * it whole first, and when that fails, every shorter take fails too.
   */
  let textStart: number = index;

  while (textStart < length && isWhiteSpaceCode(line.charCodeAt(textStart))) {
    textStart++;
  }

  /*
   * The text is the fewest characters after which the rest of the line is
   * white space, hashes and white space: read back from the line's end, and
   * never before the text's start.
   */
  let textEnd: number = length;

  while (
    textEnd > textStart &&
    isWhiteSpaceCode(line.charCodeAt(textEnd - 1))
  ) {
    textEnd--;
  }

  while (textEnd > textStart && line.charCodeAt(textEnd - 1) === HASH) {
    textEnd--;
  }

  while (
    textEnd > textStart &&
    isWhiteSpaceCode(line.charCodeAt(textEnd - 1))
  ) {
    textEnd--;
  }

  // "." does not match a line terminator: the text cannot hold one.
  for (let at: number = textStart; at < textEnd; at++) {
    if (isLineTerminatorCode(line.charCodeAt(at))) {
      return null;
    }
  }

  return { level: level, text: line.slice(textStart, textEnd) };
};
