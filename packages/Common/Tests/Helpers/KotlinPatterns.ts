import fs from "fs";
import path from "path";
import { REPOSITORY_DIRECTORY, SKIPPED_FOLDER_NAMES } from "./TagStripScan";

/*
 * THE AGENTS' KOTLIN, READ FOR ITS REGULAR EXPRESSIONS.
 *
 * The Android agent (agents/AndroidAgent) is Kotlin. A pattern there is a
 * string handed to Regex(...), .toRegex() or Pattern.compile, so a guard
 * that holds patterns to a rule reads every string literal of the agents'
 * product code (kotlinProductFiles: what is under a src/main folder) outside
 * comments, with its escapes decoded (kotlinStringLiterals).
 *
 * A device runs those patterns with Android's regular expressions (ICU's)
 * and the agent's unit tests run them with the JVM's. A guard that times a
 * pattern on the texts that were slow can only run JavaScript's, so
 * javaScriptForm writes a Java pattern for it, read in the same steps on
 * ASCII text, and refuses what JavaScript would read in other steps, so that
 * a guard is told rather than misled.
 *
 * The two engines part at a word's edge too: ICU reads \w, \d, \s and Java's
 * POSIX classes with the letters, digits and spaces of every script, and \b
 * past a combining mark or a zero-width space, where the JVM and JavaScript
 * read them as ASCII. differentWordEdges finds where a pattern's edge reads
 * otherwise on a device than in the tests (#10835), and differentReadings
 * where a class or a "." elsewhere in it does (#10876).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface KotlinStringLiteral {
  // The string's text, its escapes decoded; a template's code as written.
  value: string;
  // The line it starts on, from 1.
  line: number;
  // Where it starts in the file: the offset of its first quote.
  start: number;
  // Whether it holds a template ($name or ${...}), whose text is the code's.
  hasTemplate: boolean;
  // Whether it is a pattern: handed to Regex(...) or Pattern.compile(...), or made one with .toRegex().
  isPattern: boolean;
}

const IDENTIFIER_START: RegExp = /[A-Za-z_]/;
const IDENTIFIER_PART: RegExp = /[A-Za-z0-9_]/;
const HEX_DIGITS: RegExp = /^[0-9A-Fa-f]{4}$/;

// The code just before a literal that hands it to a pattern's constructor (by position, or as its named pattern).
const HANDED_TO_PATTERN: RegExp =
  /(?<![A-Za-z0-9_$])(?:Regex|Pattern\s*\.\s*compile)\s*\(\s*(?:pattern\s*=\s*)?$/;
// The code just after a literal that makes it a pattern.
const MADE_A_PATTERN: RegExp = /^\s*\.\s*toRegex\s*\(/;
// How much of the code before a literal is kept to tell.
const CODE_KEPT: number = 64;

// Kotlin's escapes in a string that is not raw, and what each stands for.
const ESCAPES: Readonly<Record<string, string>> = {
  t: "\t",
  b: "\b",
  n: "\n",
  r: "\r",
  "'": "'",
  '"': '"',
  "\\": "\\",
  $: "$",
};

export type KotlinStringLiteralsFunction = (
  text: string,
) => Array<KotlinStringLiteral>;

/*
 * Every string literal of a Kotlin file, in order: raw ("""...""") and not,
 * outside line comments, block comments (which nest in Kotlin) and character
 * literals. A template's code is kept as written and the literal says it
 * holds one; a literal a template holds is not read on its own. A literal is
 * a pattern when the code before it, comments aside, hands it to Regex(...)
 * or Pattern.compile(...), or the code after it calls .toRegex() on it.
 */
