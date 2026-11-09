/*
 * Text as numbered lines, the way the code agent's tools show it: a file
 * read with read_file, a long tool output read with read_tool_output, the
 * lines an edit changed. Each line starts with its number and a tab, as
 * `cat -n` prints it, so the model can say where it is and read on from
 * there; the number is never part of the text.
 */

/*
 * The lines of a text: a final newline ends the last line rather than
 * starting an empty one, and a carriage return before a newline (a file
 * with Windows line endings) is not shown.
 */
export function splitTextLines(content: string): Array<string> {
  if (content.length === 0) {
    return [];
  }

  const lines: Array<string> = content.split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.map((line: string): string => {
    return line.endsWith("\r") ? line.substring(0, line.length - 1) : line;
  });
}

// The number in front of a line: right-aligned in six places, then a tab.
export function lineNumberPrefix(lineNumber: number): string {
  return `${String(lineNumber).padStart(6, " ")}\t`;
}

export interface NumberedWindow {
  // The lines, each with its number in front, each ending in a newline.
  text: string;
  /*
   * The last line the window shows: the end asked for, or an earlier line
   * where the window reached its characters.
   */
  lastLine: number;
  // How many lines were cut because they were longer than a line may be.
  cutLines: number;
  // Whether the window stopped at its characters before the end asked for.
  stoppedAtCharLimit: boolean;
}

/*
 * Lines `startLine` to `endLine` (1-based, both shown) as numbered lines,
 * at most `maxChars` characters of them - always at least the first line -
 * with each line cut at `maxLineChars`, saying so.
 */
export function formatNumberedWindow(data: {
  lines: ReadonlyArray<string>;
  startLine: number;
  endLine: number;
  maxChars: number;
  maxLineChars: number;
}): NumberedWindow {
  let text: string = "";
  let lastLine: number = data.startLine - 1;
  let cutLines: number = 0;
  let stoppedAtCharLimit: boolean = false;

  const endLine: number = Math.min(data.endLine, data.lines.length);

  for (
    let lineNumber: number = data.startLine;
    lineNumber <= endLine;
    lineNumber++
  ) {
    let line: string = data.lines[lineNumber - 1] ?? "";

    if (line.length > data.maxLineChars) {
      const more: string = (line.length - data.maxLineChars).toLocaleString(
        "en-US",
      );
      /*
       * A line given the whole window (one read alone) shows all any read
       * shows: no read shows more of it. (A search shows no more of it
       * either: a match on a long line is cut too.)
       */
      line =
        data.maxLineChars >= data.maxChars
          ? `${line.substring(0, data.maxLineChars)} [... ${more} more characters on this line, more than one read shows]`
          : `${line.substring(0, data.maxLineChars)} [... ${more} more characters on this line; read this line alone (start_line and end_line ${lineNumber}) to see more of it]`;
      cutLines++;
    }

    const entry: string = `${lineNumberPrefix(lineNumber)}${line}\n`;

    if (
      lineNumber > data.startLine &&
      text.length + entry.length > data.maxChars
    ) {
      stoppedAtCharLimit = true;
      break;
    }

    text += entry;
    lastLine = lineNumber;
  }

  return { text, lastLine, cutLines, stoppedAtCharLimit };
}

/*
 * The 1-based line a character offset of a text is on: one more than the
 * newlines before it.
 */
export function lineNumberAtOffset(content: string, offset: number): number {
  let lineNumber: number = 1;
  let index: number = content.indexOf("\n");

  while (index !== -1 && index < offset) {
    lineNumber++;
    index = content.indexOf("\n", index + 1);
  }

  return lineNumber;
}
