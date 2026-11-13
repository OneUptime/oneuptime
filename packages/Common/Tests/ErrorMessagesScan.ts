import fs from "fs";
import path from "path";

/*
 * Every error message the product's code throws (ErrorMessagesGuard, #6836):
 * the text of each `new <Something>Exception("...")` whose message is
 * written where it is thrown - a string, or a template whose values read
 * `${value}`. A message built some other way (a variable, a call, two
 * strings joined with +) is left out: there is no text to read.
 *
 * Read with a small scanner rather than the TypeScript compiler: it walks
 * about eight thousand files, and needs only the literal after the bracket.
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
);

// The product's code: every package, and ee/ when the checkout has it.
export const SCAN_ROOTS: ReadonlyArray<string> = ["packages", "ee"];

// Folders that hold no product code a person meets.
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "dist",
  "build",
  "Tests",
  "__tests__",
  "__mocks__",
  ".git",
  ".expo",
  "dist-ui",
  "coverage",
  // Migrations speak to whoever runs them, in a log.
  "SchemaMigrations",
  "DataMigrations",
  // Scripts a developer runs.
  "Scripts",
]);

// Packages that are not the product a person uses.
const SKIPPED_PACKAGES: ReadonlySet<string> = new Set<string>([
  "packages/E2E",
  "packages/TestServer",
]);

export interface ThrownMessage {
  // Relative to the repository root, with forward slashes.
  file: string;
  // 1-based.
  line: number;
  exception: string;
  // The message, with every template value written `${value}`.
  message: string;
}

/*
 * The scan's patterns are named, so a call reads NAME.test(text): a
 * literal called on directly needs parens for wrap-regex, which Prettier
 * takes away again.
 */
const TEST_FILE_NAME: RegExp = /\.(test|spec)\.tsx?$/;

// One character of white space.
const WHITE_SPACE: RegExp = /\s/;

const isTestFile: (name: string) => boolean = (name: string): boolean => {
  return TEST_FILE_NAME.test(name) || name.endsWith(".d.ts");
};

export const listScanFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];

  const walk: (relative: string) => void = (relative: string): void => {
    if (SKIPPED_PACKAGES.has(relative)) {
      return;
    }

    const absolute: string = path.join(REPOSITORY_ROOT, relative);

    let entries: Array<fs.Dirent> = [];

    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const child: string = `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          walk(child);
        }
        continue;
      }

      if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !isTestFile(entry.name)
      ) {
        files.push(child);
      }
    }
  };

  for (const root of SCAN_ROOTS) {
    walk(root);
  }

  return files.sort();
};

// Where the literal that starts at `start` ends, and what it says.
interface Literal {
  text: string;
  end: number;
}

const readQuoted: (source: string, start: number) => Literal | null = (
  source: string,
  start: number,
): Literal | null => {
  const quote: string = source[start] as string;
  let text: string = "";
  let index: number = start + 1;

  while (index < source.length) {
    const character: string = source[index] as string;

    if (character === "\\") {
      const next: string = source[index + 1] || "";
      text += next === "n" ? "\n" : next;
      index += 2;
      continue;
    }

    if (character === quote) {
      return { text, end: index + 1 };
    }

    if (character === "\n" && quote !== "`") {
      return null;
    }

    text += character;
    index++;
  }

  return null;
};

const readTemplate: (source: string, start: number) => Literal | null = (
  source: string,
  start: number,
): Literal | null => {
  let text: string = "";
  let index: number = start + 1;

  while (index < source.length) {
    const character: string = source[index] as string;

    if (character === "\\") {
      text += source[index + 1] || "";
      index += 2;
      continue;
    }

    if (character === "`") {
      return { text, end: index + 1 };
    }

    if (character === "$" && source[index + 1] === "{") {
      // Skip the value's expression, strings and nested templates included.
      let depth: number = 1;
      index += 2;

      while (index < source.length && depth > 0) {
        const inner: string = source[index] as string;

        if (inner === '"' || inner === "'") {
          const quoted: Literal | null = readQuoted(source, index);
          index = quoted ? quoted.end : index + 1;
          continue;
        }

        if (inner === "`") {
          const nested: Literal | null = readTemplate(source, index);
          index = nested ? nested.end : index + 1;
          continue;
        }

        if (inner === "{") {
          depth++;
        } else if (inner === "}") {
          depth--;
        }

        index++;
      }

      text += "${value}";
      continue;
    }

    text += character;
    index++;
  }

  return null;
};

