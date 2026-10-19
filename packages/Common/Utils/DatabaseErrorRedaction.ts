/*
 * The credentials a database driver's error message can quote, found and
 * replaced: a connection address that carries a login, and a password
 * setting of a connection string. Shared by the data sources (on the server)
 * and the SQL and database monitors (on a probe), where the message is
 * whatever the database, or a server pretending to be one, sent back - so
 * of any length and any shape.
 *
 * Each is read in time in line with the message's length, and replaces
 * exactly what the pattern it stands for replaced (named with each one).
 */

/*
 * ---------------------------------------------------------------------------
 * CONNECTION ADDRESSES WITH A LOGIN: postgres://user:pass@host/db,
 * mysql://..., sqlserver://...
 *
 * What is replaced is what the global pattern "[a-zA-Z]+://[^\s]*@[^\s]*"
 * replaced: in a run of characters other than white space, everything from
 * the first scheme written before a "://" (the letters right before it) to
 * the end of the run, when an "@" comes after that "://" in the run. What
 * the run holds before the scheme stays.
 *
 * That pattern was tried again from every letter of a run whose first "://"
 * has no "@" after it, and every try read on to the end of the run, so a
 * long run of letters, or of "A://", took time that grows with the square
 * of its length. Here each run is read once: when the first scheme in a run
 * has no "@" after its "://", no later one has either, since what follows a
 * later "://" in the run is a part of what follows the first.
 * ---------------------------------------------------------------------------
 */

// A run of characters other than white space, as [^\s] reads them.
const NON_SPACE_RUN: RegExp = /\S+/g;

const SCHEME_SEPARATOR: string = "://";

type IsAsciiLetterFunction = (code: number) => boolean;

const isAsciiLetter: IsAsciiLetterFunction = (code: number): boolean => {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
};

type RedactRunFunction = (run: string, replacement: string) => string;

const redactDsnInRun: RedactRunFunction = (
  run: string,
  replacement: string,
): string => {
  let from: number = 0;

  for (;;) {
    const separator: number = run.indexOf(SCHEME_SEPARATOR, from);

    if (separator === -1) {
      return run;
    }

    let schemeStart: number = separator;

    while (schemeStart > 0 && isAsciiLetter(run.charCodeAt(schemeStart - 1))) {
      schemeStart--;
    }

    if (schemeStart === separator) {
      // No scheme before this "://": the next one may have one.
      from = separator + 1;
      continue;
    }

    // The run's first scheme decides the run.
    if (run.indexOf("@", separator + SCHEME_SEPARATOR.length) === -1) {
      return run;
    }

    return run.slice(0, schemeStart) + replacement;
  }
};

export type RedactDsnsFunction = (text: string, replacement: string) => string;

export const redactDsns: RedactDsnsFunction = (
  text: string,
  replacement: string,
): string => {
  if (text.indexOf(SCHEME_SEPARATOR) === -1) {
    return text;
  }

  return text.replace(NON_SPACE_RUN, (run: string): string => {
    return redactDsnInRun(run, replacement);
  });
};

/*
 * ---------------------------------------------------------------------------
 * PASSWORD SETTINGS: Password=secret;Server=..., PWD={a;b}, password: "x y"
 *
 * What is replaced is what the global, case-insensitive pattern
 *   (password|pwd)\s*[=:]\s*(\{[^}]*\}|"[^"]*"|'[^']*'|[^;\r\n]+)
 * replaced with "$1=***": the name as written, then "=***" in place of the
 * separator and the value. The value is a braced one up to the first "}"
 * after its "{", a quoted one up to the next quote of its kind, or else the
 * rest of the line up to a ";". When a ";" or the end of the text comes
 * right after the separator and its white space, that white space is given
 * back from its end, as the pattern did, until a character other than a
 * line break can start the value.
 *
 * The pattern looked for the "}" of a "{" through the rest of the text, and
 * did so again for every "{" when there is no "}" after them - so a message
 * holding "pwd={" on line after line took time that grows with the square
 * of its length. Here the first "}" after a point is looked for once and
 * remembered: the values are read left to right, so a "}" found for one
 * value still answers for the next, and none after one point means none
 * after any later point.
 * ---------------------------------------------------------------------------
 */

// The names, in any case, as the pattern's case-insensitive alternation reads them.
const PASSWORD_NAME: RegExp = /password|pwd/gi;

const WHITESPACE_RUN: RegExp = /\s*/y;

// The characters of a value that is neither braced nor quoted.
const PLAIN_VALUE_RUN: RegExp = /[^;\r\n]*/y;

type RunLengthFunction = (
  pattern: RegExp,
  text: string,
  start: number,
) => number;

const runLength: RunLengthFunction = (
  pattern: RegExp,
  text: string,
  start: number,
): number => {
  pattern.lastIndex = start;

  const run: RegExpExecArray | null = pattern.exec(text);

  return run ? run[0].length : 0;
};

export type RedactPasswordSettingsFunction = (text: string) => string;

export const redactPasswordSettings: RedactPasswordSettingsFunction = (
  text: string,
): string => {
  const parts: Array<string> = [];
  let copied: number = 0;
  let searchFrom: number = 0;

  /*
   * The first "}" at or after closeSearchStart, -1 when there is none: it
   * still answers for a later place it is not before.
   */
  let closeSearchStart: number = -1;
  let knownClose: number = -1;

  const firstCloseFrom: (from: number) => number = (from: number): number => {
    if (
      closeSearchStart !== -1 &&
      from >= closeSearchStart &&
      (knownClose === -1 || knownClose >= from)
    ) {
      return knownClose;
    }

    closeSearchStart = from;
    knownClose = text.indexOf("}", from);

    return knownClose;
  };

  // Where a value starting at `start` ends, or -1 when none starts there.
  const valueEnd: (start: number) => number = (start: number): number => {
    const first: string = text.charAt(start);

    if (first === "{") {
      const close: number = firstCloseFrom(start + 1);

      if (close !== -1) {
        return close + 1;
      }
    } else if (first === '"' || first === "'") {
      const close: number = text.indexOf(first, start + 1);

      if (close !== -1) {
        return close + 1;
      }
    }

    // Otherwise the rest of the line up to a ";", at least one character of it.
    if (
      start >= text.length ||
      first === ";" ||
      first === "\r" ||
      first === "\n"
    ) {
      return -1;
    }

    return start + runLength(PLAIN_VALUE_RUN, text, start);
  };

  for (;;) {
    PASSWORD_NAME.lastIndex = searchFrom;

    const name: RegExpExecArray | null = PASSWORD_NAME.exec(text);

    if (!name) {
      break;
    }

    const nameEnd: number = name.index + name[0].length;
    const separator: number =
      nameEnd + runLength(WHITESPACE_RUN, text, nameEnd);
    const separatorCharacter: string = text.charAt(separator);

    if (separatorCharacter !== "=" && separatorCharacter !== ":") {
      searchFrom = name.index + 1;
      continue;
    }

    const gapStart: number = separator + 1;
    const valueStart: number =
      gapStart + runLength(WHITESPACE_RUN, text, gapStart);

    let end: number = valueEnd(valueStart);

    // Nothing can start the value there: give back the gap from its end.
    for (
      let start: number = valueStart - 1;
      end === -1 && start >= gapStart;
      start--
    ) {
      end = valueEnd(start);
    }

    if (end === -1) {
      searchFrom = name.index + 1;
      continue;
    }

    parts.push(text.slice(copied, name.index), name[0], "=***");
    copied = end;
    searchFrom = end;
  }

  if (parts.length === 0) {
    return text;
  }

  parts.push(text.slice(copied));

  return parts.join("");
};
