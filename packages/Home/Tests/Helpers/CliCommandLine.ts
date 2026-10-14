/*
 * The words of a command on the CLI page, as a POSIX shell splits them: for
 * the tests that hold the page's commands to the CLI (Tests/CliPage.test.ts
 * here, and packages/CLI/Tests/HomeCliPage.test.ts, which imports this file,
 * so it imports nothing).
 *
 * Only what the page writes is read: words, single and double quotes, a
 * backslash before a character or at the end of a line, and pipes. Anything
 * else a shell would act on - $, `, ;, &, (, ), a redirection - is refused,
 * so a command the page starts writing with it fails here instead of being
 * read wrong. A placeholder such as <api-key> is a word: the page writes it
 * as the docs do, for a value to fill in, not as a redirection.
 */

// One command of a pipeline, as its words.
export type ShellWords = Array<string>;

// What is left to read of a placeholder after its "<": "api-key>".
const PLACEHOLDER_REST: RegExp = /^[a-z0-9-]+>/;
// A word that is a placeholder and nothing else: "<api-key>".
const PLACEHOLDER_WORD: RegExp = /^<[a-z0-9-]+>$/;
const BLANK: RegExp = /\s/;
// Characters a shell acts on outside quotes, which the page never writes.
const REFUSED_OUTSIDE_QUOTES: ReadonlyArray<string> = [
  "$",
  "`",
  ";",
  "&",
  "(",
  ")",
  ">",
];
// Inside double quotes a backslash escapes only these.
const ESCAPED_IN_DOUBLE_QUOTES: ReadonlyArray<string> = ['"', "\\", "$", "`"];

/*
 * A command typed over several lines, as one text: each line but the last
 * ends in " \", which the shell reads as going on with the next line.
 */
export const commandText: (lines: ReadonlyArray<string>) => string = (
  lines: ReadonlyArray<string>,
): string => {
  return lines.join("\n");
};

// The commands of a pipeline, each as its words.
export const readPipeline: (text: string) => Array<ShellWords> = (
  text: string,
): Array<ShellWords> => {
  const commands: Array<ShellWords> = [[]];
  let word: string = "";
  // A word has started, even if it is still empty: '' is a word.
  let inWord: boolean = false;
  let index: number = 0;

  const current: () => ShellWords = (): ShellWords => {
    return commands[commands.length - 1] as ShellWords;
  };

  const endWord: () => void = (): void => {
    if (inWord) {
      current().push(word);
    }

    word = "";
    inWord = false;
  };

  while (index < text.length) {
    const character: string = text[index] as string;

    if (character === "'") {
      const end: number = text.indexOf("'", index + 1);

      if (end === -1) {
        throw new Error(`An unclosed single quote in: ${text}`);
      }

      word += text.slice(index + 1, end);
      inWord = true;
      index = end + 1;
      continue;
    }

    if (character === '"') {
      index += 1;
      inWord = true;

      while (index < text.length && text[index] !== '"') {
        const inner: string = text[index] as string;

        if (inner === "$" || inner === "`") {
          throw new Error(`Shell expansion in double quotes in: ${text}`);
        }

        if (
          inner === "\\" &&
          ESCAPED_IN_DOUBLE_QUOTES.includes(text[index + 1] as string)
        ) {
          word += text[index + 1];
          index += 2;
          continue;
        }

        word += inner;
        index += 1;
      }

      if (index >= text.length) {
        throw new Error(`An unclosed double quote in: ${text}`);
      }

      index += 1;
      continue;
    }

    if (character === "\\") {
      const next: string | undefined = text[index + 1];

      if (next === undefined) {
        throw new Error(`A backslash at the very end of: ${text}`);
      }

      // A backslash before a line break joins the two lines.
      if (next !== "\n") {
        word += next;
        inWord = true;
      }

      index += 2;
      continue;
    }

    if (BLANK.test(character)) {
      endWord();
      index += 1;
      continue;
    }

    if (character === "|") {
      endWord();

      if (current().length === 0) {
        throw new Error(`A pipe with no command before it in: ${text}`);
      }

      commands.push([]);
      index += 1;
      continue;
    }

    if (character === "<") {
      const placeholder: RegExpMatchArray | null = text
        .slice(index + 1)
        .match(PLACEHOLDER_REST);

      if (!placeholder) {
        throw new Error(`A redirection in: ${text}`);
      }

      word += `<${placeholder[0]}`;
      inWord = true;
      index += 1 + placeholder[0].length;
      continue;
    }

    if (REFUSED_OUTSIDE_QUOTES.includes(character)) {
      throw new Error(
        `Shell syntax the page does not write ("${character}") in: ${text}`,
      );
    }

    word += character;
    inWord = true;
    index += 1;
  }

  endWord();

  if (current().length === 0) {
    throw new Error(`A command line with no command at its end: ${text}`);
  }

  return commands;
};

// Whether a word is a placeholder to fill in, such as <api-key>.
export const isPlaceholder: (word: string) => boolean = (
  word: string,
): boolean => {
  return PLACEHOLDER_WORD.test(word);
};
