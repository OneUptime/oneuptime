import { JSONObject } from "Common/Types/JSON";
import { MAX_WRITE_FILE_CHARS } from "Common/Server/Utils/AI/CodeFix/CodeAgentWorkspaceGuard";
import WorkspaceFileAccess, {
  WorkspaceTarget,
} from "../../Utils/WorkspaceFileAccess";
import {
  CodeAgentToolContext,
  countOf,
  readBooleanArgument,
  readStringArgument,
  ToolExecution,
} from "./CodeAgentToolTypes";
import {
  EDIT_FILE_CONTEXT_LINES,
  EDIT_FILE_MAX_EDITS,
  EDIT_FILE_MAX_SNIPPET_CHARS,
  READ_FILE_MAX_LINE_CHARS,
} from "./CodeAgentToolLimits";
import TextFile, { TextFileRead } from "./TextFile";
import {
  formatNumberedWindow,
  NumberedWindow,
  splitTextLines,
} from "./TextLines";

export const EDIT_FILE_TOOL_NAME: string = "edit_file";

// One replacement: the exact text to find, and what it becomes.
export interface FileEdit {
  oldText: string;
  newText: string;
  // Every place old_text is, rather than the one place it must be.
  replaceAll: boolean;
}

// A part of the edited text an edit wrote, as character offsets [start, end).
interface ChangedRegion {
  start: number;
  end: number;
}

export type FileEditsApplied =
  | {
      ok: true;
      content: string;
      regions: Array<ChangedRegion>;
      replacements: number;
    }
  | { ok: false; error: string };

// The most places an ambiguous old_text is listed at.
const MAX_LISTED_MATCHES: number = 10;

// The most lines a diagnosis shows of the file.
const MAX_DIAGNOSIS_LINES: number = 40;

// A line that starts with read_file's number and tab.
const LINE_NUMBER_PREFIX_PATTERN: RegExp = /^ *\d+\t/;

// Numbered lines without the newline after the last: spaces at its end stay.
function withoutFinalNewline(text: string): string {
  return text.endsWith("\n") ? text.substring(0, text.length - 1) : text;
}

/*
 * edit_file (issue #6441): change a file by replacing exact text, the way
 * coding agents edit - instead of writing the whole file again, which on a
 * file of thousands of lines costs the model its output and risks every
 * line it did not mean to touch.
 *
 * Each edit names text that must be in the file exactly once (or every
 * place it is, with replace_all), and what it becomes. The edits of one
 * call apply in order, and all or none: when one cannot apply, nothing is
 * written, and the answer says which and why - where the text is when it
 * differs only in whitespace, where its first line is when the rest
 * differs, and every place it is when it is in more than one. A file with
 * Windows line endings keeps them. The answer shows the changed lines as
 * they now read, numbered, so the model sees what it did.
 *
 * Writes go through WorkspaceFileAccess: inside the working tree only,
 * links included, never the repository's git metadata.
 */