export const kotlinStringLiterals: KotlinStringLiteralsFunction = (
  text: string,
): Array<KotlinStringLiteral> => {
  const found: Array<KotlinStringLiteral> = [];
  let index: number = 0;
  let line: number = 1;
  // The code read last, comments left out and each literal a placeholder.
  let code: string = "";

  const keep: (read: string) => void = (read: string): void => {
    code = (code + read).slice(-CODE_KEPT);
  };

  // A template's ${...}, from its "{" to its "}", as written.
  const readBlockTemplate: () => string = (): string => {
    const start: number = index;
    let depth: number = 0;

    while (index < text.length) {
      const char: string = text[index]!;

      if (char === "\n") {
        line++;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;

        if (depth === 0) {
          index++;
          break;
        }
      }

      index++;
    }

    return text.slice(start, index);
  };

  // A template's $name, after its "$", as written.
  const readNameTemplate: () => string = (): string => {
    const start: number = index;

    while (index < text.length && IDENTIFIER_PART.test(text[index]!)) {
      index++;
    }

    return text.slice(start, index);
  };

  while (index < text.length) {
    const char: string = text[index]!;

    if (char === "\n") {
      line++;
      index++;
      keep(char);
      continue;
    }

    if (text.startsWith("//", index)) {
      while (index < text.length && text[index] !== "\n") {
        index++;
      }
      keep(" ");
      continue;
    }

    if (text.startsWith("/*", index)) {
      let depth: number = 0;

      while (index < text.length) {
        if (text.startsWith("/*", index)) {
          depth++;
          index += 2;
        } else if (text.startsWith("*/", index)) {
          depth--;
          index += 2;

          if (depth === 0) {
            break;
          }
        } else {
          if (text[index] === "\n") {
            line++;
          }
          index++;
        }
      }
      keep(" ");
      continue;
    }

    // A character literal: '"' holds a quote that opens no string.
    if (char === "'") {
      index++;

      while (index < text.length && text[index] !== "'") {
        index += text[index] === "\\" ? 2 : 1;
      }

      index++;
      keep("'c'");
      continue;
    }

    // A name in backticks, which may hold a quote too.
    if (char === "`") {
      const end: number = text.indexOf("`", index + 1);

      index = end === -1 ? text.length : end + 1;
      keep("name");
      continue;
    }

    if (char !== '"') {
      index++;
      keep(char);
      continue;
    }

    const start: number = index;
    const startLine: number = line;
    const raw: boolean = text.startsWith('"""', index);
    const handedToPattern: boolean = HANDED_TO_PATTERN.test(code);
    let value: string = "";
    let hasTemplate: boolean = false;

    index += raw ? 3 : 1;

    while (index < text.length) {
      const current: string = text[index]!;

      if (raw && text.startsWith('"""', index)) {
        // A raw string ends at the last three quotes of a run of them.
        let quotes: number = 0;

        while (text[index + quotes] === '"') {
          quotes++;
        }

        value += '"'.repeat(quotes - 3);
        index += quotes;
        break;
      }

      if (!raw && current === '"') {
        index++;
        break;
      }

      if (!raw && current === "\n") {
        // Not Kotlin: a string ends on its line. Read on from here.
        break;
      }

      if (!raw && current === "\\") {
        const escaped: string = text[index + 1] ?? "";

        if (
          escaped === "u" &&
          HEX_DIGITS.test(text.slice(index + 2, index + 6))
        ) {
          value += String.fromCharCode(
            parseInt(text.slice(index + 2, index + 6), 16),
          );
          index += 6;
          continue;
        }

        value += ESCAPES[escaped] ?? `\\${escaped}`;
        index += 2;
        continue;
      }

      if (current === "$" && text[index + 1] === "{") {
        hasTemplate = true;
        value += "$";
        index++;
        value += readBlockTemplate();
        continue;
      }

      if (current === "$" && IDENTIFIER_START.test(text[index + 1] ?? "")) {
        hasTemplate = true;
        value += "$";
        index++;
        value += readNameTemplate();
        continue;
      }

      if (current === "\n") {
        line++;
      }

      value += current;
      index++;
    }

    found.push({
      value,
      line: startLine,
      start,
      hasTemplate,
      isPattern:
        handedToPattern ||
        MADE_A_PATTERN.test(text.slice(index, index + CODE_KEPT)),
    });
    keep('""');
  }

  return found;
};

export type KotlinProductFilesFunction = (root?: string) => Array<string>;

/*
 * Every Kotlin file of the agents' product code under `root` (the
 * repository's): what is under a src/main folder of agents/, by its path from
 * `root` ("/" between folders), sorted. Builds, hidden folders and
 * dependencies are not walked; no agents/ folder holds nothing.
 */
