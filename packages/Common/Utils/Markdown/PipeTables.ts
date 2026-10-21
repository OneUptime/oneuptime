/*
 * PIPE TABLES AS THE CHAT CONVERTERS READ THEM.
 *
 * Slack and a Microsoft Teams incoming webhook show no Markdown tables:
 * their converters find each table in a message and write it out in a form
 * the chat shows - Slack as label and value lines, Teams as HTML. They
 * found tables with one regular expression,
 *
 *   /(?:^|\n)((?:\|[^\n]+\|\n)+(?:\|[-:\s|]+\|\n)(?:\|[^\n]+\|\n?)+)/g
 *
 * whose header part takes every line that starts and ends with "|", and
 * gives them back one at a time looking for a delimiter row: on a few
 * thousand such lines with no delimiter row - a log written as a table -
 * that took time growing with the square of the lines. This reads the same
 * tables in one pass over the lines, and replaces them exactly as that
 * expression did.
 *
 * What it reads as a table: a run of consecutive "pipe rows" - lines of at
 * least three characters that start and end with "|" - of which a line
 * other than the first and the last is a delimiter row ("|", then only "-",
 * ":", whitespace and "|", then "|"). The table is the whole run: the
 * expression's header part took as many rows as it could, and its row part
 * took the rest. The format function is given the run's lines.
 *
 * Pure, and no regular expression runs over the text.
 */

// The lines of a table, as the format function is given them.
export type FormatPipeTableFunction = (lines: Array<string>) => string;

const PIPE: number = 0x7c;

// A line of at least three characters that starts and ends with "|".
const isPipeRow: (line: string) => boolean = (line: string): boolean => {
  return (
    line.length >= 3 &&
    line.charCodeAt(0) === PIPE &&
    line.charCodeAt(line.length - 1) === PIPE
  );
};

// What "\s" matches in a regular expression, for one UTF-16 code unit.
const isRegExpWhitespace: (code: number) => boolean = (
  code: number,
): boolean => {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
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

// A pipe row whose inside is only "-", ":", whitespace and "|".
const isDelimiterRow: (line: string) => boolean = (line: string): boolean => {
  if (!isPipeRow(line)) {
    return false;
  }

  for (let index: number = 1; index < line.length - 1; index++) {
    const code: number = line.charCodeAt(index);

    if (
      code !== 0x2d &&
      code !== 0x3a &&
      code !== PIPE &&
      !isRegExpWhitespace(code)
    ) {
      return false;
    }
  }

  return true;
};

/*
 * `markdown` with every pipe table (see the top of this file) replaced by
 * what `format` makes of its lines - with the line breaks around it the
 * regular expression above left: a table at the very start of the text is
 * preceded by a line break, and one at its very end followed by one.
 */
export const replacePipeTables: (
  markdown: string,
  format: FormatPipeTableFunction,
) => string = (markdown: string, format: FormatPipeTableFunction): string => {
  if (typeof markdown !== "string" || markdown.indexOf("|") === -1) {
    return markdown;
  }

  const lines: Array<string> = markdown.split("\n");
  const output: Array<string> = [];
  let index: number = 0;

  while (index < lines.length) {
    if (!isPipeRow(lines[index]!)) {
      output.push(lines[index]!);
      index++;
      continue;
    }

    let runEnd: number = index + 1;

    while (runEnd < lines.length && isPipeRow(lines[runEnd]!)) {
      runEnd++;
    }

    let hasDelimiterRow: boolean = false;

    for (let row: number = index + 1; row < runEnd - 1; row++) {
      if (isDelimiterRow(lines[row]!)) {
        hasDelimiterRow = true;
        break;
      }
    }

    if (!hasDelimiterRow) {
      for (let row: number = index; row < runEnd; row++) {
        output.push(lines[row]!);
      }

      index = runEnd;
      continue;
    }

    let formatted: string = format(lines.slice(index, runEnd));

    // The line break the expression took before a table at the start.
    if (index === 0) {
      formatted = "\n" + formatted;
    }

    // The line break it added after a table at the end.
    if (runEnd === lines.length) {
      formatted = formatted + "\n";
    }

    output.push(formatted);
    index = runEnd;
  }

  return output.join("\n");
};