export default class FileEditTool {
  public static async edit(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const requestedPath: string =
      readStringArgument(args, ["path", "file_path"]) || "";

    if (!requestedPath.trim()) {
      return {
        narration: `refused ${EDIT_FILE_TOOL_NAME}: no path given`,
        output:
          "Error: a path is required: the file to change, relative to the repository root.",
      };
    }

    const edits: Array<FileEdit> | string = FileEditTool.readEdits(args);

    if (typeof edits === "string") {
      return {
        narration: `refused ${EDIT_FILE_TOOL_NAME} ${requestedPath}: ${edits}`,
        output: `Error: ${edits}`,
      };
    }

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForWrite(
      context.workspaceRoot,
      requestedPath,
    );
    const relativePath: string = target.relativePath;
    const file: TextFileRead = await TextFile.read(target.absolutePath);

    if (file.kind !== "Text") {
      const reason: string =
        file.kind === "Missing"
          ? `${relativePath} does not exist. write_file creates a new file.`
          : file.kind === "Directory"
            ? `${relativePath} is a directory.`
            : file.kind === "Binary"
              ? `${relativePath} is a binary file; edit_file changes text files only.`
              : file.kind === "TooLarge"
                ? `${relativePath} is ${TextFile.describeSize(file.sizeInBytes)}, too large to edit here.`
                : `${relativePath} is not a regular file.`;

      return {
        narration: `${EDIT_FILE_TOOL_NAME} ${relativePath} failed`,
        output: `Error: ${reason}`,
      };
    }

    if (!file.isUtf8) {
      return {
        narration: `${EDIT_FILE_TOOL_NAME} ${relativePath} failed: not UTF-8`,
        output: `Error: ${relativePath} is not UTF-8 text, so an edit would change bytes you were never shown. Leave it as it is, or say in your summary what should change in it.`,
      };
    }

    /*
     * A file with Windows line endings keeps them in the lines an edit
     * writes - and a file that mixes both still takes an edit written
     * as the model read it.
     */
    let applied: FileEditsApplied = FileEditTool.applyEdits({
      content: file.content,
      edits: TextFile.usesCrlf(file.content)
        ? edits.map((edit: FileEdit): FileEdit => {
            return edit.oldText.includes("\r")
              ? edit
              : {
                  oldText: edit.oldText.replace(/\n/g, "\r\n"),
                  newText: edit.newText.replace(/\r?\n/g, "\r\n"),
                  replaceAll: edit.replaceAll,
                };
          })
        : edits,
      relativePath,
    });

    if (!applied.ok && TextFile.usesCrlf(file.content)) {
      const asWritten: FileEditsApplied = FileEditTool.applyEdits({
        content: file.content,
        edits,
        relativePath,
      });

      if (asWritten.ok) {
        applied = asWritten;
      }
    }

    if (!applied.ok) {
      return {
        narration: `${EDIT_FILE_TOOL_NAME} ${relativePath} failed: the text to replace did not match`,
        output: `Error: ${applied.error}\nNothing was changed.`,
      };
    }

    /*
     * An edit may not grow a file past what a write may make (a model
     * looping on replace_all could otherwise fill the Runner's disk). A file
     * the repository already holds larger than that - a lockfile, a
     * generated table - still takes an edit that does not make it larger.
     */
    if (
      applied.content.length > MAX_WRITE_FILE_CHARS &&
      applied.content.length > file.content.length
    ) {
      return {
        narration: `refused ${EDIT_FILE_TOOL_NAME} ${relativePath}: the result is too large`,
        output: `Error: the edited ${relativePath} would be ${applied.content.length.toLocaleString(
          "en-US",
        )} characters, past the ${MAX_WRITE_FILE_CHARS.toLocaleString(
          "en-US",
        )} an edit may grow a file to${
          file.content.length > MAX_WRITE_FILE_CHARS
            ? ` (it is ${file.content.length.toLocaleString(
                "en-US",
              )} now: an edit that does not make it larger is fine)`
            : ""
        }. Nothing was changed.`,
      };
    }

    await WorkspaceFileAccess.writeFile(target, applied.content);
    context.changes.markWritten(relativePath);

    return {
      narration: `edited ${relativePath} (${countOf(
        applied.replacements,
        "replacement",
      )})`,
      output: `Edited ${relativePath}: ${countOf(
        applied.replacements,
        "replacement",
      )}. The changed lines now read:\n${FileEditTool.describeRegions(
        applied.content,
        applied.regions,
      )}`,
    };
  }