export const kotlinProductFiles: KotlinProductFilesFunction = (
  root: string = REPOSITORY_DIRECTORY,
): Array<string> => {
  const files: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIPPED_FOLDER_NAMES.has(entry.name)) {
        continue;
      }

      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const relativePath: string = path
        .relative(root, fullPath)
        .split(path.sep)
        .join("/");

      if (
        entry.isFile() &&
        relativePath.endsWith(".kt") &&
        relativePath.includes("/src/main/")
      ) {
        files.push(relativePath);
      }
    }
  };

  const agents: string = path.join(root, "agents");

  if (fs.existsSync(agents)) {
    walk(agents);
  }

  return files.sort();
};

export interface JavaScriptPattern {
  source: string;
  flags: string;
}

// The flags a Java pattern may open with that JavaScript has, as flags.
const LEADING_FLAGS: RegExp = /^\(\?([a-z]+)\)/;
const FLAGS_JAVASCRIPT_HAS: ReadonlySet<string> = new Set<string>([
  "i",
  "m",
  "s",
]);

/*
 * The escapes a pattern reads alike in Java and in JavaScript (without the
 * u flag) on ASCII text: classes of characters, word boundaries, the control
 * characters, and any character that is not a letter or a digit, which
 * stands for itself in both. On other text \s and \b part: JavaScript's \s
 * takes Unicode's spaces, and ICU's \b counts the letters of every script.
 */
const SAME_ESCAPE_LETTERS: ReadonlySet<string> = new Set<string>([
  "d",
  "D",
  "w",
  "W",
  "s",
  "S",
  "b",
  "B",
  "t",
  "n",
  "r",
  "f",
]);
const STANDS_FOR_ITSELF: RegExp = /^[^A-Za-z0-9]$/;
const UNICODE_ESCAPE: RegExp = /^u[0-9A-Fa-f]{4}/;
const HEX_ESCAPE: RegExp = /^x[0-9A-Fa-f]{2}/;
const COUNTED_REPEAT: RegExp = /^\{\d+(?:,\d*)?\}/;
// What a group may open with, after "(?", that reads alike in both.
const SAME_GROUP_OPENINGS: ReadonlyArray<string> = [":", "=", "!", "<=", "<!"];
// An escaped digit that names a group: a back-reference.
const GROUP_NUMBER: RegExp = /^[1-9]$/;

// The opening of SAME_GROUP_OPENINGS that `source` has at `at`, if any.
const sameGroupOpeningAt: (source: string, at: number) => string | undefined = (
  source: string,
  at: number,
): string | undefined => {
  return SAME_GROUP_OPENINGS.find((start: string): boolean => {
    return source.startsWith(start, at);
  });
};

export type JavaScriptFormFunction = (source: string) => JavaScriptPattern;

/*
 * A Java pattern as JavaScript's regular expressions read it, in the same
 * steps on ASCII text: what a guard that times a Kotlin pattern runs.
 *
 * An atomic group, (?>X), which JavaScript does not have, becomes
 * (?=(X))\n: a look-ahead is atomic in JavaScript, so it settles on X's
 * first match and keeps it, and \n reads that match again. Flags a pattern
 * opens with, (?i), become flags. Anything else that JavaScript would read
 * differently is refused with the reason, rather than read some other way:
 * a possessive repeat, other inline flags, a back-reference (each atomic
 * group adds a group before it), \Q...\E and the escapes the two do not
 * share, a class inside a class or an intersection of classes.
 */
