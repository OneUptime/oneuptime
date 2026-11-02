import { Command } from "commander";

/*
 * The `oneuptime` commands a Markdown page shows, read as a shell runs
 * them, and the program's commands they name. For the suites that hold a
 * page's examples to the real program: the README npm shows
 * (ReadmeResources) and the coding agent plugin's CLI skill
 * (CodingAgentSkill).
 */

export interface ShownCommand {
  line: string;
  // The words after `oneuptime`, to the end of the command.
  words: Array<string>;
}

const FENCE: string = "```";
// A line that goes on, in a shell, on the next one.
const CONTINUED_LINE: RegExp = /\\\n/g;
const CODE_SPAN: RegExp = /`([^`]+)`/g;
/*
 * A word of a command line: a run of plain characters, a quoted run, or
 * what ends a command (a pipe, a semicolon, the end of a $(...)). A quoted
 * run has no quote of its kind inside, so each is read once. The ( of a
 * $( starts no word: OPEN=$(oneuptime ...) is OPEN=$, then the command.
 */
const SHELL_WORD: RegExp = /'[^']*'|"[^"]*"|[^\s'"|;()]+|[|;)]/g;
const COMMAND_ENDS: ReadonlyArray<string> = ["|", ";", ")"];
const CLI: string = "oneuptime";

export interface CodeBlock {
  // What its opening fence names first: bash, yaml, json.
  language: string;
  body: string;
}

/*
 * A page's fenced code blocks, and its lines outside them, read a line at a
 * time: an opening fence names a language (```bash, or ```json tool_name),
 * and a line of three backticks closes it.
 */
function readBlocks(markdown: string): {
  blocks: Array<CodeBlock>;
  prose: Array<string>;
} {
  const blocks: Array<CodeBlock> = [];
  const prose: Array<string> = [];
  let open: { language: string; lines: Array<string> } | null = null;

  for (const line of markdown.split("\n")) {
    if (open) {
      if (line.trim() === FENCE) {
        blocks.push({ language: open.language, body: open.lines.join("\n") });
        open = null;
      } else {
        open.lines.push(line);
      }
      continue;
    }

    if (line.trimStart().startsWith(FENCE)) {
      const info: string = line.trimStart().slice(FENCE.length);

      open = { language: info.split(" ")[0] || "", lines: [] };
      continue;
    }

    prose.push(line);
  }

  return { blocks, prose };
}

export function codeBlocksIn(markdown: string): Array<CodeBlock> {
  return readBlocks(markdown).blocks;
}

// The words of a command line as a shell splits them, quotes taken off.
export function shellWords(line: string): Array<string> {
  return (line.match(SHELL_WORD) || []).map((word: string): string => {
    const quoted: boolean =
      word.length > 1 &&
      (word.startsWith("'") || word.startsWith('"')) &&
      word.endsWith(word[0] as string);

    return quoted ? word.slice(1, -1) : word;
  });
}

// The command a line runs, from its `oneuptime` word to its end; or null.
function commandOf(line: string): ShownCommand | null {
  // A comment, in a shell or in YAML.
  if (line.startsWith("#")) {
    return null;
  }

  const words: Array<string> = shellWords(line);
  const start: number = words.indexOf(CLI);

  if (start === -1) {
    return null;
  }

  const rest: Array<string> = words.slice(start + 1);
  const end: number = rest.findIndex((word: string): boolean => {
    return COMMAND_ENDS.includes(word);
  });

  return { line, words: end === -1 ? rest : rest.slice(0, end) };
}

/*
 * Every `oneuptime ...` command of a page's code blocks in the languages
 * given: a shell's, or the run: lines of a YAML pipeline.
 */
export function shownCommandsIn(
  markdown: string,
  languages: ReadonlyArray<string>,
): Array<ShownCommand> {
  const commands: Array<ShownCommand> = [];

  for (const block of codeBlocksIn(markdown)) {
    if (!languages.includes(block.language)) {
      continue;
    }

    const body: string = block.body.replace(CONTINUED_LINE, " ");

    for (const line of body.split("\n")) {
      const command: ShownCommand | null = commandOf(line.trim());

      if (command) {
        commands.push(command);
      }
    }
  }

  return commands;
}

/*
 * The whole commands a page's text writes in code spans, outside its code
 * blocks: `oneuptime whoami --check`. A span with a placeholder in it,
 * `oneuptime <resource> --help`, stands for many commands and is left out.
 */
export function spanCommandsIn(markdown: string): Array<ShownCommand> {
  const prose: string = readBlocks(markdown).prose.join("\n");

  return Array.from(prose.matchAll(CODE_SPAN))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .filter((span: string): boolean => {
      return span.startsWith(`${CLI} `) && !span.includes("<");
    })
    .map((span: string): ShownCommand => {
      return commandOf(span) as ShownCommand;
    });
}

// The command a command line runs: its words that name commands, in turn.
export function commandPathOf(
  program: Command,
  words: Array<string>,
): Array<string> {
  const found: Array<string> = [];
  let command: Command = program;

  for (const word of words) {
    const child: Command | undefined = command.commands.find(
      (candidate: Command): boolean => {
        return candidate.name() === word;
      },
    );

    if (!child) {
      break;
    }

    found.push(word);
    command = child;
  }

  return found;
}

// The command at a path of command names.
export function commandAt(
  program: Command,
  commandPath: Array<string>,
): Command {
  let command: Command = program;

  for (const name of commandPath) {
    command = command.commands.find((child: Command): boolean => {
      return child.name() === name;
    }) as Command;
  }

  return command;
}

/*
 * The flags a help lists: each option line's flags, before its
 * description ("  -o, --output <format>  Output format" -> -o, --output).
 */
export function helpFlags(help: string): Array<string> {
  const flags: Array<string> = [];

  for (const line of help.split("\n")) {
    const option: string = line.trim();

    if (!option.startsWith("-")) {
      continue;
    }

    const spec: string = option.split("  ")[0] || "";

    for (const part of spec.split(", ")) {
      flags.push(part.split(" ")[0] || "");
    }
  }

  return flags;
}