  /*
   * The edits of a call, from `edits` (a list) or from one edit's own
   * old_text and new_text - or what is wrong with them.
   */
  public static readEdits(args: JSONObject): Array<FileEdit> | string {
    const rawEdits: unknown = args["edits"];
    const entries: Array<JSONObject> = [];

    if (Array.isArray(rawEdits)) {
      for (const entry of rawEdits) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return "each entry of edits must be an object with old_text and new_text.";
        }

        entries.push(entry as JSONObject);
      }
    } else if (
      readStringArgument(args, ["old_text", "old_string", "oldText"]) !==
      undefined
    ) {
      entries.push(args);
    }

    if (entries.length === 0) {
      return "edit_file needs old_text (the exact text to replace) and new_text (what it becomes), or edits: a list of them.";
    }

    if (entries.length > EDIT_FILE_MAX_EDITS) {
      return `one call may make at most ${EDIT_FILE_MAX_EDITS} edits; split them over several calls.`;
    }

    const edits: Array<FileEdit> = [];

    for (let index: number = 0; index < entries.length; index++) {
      const entry: JSONObject = entries[index] as JSONObject;
      const which: string =
        entries.length > 1 ? `edit ${index + 1} of ${entries.length}: ` : "";
      const oldText: string | undefined = readStringArgument(entry, [
        "old_text",
        "old_string",
        "oldText",
      ]);
      const newText: string | undefined = readStringArgument(entry, [
        "new_text",
        "new_string",
        "newText",
      ]);

      if (oldText === undefined || oldText.length === 0) {
        return `${which}old_text is required and may not be empty: the exact text to replace. To create a file, use write_file.`;
      }

      if (newText === undefined) {
        return `${which}new_text is required: what old_text becomes (an empty string removes it).`;
      }

      if (oldText === newText) {
        return `${which}old_text and new_text are the same, so this edit changes nothing.`;
      }

      edits.push({
        oldText,
        newText,
        replaceAll: readBooleanArgument(entry, ["replace_all", "replaceAll"]),
      });
    }

    return edits;
  }

  /*
   * Apply the edits in order, all or none (pure). Each old_text must be in
   * the text as the edits before it left it: once, or anywhere with
   * replace_all.
   */
  public static applyEdits(data: {
    content: string;
    edits: Array<FileEdit>;
    relativePath: string;
  }): FileEditsApplied {
    let content: string = data.content;
    let regions: Array<ChangedRegion> = [];
    let replacements: number = 0;

    for (let index: number = 0; index < data.edits.length; index++) {
      const edit: FileEdit = data.edits[index] as FileEdit;
      const which: string =
        data.edits.length > 1
          ? `Edit ${index + 1} of ${data.edits.length}: `
          : "";

      const occurrences: Array<number> = FileEditTool.findOccurrences(
        content,
        edit.oldText,
      );

      if (occurrences.length === 0) {
        return {
          ok: false,
          error: `${which}${FileEditTool.diagnoseMissingText({
            content,
            oldText: edit.oldText,
            relativePath: data.relativePath,
            earlierEdits: index,
          })}`,
        };
      }

      if (occurrences.length > 1 && !edit.replaceAll) {
        const lineStarts: Array<number> = FileEditTool.lineStarts(content);
        const lines: Array<number> = occurrences
          .slice(0, MAX_LISTED_MATCHES)
          .map((offset: number): number => {
            return FileEditTool.lineAt(lineStarts, offset);
          });

        return {
          ok: false,
          error: `${which}old_text is in ${data.relativePath} ${occurrences.length} times (at lines ${lines.join(
            ", ",
          )}${
            occurrences.length > MAX_LISTED_MATCHES ? ", ..." : ""
          }). Include more of the lines around it so it matches one place only, or set replace_all to change every one.`,
        };
      }

      const delta: number = edit.newText.length - edit.oldText.length;
      const oldLength: number = edit.oldText.length;

      // Where an offset of the text before this edit is in the text after it.
      const mapOffset: (offset: number, isEnd: boolean) => number = (
        offset: number,
        isEnd: boolean,
      ): number => {
        let shift: number = 0;

        for (const occurrence of occurrences) {
          if (occurrence + oldLength <= offset) {
            shift += delta;
          } else if (occurrence < offset) {
            // Inside text this edit replaced: the region grows to hold it.
            return isEnd
              ? occurrence + shift + edit.newText.length
              : occurrence + shift;
          } else {
            break;
          }
        }

        return offset + shift;
      };

      regions = regions.map((region: ChangedRegion): ChangedRegion => {
        return {
          start: mapOffset(region.start, false),
          end: Math.max(
            mapOffset(region.end, true),
            mapOffset(region.start, false),
          ),
        };
      });

      const pieces: Array<string> = [];
      let from: number = 0;

      for (
        let occurrenceIndex: number = 0;
        occurrenceIndex < occurrences.length;
        occurrenceIndex++
      ) {
        const occurrence: number = occurrences[occurrenceIndex] as number;
        pieces.push(content.substring(from, occurrence), edit.newText);
        from = occurrence + oldLength;

        const start: number = occurrence + occurrenceIndex * delta;
        regions.push({ start, end: start + edit.newText.length });
      }

      pieces.push(content.substring(from));
      content = pieces.join("");
      replacements += occurrences.length;
    }

    return { ok: true, content, regions, replacements };
  }

  // Every place `text` starts in `content`, not overlapping, in order.
  private static findOccurrences(content: string, text: string): Array<number> {
    const occurrences: Array<number> = [];
    let index: number = content.indexOf(text);

    while (index !== -1) {
      occurrences.push(index);
      index = content.indexOf(text, index + text.length);
    }

    return occurrences;
  }

  /*
   * Why old_text is not in the file, as helpfully as the file can say:
   * line numbers copied in with it, the text differing only in whitespace,
   * or its first line found with the rest differing.
   */
  private static diagnoseMissingText(data: {
    content: string;
    oldText: string;
    relativePath: string;
    earlierEdits: number;
  }): string {
    const oldLines: Array<string> = splitTextLines(data.oldText);
    const nonEmpty: Array<string> = oldLines.filter((line: string): boolean => {
      return line.trim().length > 0;
    });

    if (
      nonEmpty.length > 0 &&
      nonEmpty.every((line: string): boolean => {
        return LINE_NUMBER_PREFIX_PATTERN.test(line);
      })
    ) {
      return `old_text is not in ${data.relativePath}: its lines start with the line numbers read_file shows. Leave them out - the number and the tab after it are not part of the file.`;
    }

    const wanted: Array<string> = oldLines.map((line: string): string => {
      return line.trim();
    });

    while (wanted.length > 0 && wanted[0] === "") {
      wanted.shift();
    }

    while (wanted.length > 0 && wanted[wanted.length - 1] === "") {
      wanted.pop();
    }

    const fileLines: Array<string> = splitTextLines(data.content);
    const trimmedFileLines: Array<string> = fileLines.map(
      (line: string): string => {
        return line.trim();
      },
    );
    const afterEarlierEdits: string =
      data.earlierEdits > 0 ? " (as the edits before this one left it)" : "";

    if (wanted.length > 0) {
      for (
        let start: number = 0;
        start + wanted.length <= trimmedFileLines.length;
        start++
      ) {
        if (trimmedFileLines[start] !== wanted[0]) {
          continue;
        }

        let matches: boolean = true;

        for (let offset: number = 1; offset < wanted.length; offset++) {
          if (trimmedFileLines[start + offset] !== wanted[offset]) {
            matches = false;
            break;
          }
        }

        if (matches) {
          return `old_text is not in ${data.relativePath}${afterEarlierEdits} exactly as written, but lines ${start + 1}-${
            start + wanted.length
          } match it apart from whitespace (indentation, tabs or spaces at the ends of lines). Copy them exactly as they read here:\n${FileEditTool.numberedLines(
            fileLines,
            start + 1,
            start + wanted.length,
          )}`;
        }
      }

      const firstLine: string = wanted[0] as string;

      if (firstLine.length >= 3) {
        const found: Array<number> = [];

        for (
          let index: number = 0;
          index < trimmedFileLines.length && found.length < 5;
          index++
        ) {
          if ((trimmedFileLines[index] as string).includes(firstLine)) {
            found.push(index + 1);
          }
        }

        if (found.length > 0) {
          const first: number = found[0] as number;

          return `old_text is not in ${data.relativePath}${afterEarlierEdits}. Its first line is at line ${found.join(
            ", ",
          )}, but the lines after it differ from old_text. Lines ${first}-${Math.min(
            fileLines.length,
            first + wanted.length + 1,
          )} read:\n${FileEditTool.numberedLines(
            fileLines,
            first,
            first + wanted.length + 1,
          )}`;
        }
      }
    }

    return `old_text is not in ${data.relativePath}${afterEarlierEdits}. Read the lines you mean to change again with read_file - the file may have changed since you read it - and copy them exactly, without the line numbers.`;
  }

  // The changed regions as numbered lines, with a few unchanged lines around each.
  private static describeRegions(
    content: string,
    regions: Array<ChangedRegion>,
  ): string {
    const lines: Array<string> = splitTextLines(content);

    if (lines.length === 0) {
      return "(the file is now empty)";
    }

    const lineStarts: Array<number> = FileEditTool.lineStarts(content);
    const ranges: Array<{ from: number; to: number }> = regions
      .map((region: ChangedRegion): { from: number; to: number } => {
        const firstLine: number = FileEditTool.lineAt(lineStarts, region.start);
        const lastLine: number =
          region.end > region.start
            ? FileEditTool.lineAt(lineStarts, region.end - 1)
            : firstLine;

        return {
          from: Math.max(1, firstLine - EDIT_FILE_CONTEXT_LINES),
          to: Math.min(lines.length, lastLine + EDIT_FILE_CONTEXT_LINES),
        };
      })
      .sort((a: { from: number }, b: { from: number }): number => {
        return a.from - b.from;
      });

    const merged: Array<{ from: number; to: number }> = [];

    for (const range of ranges) {
      const last: { from: number; to: number } | undefined =
        merged[merged.length - 1];

      if (last && range.from <= last.to + 1) {
        last.to = Math.max(last.to, range.to);
      } else {
        merged.push({ ...range });
      }
    }

    const parts: Array<string> = [];
    let shownChars: number = 0;

    for (let index: number = 0; index < merged.length; index++) {
      const range: { from: number; to: number } = merged[index] as {
        from: number;
        to: number;
      };
      const window: NumberedWindow = formatNumberedWindow({
        lines,
        startLine: range.from,
        endLine: range.to,
        maxChars: EDIT_FILE_MAX_SNIPPET_CHARS,
        maxLineChars: READ_FILE_MAX_LINE_CHARS,
      });

      if (
        index > 0 &&
        shownChars + window.text.length > EDIT_FILE_MAX_SNIPPET_CHARS
      ) {
        parts.push(
          `[${countOf(merged.length - index, "more changed place")} not shown; read_file shows them.]`,
        );
        break;
      }

      parts.push(
        window.lastLine < range.to
          ? `${window.text}[... lines ${window.lastLine + 1}-${range.to} not shown; read_file shows them.]`
          : withoutFinalNewline(window.text),
      );
      shownChars += window.text.length;
    }

    return parts.join("\n...\n");
  }

  private static numberedLines(
    lines: Array<string>,
    from: number,
    to: number,
  ): string {
    const last: number = Math.min(
      lines.length,
      to,
      from + MAX_DIAGNOSIS_LINES - 1,
    );

    const text: string = formatNumberedWindow({
      lines,
      startLine: Math.max(1, from),
      endLine: last,
      maxChars: EDIT_FILE_MAX_SNIPPET_CHARS,
      maxLineChars: READ_FILE_MAX_LINE_CHARS,
    }).text;

    return withoutFinalNewline(text);
  }

  // The offset each line starts at.
  private static lineStarts(content: string): Array<number> {
    const starts: Array<number> = [0];
    let index: number = content.indexOf("\n");

    while (index !== -1) {
      starts.push(index + 1);
      index = content.indexOf("\n", index + 1);
    }

    return starts;
  }

  // The 1-based line an offset is on.
  private static lineAt(lineStarts: Array<number>, offset: number): number {
    let low: number = 0;
    let high: number = lineStarts.length - 1;

    while (low < high) {
      const middle: number = Math.ceil((low + high) / 2);

      if ((lineStarts[middle] as number) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return low + 1;
  }
}