export const javaScriptForm: JavaScriptFormFunction = (
  source: string,
): JavaScriptPattern => {
  const refuse: (what: string) => never = (what: string): never => {
    throw new Error(
      `javaScriptForm does not write ${what} for JavaScript, in /${source}/.`,
    );
  };

  let flags: string = "";
  let index: number = 0;
  const leading: RegExpExecArray | null = LEADING_FLAGS.exec(source);

  if (leading) {
    for (const flag of leading[1]!) {
      if (!FLAGS_JAVASCRIPT_HAS.has(flag)) {
        refuse(`the inline flag "${flag}"`);
      }

      if (!flags.includes(flag)) {
        flags += flag;
      }
    }

    index = leading[0].length;
  }

  let written: string = "";
  let groups: number = 0;
  // For each group still open, the number of the group its atomic group became, or null.
  const open: Array<number | null> = [];
  let inClass: boolean = false;
  // Whether what was written last is a repeat, which a "+" after makes possessive.
  let afterRepeat: boolean = false;

  // An escape, from its "\": the same in JavaScript, or refused.
  const writeEscape: () => void = (): void => {
    const rest: string = source.slice(index + 1);
    const escaped: string = rest[0] ?? "";

    if (UNICODE_ESCAPE.test(rest)) {
      written += `\\${rest.slice(0, 5)}`;
      index += 6;
      return;
    }

    if (HEX_ESCAPE.test(rest)) {
      written += `\\${rest.slice(0, 3)}`;
      index += 4;
      return;
    }

    if (inClass && escaped === "b") {
      refuse('"\\b" in a class');
    }

    if (!SAME_ESCAPE_LETTERS.has(escaped) && !STANDS_FOR_ITSELF.test(escaped)) {
      refuse(
        GROUP_NUMBER.test(escaped) || escaped === "k"
          ? "a back-reference"
          : `the escape "\\${escaped}"`,
      );
    }

    written += `\\${escaped}`;
    index += 2;
  };

  while (index < source.length) {
    const char: string = source[index]!;

    if (char === "\\") {
      writeEscape();
      afterRepeat = false;
      continue;
    }

    if (inClass) {
      if (char === "[") {
        refuse("a class inside a class");
      }

      if (source.startsWith("&&", index)) {
        refuse("an intersection of classes");
      }

      if (char === "]") {
        inClass = false;
      }

      written += char;
      index++;
      continue;
    }

    if (char === "[") {
      inClass = true;
      written += char;
      index++;

      if (source[index] === "^") {
        written += "^";
        index++;
      }

      if (source[index] === "]") {
        // A "]" first in a Java class is one of its characters.
        written += "\\]";
        index++;
      }

      afterRepeat = false;
      continue;
    }

    if (char === "(") {
      afterRepeat = false;

      if (source.startsWith("(?>", index)) {
        groups++;
        open.push(groups);
        written += "(?=(";
        index += 3;
        continue;
      }

      if (source[index + 1] === "?") {
        const opening: string | undefined = sameGroupOpeningAt(
          source,
          index + 2,
        );

        if (opening !== undefined) {
          open.push(null);
          written += `(?${opening}`;
          index += 2 + opening.length;
          continue;
        }

        if (
          source[index + 2] === "<" &&
          IDENTIFIER_START.test(source[index + 3] ?? "")
        ) {
          // A named group, written alike in both, is numbered as any other.
          groups++;
          open.push(null);
          written += "(?<";
          index += 3;
          continue;
        }

        refuse("an inline flag or a group of another kind");
      }

      groups++;
      open.push(null);
      written += "(";
      index++;
      continue;
    }

    if (char === ")") {
      const atomic: number | null | undefined = open.pop();

      if (atomic === undefined) {
        refuse('a ")" that closes no group');
      }

      written += atomic === null ? ")" : `))\\${atomic}`;
      index++;
      afterRepeat = false;
      continue;
    }

    if (char === "+" && afterRepeat) {
      refuse("a possessive repeat");
    }

    if (char === "?" && afterRepeat) {
      // A lazy repeat: a "+" after it is no repeat of its own.
      written += char;
      index++;
      afterRepeat = false;
      continue;
    }

    if (char === "*" || char === "+" || char === "?") {
      written += char;
      index++;
      afterRepeat = true;
      continue;
    }

    const counted: RegExpExecArray | null = COUNTED_REPEAT.exec(
      source.slice(index),
    );

    if (char === "{" && counted) {
      written += counted[0];
      index += counted[0].length;
      afterRepeat = true;
      continue;
    }

    written += char;
    index++;
    afterRepeat = false;
  }

  if (inClass || open.length > 0) {
    refuse("a class or a group that is not closed");
  }

  return { source: written, flags };
};

export interface WordEdge {
  // What reads otherwise, as written: "\b", "\w", "\p{Alpha}", ".", or a letter.
  what: string;
  // Where it is in the pattern's source.
  index: number;
  // The look-around it is in, as it opens ("(?<!"), or null.
  lookAround: string | null;
  // How Android's regular expressions read it otherwise, and what to write.
  reason: string;
}

/*
 * What a finding of the walk below is about: a word's edge, which
 * differentWordEdges tells of, or a class or a "." anywhere else, which
 * differentReadings tells of.
 */
interface Reading extends WordEdge {
  kind: "edge" | "class";
}