const NEW_EXCEPTION: RegExp = /new\s+([A-Z][A-Za-z0-9_]*Exception)\s*\(/g;

// A code for a program, not words: "invalid_request", "not-found".
const CODE: RegExp = /^[a-z0-9]+(?:[_.-][a-z0-9]+)+$/;

// The string or template that starts at `index`, if one does.
const readLiteralAt: (source: string, index: number) => Literal | null = (
  source: string,
  index: number,
): Literal | null => {
  const opening: string = source[index] || "";

  if (opening === "`") {
    return readTemplate(source, index);
  }

  if (opening === '"' || opening === "'") {
    return readQuoted(source, index);
  }

  return null;
};

// Whether `index` is on a line that is a comment.
const isInComment: (source: string, index: number) => boolean = (
  source: string,
  index: number,
): boolean => {
  const lineStart: number = source.lastIndexOf("\n", index) + 1;
  const before: string = source.substring(lineStart, index).trim();

  return (
    before.startsWith("//") || before.startsWith("*") || before.startsWith("/*")
  );
};

const lineOf: (source: string, index: number) => number = (
  source: string,
  index: number,
): number => {
  let line: number = 1;

  for (let i: number = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
    }
  }

  return line;
};

// The messages one file's source throws.
export const findThrownMessages: (
  file: string,
  source: string,
) => Array<ThrownMessage> = (
  file: string,
  source: string,
): Array<ThrownMessage> => {
  const found: Array<ThrownMessage> = [];

  NEW_EXCEPTION.lastIndex = 0;

  let match: RegExpExecArray | null = NEW_EXCEPTION.exec(source);

  while (match) {
    const exception: string = match[1] as string;
    let index: number = match.index + match[0].length;

    if (!isInComment(source, match.index)) {
      while (
        index < source.length &&
        WHITE_SPACE.test(source[index] as string)
      ) {
        index++;
      }

      let literal: Literal | null = readLiteralAt(source, index);

      /*
       * A code before the message - new SomeRefusedException("invalid_request",
       * "A resource command needs a resource type.") - is for a program: the
       * message is the argument after it.
       */
      if (literal && CODE.test(literal.text)) {
        let next: number = literal.end;

        while (
          next < source.length &&
          WHITE_SPACE.test(source[next] as string)
        ) {
          next++;
        }

        if (source[next] === ",") {
          next++;

          while (
            next < source.length &&
            WHITE_SPACE.test(source[next] as string)
          ) {
            next++;
          }

          literal = readLiteralAt(source, next);
        } else {
          literal = null;
        }

        if (literal && CODE.test(literal.text)) {
          literal = null;
        }
      }

      if (literal) {
        let after: number = literal.end;

        while (
          after < source.length &&
          WHITE_SPACE.test(source[after] as string)
        ) {
          after++;
        }

        // Only a message that is the literal alone.
        if (source[after] === ")" || source[after] === ",") {
          found.push({
            file: file,
            line: lineOf(source, match.index),
            exception: exception,
            message: literal.text,
          });
        }
      }
    }

    match = NEW_EXCEPTION.exec(source);
  }

  return found;
};

export const scanThrownMessages: (
  files?: Array<string>,
) => Array<ThrownMessage> = (files?: Array<string>): Array<ThrownMessage> => {
  const messages: Array<ThrownMessage> = [];

  for (const file of files || listScanFiles()) {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );

    if (source.indexOf("Exception") === -1) {
      continue;
    }

    messages.push(...findThrownMessages(file, source));
  }

  return messages;
};

/*
 * Every string literal in a file that starts with a capital letter - what
 * a person could be shown - for the files that are the last resort.
 */
export const findCapitalisedStringLiterals: (
  source: string,
) => Array<{ line: number; text: string }> = (
  source: string,
): Array<{ line: number; text: string }> => {
  const found: Array<{ line: number; text: string }> = [];
  let index: number = 0;

  while (index < source.length) {
    const character: string = source[index] as string;

    // Skip comments.
    if (character === "/" && source[index + 1] === "/") {
      const end: number = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }

    if (character === "/" && source[index + 1] === "*") {
      const end: number = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      const literal: Literal | null =
        character === "`"
          ? readTemplate(source, index)
          : readQuoted(source, index);

      if (!literal) {
        index++;
        continue;
      }

      const first: string = literal.text.charAt(0);

      if (first && first !== first.toLowerCase()) {
        found.push({ line: lineOf(source, index), text: literal.text });
      }

      index = literal.end;
      continue;
    }

    index++;
  }

  return found;
};
