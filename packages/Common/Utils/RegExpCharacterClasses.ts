/*
 * THE CHARACTER CLASSES OF A REGULAR EXPRESSION, ASKED OF ONE CODE UNIT.
 *
 * Code that reads text one character at a time - in place of a pattern
 * that read it many times over - must agree with the pattern on every
 * character it classes. These are JavaScript's own classes, without the u
 * flag: \s, the characters "." does not match, \d and \w, each asked of one
 * UTF-16 code unit (charCodeAt).
 */

export type IsCodeFunction = (code: number) => boolean;

/*
 * What \s matches: white space and the line terminators - tab, line feed,
 * vertical tab, form feed, carriage return, space, no-break space, the
 * Ogham space mark, the spaces from en quad to hair space, the line and
 * paragraph separators, the narrow no-break space, the medium mathematical
 * space, the ideographic space and the byte order mark.
 */
export const isWhiteSpaceCode: IsCodeFunction = (code: number): boolean => {
  if (code <= 0x20) {
    return code === 0x20 || (code >= 0x09 && code <= 0x0d);
  }

  if (code < 0xa0) {
    return false;
  }

  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
};

/*
 * What "." does not match (without the s flag): line feed, carriage
 * return, and the line and paragraph separators. Each of them is also
 * white space.
 */
export const isLineTerminatorCode: IsCodeFunction = (code: number): boolean => {
  return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
};

// What \d matches: an ASCII digit.
export const isDigitCode: IsCodeFunction = (code: number): boolean => {
  return code >= 0x30 && code <= 0x39;
};

// What \w matches (without the u flag): an ASCII letter, a digit or "_".
export const isWordCode: IsCodeFunction = (code: number): boolean => {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x5f
  );
};

// An ASCII letter, as [A-Za-z] matches it.
export const isAsciiLetterCode: IsCodeFunction = (code: number): boolean => {
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a);
};