interface OpenGroup {
  // The look-around it is, as it opens, or null.
  lookAround: string | null;
  // Whether (?i) held where it opened, which holds again once it closes.
  caseInsensitiveOutside: boolean;
  // Whether (?s) held where it opened, which holds again once it closes.
  dotAllOutside: boolean;
  // Whether a letter read case-insensitively in it was told of already.
  toldOfLetter: boolean;
}

const LOOK_AROUNDS: ReadonlyArray<string> = ["(?<=", "(?<!", "(?=", "(?!"];

// The shorthand classes ICU reads with every script's characters, and what to write for each.
const SHORTHAND_CLASSES: Readonly<Record<string, string>> = {
  w: "[A-Za-z0-9_]",
  W: "[^A-Za-z0-9_]",
  d: "[0-9]",
  D: "[^0-9]",
  s: "the spaces it means, written out",
  S: "the spaces it does not mean, written out",
};

/*
 * Java's POSIX classes, which the JVM reads as ASCII and ICU with Unicode's
 * letters, digits and spaces. With "Is" before it (\p{IsDigit}) a name is
 * Unicode's property, which both read alike.
 */
const POSIX_CLASS: RegExp =
  /^\\[pP]\{(?:Lower|Upper|Alpha|Digit|Alnum|Punct|Graph|Print|Blank|Cntrl|XDigit|Space)\}/;

// An inline flag, on to the end of its group ("(?i)") or for a group of its own ("(?i:").
const INLINE_FLAGS: RegExp = /^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/;
const ASCII_LETTER: RegExp = /^[A-Za-z]$/;
const OCTAL_ESCAPE: RegExp = /^\\0[0-7]{1,3}/;

const BOUNDARY_REASON: string =
  "is a word boundary, which Android's regular expressions draw between the letters of any script and past a combining mark or a zero-width space: write (?<![A-Za-z0-9_]) or (?![A-Za-z0-9_]) on the side of the word";
const POSIX_REASON: string =
  "in a look-around reads Unicode's letters, digits or spaces on Android, and ASCII alone in the tests: write the ASCII class out";
const CASE_REASON: string =
  'is read case-insensitively in a look-around, where Android\'s regular expressions also fold "ſ" and "K" (U+017F, U+212A) into s and k: turn (?i) on after the look-around';
const POSIX_CLASS_REASON: string =
  "reads Unicode's letters, digits or spaces on Android, and ASCII alone in the tests: write the class out, or Unicode's own (\\p{L}, \\p{Nd})";
const DOT_REASON: string =
  "reads a vertical tab and a form feed in the tests and not on Android, and U+0085, U+2028 and U+2029 on neither: turn (?s) on, as a line holds no line break, or write the class out";

/*
 * Every place a Java pattern reads text otherwise on a device than the JVM
 * and JavaScript read it, in one walk: its word edges, and its classes and
 * dots. Classes (a class inside a class too), escapes, quoted text, inline
 * flags and groups are read as Java reads them; a pattern Java would refuse
 * is read as far as it goes.
 */
