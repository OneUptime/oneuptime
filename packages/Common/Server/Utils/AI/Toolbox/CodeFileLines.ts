import {
  findPrivateKeyBlocks,
  PrivateKeyBlockSpan,
} from "../../../../Utils/PrivateKeyBlocks";

/*
 * A FILE'S LINES AS read_code_file SHOWS THEM, for the tool and for what
 * reads its answer back (CodeFileValuesRestored, issue #6388): one rule for
 * where a line ends, how each is numbered, and which runs of lines a read
 * shows only whole.
 */

// A file's lines, split at each newline: none after a last one, none for an empty file.
export function splitCodeFileLines(content: string): Array<string> {
  if (content === "") {
    return [];
  }

  const lines: Array<string> = content.split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

// How long each line's "NNN| " is, for lines startLine to lastLine: the last line's number, padded, and "| ".
export function getCodeLinePrefixLength(lastLine: number): number {
  return String(lastLine).length + 2;
}

// Each line with its real line number before it, "NNN| ", so the model can cite lines.
export function formatCodeLinesWithNumbers(data: {
  lines: ReadonlyArray<string>;
  startLine: number;
}): string {
  const width: number = String(data.startLine + data.lines.length - 1).length;

  return data.lines
    .map((line: string, index: number): string => {
      const lineNumber: string = String(data.startLine + index).padStart(
        width,
        " ",
      );
      return `${lineNumber}| ${line}`;
    })
    .join("\n");
}

// A run of a file's lines, numbered from 1.
export interface CodeLineRun {
  first: number;
  last: number;
}

/*
 * The runs of lines a private key block takes in a file, as the redaction
 * finds them (PrivateKeyBlocks): from its header's line to its footer's.
 * A read that showed part of one would show what it holds of the key - no
 * footer in its window, nothing to hide - so a read shows a block whole,
 * or not at all (issue #6388).
 */
export function findCodePrivateKeyBlockLines(
  content: string,
): Array<CodeLineRun> {
  const blocks: Array<PrivateKeyBlockSpan> = findPrivateKeyBlocks(content);

  if (blocks.length === 0) {
    return [];
  }

  const runs: Array<CodeLineRun> = [];
  let line: number = 1;
  // Where the next newline is looked for: every one before it is counted.
  let counted: number = 0;

  // The line a character is on - one more than the newlines before it - read once, in order.
  const lineAt: (offset: number) => number = (offset: number): number => {
    let newline: number = content.indexOf("\n", counted);

    while (newline !== -1 && newline < offset) {
      line++;
      counted = newline + 1;
      newline = content.indexOf("\n", counted);
    }

    return line;
  };

  for (const block of blocks) {
    const first: number = lineAt(block.start);
    // The footer's last character: the block ends just after it.
    const last: number = lineAt(Math.max(block.start, block.end - 1));

    runs.push({ first, last });
  }

  return runs;
}

/*
 * A window of lines, first to last, widened so it cuts no run of `runs`:
 * a run it starts inside starts it, and a run it ends inside ends it.
 */
export function widenCodeLinesToWholeRuns(data: {
  first: number;
  last: number;
  runs: ReadonlyArray<CodeLineRun>;
}): CodeLineRun {
  let first: number = data.first;
  let last: number = data.last;

  for (const run of data.runs) {
    if (run.first < first && first <= run.last) {
      first = run.first;
    }

    if (run.first <= last && last < run.last) {
      last = run.last;
    }
  }

  return { first, last };
}
