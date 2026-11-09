import { JSONObject } from "Common/Types/JSON";
import {
  countOf,
  readIntegerArgument,
  readStringArgument,
  ToolExecution,
} from "./CodeAgentToolTypes";
import {
  READ_FILE_MAX_LINE_CHARS,
  READ_FILE_MAX_WINDOW_CHARS,
  TOOL_OUTPUT_HEAD_CHARS,
  TOOL_OUTPUT_INLINE_CHARS,
  TOOL_OUTPUT_MAX_PATTERN_MATCHES,
  TOOL_OUTPUT_PAGE_LINES,
  TOOL_OUTPUT_STORE_MAX_CHARS,
  TOOL_OUTPUT_TAIL_CHARS,
} from "./CodeAgentToolLimits";
import {
  formatNumberedWindow,
  lineNumberPrefix,
  NumberedWindow,
  splitTextLines,
} from "./TextLines";

export const READ_TOOL_OUTPUT_TOOL_NAME: string = "read_tool_output";

// One long tool output, kept for the task.
interface StoredToolOutput {
  id: string;
  // What made it: "run_command npm test", "search_files TODO".
  label: string;
  lines: Array<string>;
  chars: number;
}

/*
 * How a long output is shown: its start and its end (a command's - the
 * failures and the summary are at its end), or its start (a search, a
 * listing: the rest reads on in order).
 */
export enum LongOutputShape {
  StartAndEnd = "StartAndEnd",
  Start = "Start",
}

/*
 * The long tool outputs of one task, kept on the Runner so the model can
 * read the part it was not shown (issue #6441): a test run's middle, the
 * rest of a big search. The model is shown a part, with the output's id;
 * read_tool_output reads any lines of it, or the lines that hold a text.
 *
 * Bounded: past TOOL_OUTPUT_STORE_MAX_CHARS the oldest outputs are let go,
 * and reading one of them says so (run the tool again).
 */
export default class ToolOutputStore {
  private readonly outputs: Map<string, StoredToolOutput> = new Map<
    string,
    StoredToolOutput
  >();
  private nextNumber: number = 1;
  private keptChars: number = 0;
  private readonly maxChars: number;

  public constructor(maxChars: number = TOOL_OUTPUT_STORE_MAX_CHARS) {
    this.maxChars = maxChars;
  }

  /*
   * What the model is shown of a tool's output: all of it when it is short,
   * or else a part of it, kept here, with what reads the rest.
   */
  public present(data: {
    label: string;
    text: string;
    shape: LongOutputShape;
  }): string {
    if (data.text.length <= TOOL_OUTPUT_INLINE_CHARS) {
      return data.text;
    }

    const stored: StoredToolOutput = this.keep(data.label, data.text);

    return data.shape === LongOutputShape.StartAndEnd
      ? this.presentStartAndEnd(stored)
      : this.presentStart(stored);
  }

  public has(id: string): boolean {
    return this.outputs.has(id);
  }

  // read_tool_output: lines of a kept output, or the lines that hold a text.
  public read(args: JSONObject): ToolExecution {
    const id: string = (
      readStringArgument(args, ["output_id", "outputId", "id"]) || ""
    ).trim();

    if (!id) {
      return {
        narration: `refused ${READ_TOOL_OUTPUT_TOOL_NAME}: no output_id given`,
        output:
          "Error: output_id is required: the id a shortened tool output gave, such as out-3.",
      };
    }

    const stored: StoredToolOutput | undefined = this.outputs.get(id);

    if (!stored) {
      return {
        narration: `${READ_TOOL_OUTPUT_TOOL_NAME} ${id} failed: no such output`,
        output: `Error: there is no kept output ${JSON.stringify(id)}. ${
          this.outputs.size > 0
            ? `The outputs kept now are ${Array.from(this.outputs.keys()).join(", ")}. `
            : ""
        }An older output may have been let go to make room: run the tool again.`,
      };
    }

    const pattern: string | undefined = readStringArgument(args, [
      "pattern",
      "search",
    ]);

    if (pattern !== undefined && pattern.length > 0) {
      return this.readMatching(stored, pattern);
    }

    const total: number = stored.lines.length;
    const startLine: number = Math.max(
      1,
      readIntegerArgument(args, ["start_line", "offset"]) ?? 1,
    );

    if (startLine > total) {
      return {
        narration: `${READ_TOOL_OUTPUT_TOOL_NAME} ${id} failed: past its end`,
        output: `Error: start_line ${startLine} is past the end of ${id}, which has ${countOf(total, "line")}.`,
      };
    }

    const limit: number | undefined = readIntegerArgument(args, ["limit"]);
    const requestedEnd: number =
      readIntegerArgument(args, ["end_line"]) ??
      (limit !== undefined && limit > 0
        ? startLine + limit - 1
        : startLine + TOOL_OUTPUT_PAGE_LINES - 1);

    if (requestedEnd < startLine) {
      return {
        narration: `${READ_TOOL_OUTPUT_TOOL_NAME} ${id} failed: end before start`,
        output: `Error: end_line ${requestedEnd} comes before start_line ${startLine}.`,
      };
    }

    const endLine: number = Math.min(requestedEnd, total);
    const window: NumberedWindow = formatNumberedWindow({
      lines: stored.lines,
      startLine,
      endLine,
      maxChars: READ_FILE_MAX_WINDOW_CHARS,
      maxLineChars:
        startLine === endLine
          ? READ_FILE_MAX_WINDOW_CHARS
          : READ_FILE_MAX_LINE_CHARS,
    });

    return {
      narration: `read ${id}:${startLine}-${window.lastLine} (${stored.label})`,
      output: `${window.text}[${id} (${stored.label}): lines ${startLine}-${window.lastLine} of ${total}.${
        window.lastLine < total
          ? ` Read on with start_line ${window.lastLine + 1}.`
          : " This is its end."
      }]`,
    };
  }