const readingsOf: (source: string) => Array<Reading> = (
  source: string,
): Array<Reading> => {
  const found: Array<Reading> = [];
  const groups: Array<OpenGroup> = [];
  let caseInsensitive: boolean = false;
  let dotAll: boolean = false;
  let classDepth: number = 0;
  let index: number = 0;

  // The innermost look-around the walk is in.
  const lookAround: () => OpenGroup | undefined = (): OpenGroup | undefined => {
    for (let at: number = groups.length - 1; at >= 0; at--) {
      if (groups[at]!.lookAround !== null) {
        return groups[at];
      }
    }

    return undefined;
  };

  // A character that stands for itself: a letter in a look-around read case-insensitively is told of, once.
  const readCharacter: (character: string, at: number) => void = (
    character: string,
    at: number,
  ): void => {
    const around: OpenGroup | undefined = lookAround();

    if (
      around &&
      caseInsensitive &&
      !around.toldOfLetter &&
      ASCII_LETTER.test(character)
    ) {
      around.toldOfLetter = true;
      found.push({
        kind: "edge",
        what: character,
        index: at,
        lookAround: around.lookAround,
        reason: CASE_REASON,
      });
    }
  };

  // An escape, from its "\": told of when it reads otherwise, and passed.
  const readEscape: () => void = (): void => {
    const rest: string = source.slice(index);
    const escaped: string = rest[1] ?? "";
    const around: OpenGroup | undefined = lookAround();

    if (escaped === "Q") {
      // Quoted: every character up to \E stands for itself.
      const end: number = source.indexOf("\\E", index + 2);
      const stop: number = end === -1 ? source.length : end;

      for (let at: number = index + 2; at < stop; at++) {
        readCharacter(source[at]!, at);
      }

      index = end === -1 ? source.length : end + 2;
      return;
    }

    const shorthand: string | undefined = SHORTHAND_CLASSES[escaped];
    const posix: RegExpExecArray | null = POSIX_CLASS.exec(rest);

    if ((escaped === "b" || escaped === "B") && classDepth === 0) {
      found.push({
        kind: "edge",
        what: `\\${escaped}`,
        index,
        lookAround: around?.lookAround ?? null,
        reason: BOUNDARY_REASON,
      });
    } else if (shorthand !== undefined && around) {
      found.push({
        kind: "edge",
        what: `\\${escaped}`,
        index,
        lookAround: around.lookAround,
        reason: `in a look-around reads the letters, digits or spaces of every script on Android, and ASCII alone in the tests: write ${shorthand}`,
      });
    } else if (shorthand !== undefined) {
      found.push({
        kind: "class",
        what: `\\${escaped}`,
        index,
        lookAround: null,
        reason: `reads the letters, digits or spaces of every script on Android, and ASCII alone in the tests: write ${shorthand}`,
      });
    } else if (posix && around) {
      found.push({
        kind: "edge",
        what: posix[0],
        index,
        lookAround: around.lookAround,
        reason: POSIX_REASON,
      });
    } else if (posix) {
      found.push({
        kind: "class",
        what: posix[0],
        index,
        lookAround: null,
        reason: POSIX_CLASS_REASON,
      });
    }

    const octal: RegExpExecArray | null = OCTAL_ESCAPE.exec(rest);

    if (["p", "P", "x", "N"].includes(escaped) && rest[2] === "{") {
      const end: number = source.indexOf("}", index + 3);

      index = end === -1 ? source.length : end + 1;
    } else if (escaped === "p" || escaped === "P" || escaped === "c") {
      index += 3;
    } else if (escaped === "k" && rest[2] === "<") {
      const end: number = source.indexOf(">", index + 3);

      index = end === -1 ? source.length : end + 1;
    } else if (escaped === "u" && HEX_DIGITS.test(rest.slice(2, 6))) {
      index += 6;
    } else if (escaped === "x") {
      index += 4;
    } else if (octal) {
      index += octal[0].length;
    } else {
      // An escaped letter is a class or a control character; anything else stands for itself.
      if (!ASCII_LETTER.test(escaped)) {
        readCharacter(escaped, index + 1);
      }

      index += 2;
    }
  };

  // A "(": a look-around, an inline flag, or a group of another kind.
  const readOpening: () => void = (): void => {
    const opening: string | undefined = LOOK_AROUNDS.find(
      (start: string): boolean => {
        return source.startsWith(start, index);
      },
    );

    if (opening) {
      groups.push({
        lookAround: opening,
        caseInsensitiveOutside: caseInsensitive,
        dotAllOutside: dotAll,
        toldOfLetter: false,
      });
      index += opening.length;
      return;
    }

    const flags: RegExpExecArray | null = INLINE_FLAGS.exec(
      source.slice(index),
    );

    if (flags && (flags[1] || flags[2] !== undefined)) {
      // A flag turned on wins over the same one turned off in the same group.
      const turned: (flag: string, now: boolean) => boolean = (
        flag: string,
        now: boolean,
      ): boolean => {
        if (flags[1]!.includes(flag)) {
          return true;
        }

        return (flags[2] ?? "").includes(flag) ? false : now;
      };

      if (flags[3] === ":") {
        groups.push({
          lookAround: null,
          caseInsensitiveOutside: caseInsensitive,
          dotAllOutside: dotAll,
          toldOfLetter: false,
        });
      }

      // "(?i)" holds to the end of the group it is in, "(?i:" to the end of its own; so does "s".
      caseInsensitive = turned("i", caseInsensitive);
      dotAll = turned("s", dotAll);
      index += flags[0].length;
      return;
    }

    groups.push({
      lookAround: null,
      caseInsensitiveOutside: caseInsensitive,
      dotAllOutside: dotAll,
      toldOfLetter: false,
    });

    if (
      source.startsWith("(?<", index) &&
      IDENTIFIER_START.test(source[index + 3] ?? "")
    ) {
      // A named group: its name is no text it matches.
      const end: number = source.indexOf(">", index + 3);

      index = end === -1 ? source.length : end + 1;
      return;
    }

    index += source[index + 1] === "?" ? 2 : 1;
  };

  while (index < source.length) {
    const char: string = source[index]!;

    if (char === "\\") {
      readEscape();
      continue;
    }

    if (classDepth > 0) {
      if (char === "[") {
        classDepth++;
      } else if (char === "]") {
        classDepth--;
      } else {
        readCharacter(char, index);
      }

      index++;
      continue;
    }

    if (char === "[") {
      classDepth = 1;
      index++;

      // A "]" first in a Java class, after its "^" or not, is one of its characters.
      if (source[index] === "^") {
        index++;
      }

      if (source[index] === "]") {
        index++;
      }

      continue;
    }

    if (char === "(") {
      readOpening();
      continue;
    }

    if (char === ")") {
      const closed: OpenGroup | undefined = groups.pop();

      if (closed) {
        caseInsensitive = closed.caseInsensitiveOutside;
        dotAll = closed.dotAllOutside;
      }

      index++;
      continue;
    }

    if (char === "." && !dotAll) {
      found.push({
        kind: "class",
        what: ".",
        index,
        lookAround: lookAround()?.lookAround ?? null,
        reason: DOT_REASON,
      });
    }

    readCharacter(char, index);
    index++;
  }

  return found;
};

