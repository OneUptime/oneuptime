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
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface KotlinStringLiteral {
  // The string's text, its escapes decoded; a template's code as written.
  value: string;
  // The line it starts on, from 1.
  line: number;
  // Whether it holds a template ($name or ${...}), whose text is the code's.
  hasTemplate: boolean;
}

const IDENTIFIER_START: RegExp = /[A-Za-z_]/;
const IDENTIFIER_PART: RegExp = /[A-Za-z0-9_]/;
const HEX_DIGITS: RegExp = /^[0-9A-Fa-f]{4}$/;

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
 * holds one; a literal a template holds is not read on its own.
 */
export const kotlinStringLiterals: KotlinStringLiteralsFunction = (
  text: string,
): Array<KotlinStringLiteral> => {
  const found: Array<KotlinStringLiteral> = [];
  let index: number = 0;
  let line: number = 1;

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
      continue;
    }

    if (text.startsWith("//", index)) {
      while (index < text.length && text[index] !== "\n") {
        index++;
      }
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
      continue;
    }

    // A character literal: '"' holds a quote that opens no string.
    if (char === "'") {
      index++;

      while (index < text.length && text[index] !== "'") {
        index += text[index] === "\\" ? 2 : 1;
      }

      index++;
      continue;
    }

    // A name in backticks, which may hold a quote too.
    if (char === "`") {
      const end: number = text.indexOf("`", index + 1);

      index = end === -1 ? text.length : end + 1;
      continue;
    }

    if (char !== '"') {
      index++;
      continue;
    }

    const startLine: number = line;
    const raw: boolean = text.startsWith('"""', index);
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

    found.push({ value, line: startLine, hasTemplate });
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