  private readMatching(
    stored: StoredToolOutput,
    pattern: string,
  ): ToolExecution {
    const needle: string = pattern.toLowerCase();
    let text: string = "";
    let shown: number = 0;
    let matches: number = 0;

    for (let index: number = 0; index < stored.lines.length; index++) {
      const line: string = stored.lines[index] as string;

      if (!line.toLowerCase().includes(needle)) {
        continue;
      }

      matches++;

      if (
        shown >= TOOL_OUTPUT_MAX_PATTERN_MATCHES ||
        text.length >= READ_FILE_MAX_WINDOW_CHARS
      ) {
        continue;
      }

      const shownLine: string =
        line.length > READ_FILE_MAX_LINE_CHARS
          ? `${line.substring(0, READ_FILE_MAX_LINE_CHARS)} [... line cut]`
          : line;

      text += `${lineNumberPrefix(index + 1)}${shownLine}\n`;
      shown++;
    }

    const narration: string = `searched ${stored.id} for "${pattern}" (${stored.label})`;

    if (matches === 0) {
      return {
        narration,
        output: `No line of ${stored.id} (${stored.label}, ${countOf(
          stored.lines.length,
          "line",
        )}) holds ${JSON.stringify(pattern)} (case ignored).`,
      };
    }

    return {
      narration,
      output: `${text}[${countOf(matches, "line")} of ${stored.id} (${stored.label}) hold ${JSON.stringify(
        pattern,
      )}${
        shown < matches
          ? `; the first ${shown} are shown. Read around a line with start_line and end_line`
          : ""
      }.]`,
    };
  }

  private keep(label: string, text: string): StoredToolOutput {
    const stored: StoredToolOutput = {
      id: `out-${this.nextNumber++}`,
      label: label.length > 120 ? `${label.substring(0, 117)}...` : label,
      lines: splitTextLines(text),
      chars: text.length,
    };

    this.outputs.set(stored.id, stored);
    this.keptChars += stored.chars;

    // The oldest go first; the newest is always kept, however long.
    for (const [id, output] of this.outputs) {
      if (this.keptChars <= this.maxChars || id === stored.id) {
        break;
      }

      this.outputs.delete(id);
      this.keptChars -= output.chars;
    }

    return stored;
  }

  private presentStartAndEnd(stored: StoredToolOutput): string {
    const total: number = stored.lines.length;
    const head: { text: string; lastLine: number } = this.takeStart(
      stored,
      TOOL_OUTPUT_HEAD_CHARS,
    );

    let tail: string = "";
    let firstTailLine: number = total + 1;

    for (let index: number = total - 1; index >= head.lastLine; index--) {
      const line: string = this.cutLine(stored, index + 1);

      if (
        tail.length + line.length + 1 > TOOL_OUTPUT_TAIL_CHARS &&
        firstTailLine <= total
      ) {
        break;
      }

      tail = `${line}\n${tail}`;
      firstTailLine = index + 1;
    }

    const leftOutFrom: number = head.lastLine + 1;
    const leftOutTo: number = firstTailLine - 1;

    if (leftOutTo < leftOutFrom) {
      return `${head.text}${tail}`.trimEnd();
    }

    return `${head.text}\n... [${stored.id}: lines ${leftOutFrom}-${leftOutTo} of ${total} are left out here. read_tool_output with output_id ${JSON.stringify(
      stored.id,
    )} reads them (start_line ${leftOutFrom}), or finds the lines that hold a text (pattern).] ...\n\n${tail}`.trimEnd();
  }

  private presentStart(stored: StoredToolOutput): string {
    const total: number = stored.lines.length;
    const head: { text: string; lastLine: number } = this.takeStart(
      stored,
      TOOL_OUTPUT_INLINE_CHARS,
    );

    return `${head.text}[${stored.id}: lines 1-${head.lastLine} of ${total} shown. read_tool_output with output_id ${JSON.stringify(
      stored.id,
    )} and start_line ${head.lastLine + 1} reads on, or finds the lines that hold a text (pattern).]`;
  }

  // The first lines that fit in `maxChars` (always the first line, cut).
  private takeStart(
    stored: StoredToolOutput,
    maxChars: number,
  ): { text: string; lastLine: number } {
    let text: string = "";
    let lastLine: number = 0;

    for (let index: number = 0; index < stored.lines.length; index++) {
      const line: string = this.cutLine(stored, index + 1);

      if (index > 0 && text.length + line.length + 1 > maxChars) {
        break;
      }

      text += `${line}\n`;
      lastLine = index + 1;
    }

    return { text, lastLine };
  }

  /*
   * A line of a kept output as it is shown in part: cut when it is longer
   * than a line may be, saying how to read more of it.
   */
  private cutLine(stored: StoredToolOutput, lineNumber: number): string {
    const line: string = stored.lines[lineNumber - 1] ?? "";

    return line.length > READ_FILE_MAX_LINE_CHARS
      ? `${line.substring(0, READ_FILE_MAX_LINE_CHARS)} [... ${(
          line.length - READ_FILE_MAX_LINE_CHARS
        ).toLocaleString(
          "en-US",
        )} more characters on this line; read_tool_output with output_id ${JSON.stringify(
          stored.id,
        )}, start_line and end_line ${lineNumber} shows more of it]`
      : line;
  }
}