// The findings of one kind, as WordEdge describes them.
const readingsOfKind: (
  source: string,
  kind: Reading["kind"],
) => Array<WordEdge> = (
  source: string,
  kind: Reading["kind"],
): Array<WordEdge> => {
  return readingsOf(source)
    .filter((reading: Reading): boolean => {
      return reading.kind === kind;
    })
    .map((reading: Reading): WordEdge => {
      return {
        what: reading.what,
        index: reading.index,
        lookAround: reading.lookAround,
        reason: reading.reason,
      };
    });
};

export type DifferentWordEdgesFunction = (source: string) => Array<WordEdge>;

/*
 * Where a Java pattern reads a word's edge otherwise on a device than the
 * JVM and JavaScript read it, which is in its look-arounds and its word
 * boundaries (#10835):
 *
 *   - \b and \B anywhere. ICU draws a word boundary between the letters of
 *     any script, and past a combining mark or a zero-width space;
 *   - \w, \d, \s, their negations and Java's POSIX classes (\p{Alpha}...)
 *     in a look-around. ICU reads them with the letters, marks, digits and
 *     spaces of every script, the JVM and JavaScript as ASCII;
 *   - an ASCII letter in a look-around read case-insensitively. Under (?i)
 *     ICU folds "ſ" and "K" (U+017F, U+212A) into s and k, so [A-Za-z]
 *     there holds them too: turn (?i) on after the look-around.
 */
export const differentWordEdges: DifferentWordEdgesFunction = (
  source: string,
): Array<WordEdge> => {
  return readingsOfKind(source, "edge");
};

/*
 * Where else a Java pattern reads text otherwise on a device than the JVM
 * reads it in the agent's unit tests (#10876):
 *
 *   - \w, \d, \s, their negations and Java's POSIX classes outside a
 *     look-around, in a class or not. A device's \s took Chinese and
 *     Japanese text's own space (U+3000) and a no-break space where the
 *     tests' did not, and its \w a Java class name's Cyrillic letters, so
 *     a crash named in them was parsed on a device alone;
 *   - a "." outside a class, unless (?s) holds there. ICU's takes no
 *     vertical tab and no form feed where the JVM's takes both, and
 *     neither takes U+0085, U+2028 or U+2029, which an app's log line or an
 *     exception's message may hold, and the line was dropped. Under (?s) a
 *     "." takes any character on both, and a line holds no line break.
 *
 * Unicode's own classes (\p{L}, \p{Nd}, \p{sc=Latin}) read alike on both.
 * A letter read case-insensitively outside a look-around is not told of:
 * ICU folds "ſ" and "K" into a credential's or a secret's name there too,
 * which takes more out on a device, never less.
 */
export const differentReadings: DifferentWordEdgesFunction = (
  source: string,
): Array<WordEdge> => {
  return readingsOfKind(source, "class");
};
