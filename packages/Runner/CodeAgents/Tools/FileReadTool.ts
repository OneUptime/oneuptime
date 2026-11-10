import { JSONObject } from "Common/Types/JSON";
import WorkspaceFileAccess, {
  WorkspaceTarget,
} from "../../Utils/WorkspaceFileAccess";
import {
  CodeAgentToolContext,
  countOf,
  readIntegerArgument,
  readStringArgument,
  ToolExecution,
} from "./CodeAgentToolTypes";
import {
  READ_FILE_DEFAULT_LINES,
  READ_FILE_MAX_LINE_CHARS,
  READ_FILE_MAX_WINDOW_CHARS,
} from "./CodeAgentToolLimits";
import RepositoryFiles from "./RepositoryFiles";
import TextFile, { TextFileRead } from "./TextFile";
import {
  formatNumberedWindow,
  NumberedWindow,
  splitTextLines,
} from "./TextLines";

/*
 * read_file (issue #6441): a file of the repository as numbered lines, in
 * windows. A file of any length can be read whole, a window at a time -
 * start_line and end_line choose the window, and every window that is not
 * the whole file says which lines it shows and where to read on. The old
 * tool returned the first 20,000 characters of a file and nothing else, so
 * a change past them could not be made at all.
 *
 * A window shows up to READ_FILE_DEFAULT_LINES lines when no end is named,
 * and stops at a whole line before READ_FILE_MAX_WINDOW_CHARS; a line
 * longer than READ_FILE_MAX_LINE_CHARS is cut there unless it is read
 * alone. A directory, a binary file and a file too large to read say so,
 * and a path that does not exist names files of the same name.
 *
 * Reads go through WorkspaceFileAccess: inside the workspace only, links
 * included.
 */
export default class FileReadTool {
  public static async read(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const requestedPath: string =
      readStringArgument(args, ["path", "file_path"]) || "";

    if (!requestedPath.trim()) {
      return {
        narration: "refused read_file: no path given",
        output:
          "Error: a path is required: the file to read, relative to the repository root.",
      };
    }

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForRead(
      context.workspaceRoot,
      requestedPath,
    );
    const relativePath: string = target.relativePath;
    const file: TextFileRead = await TextFile.read(target.absolutePath);

    switch (file.kind) {
      case "Missing": {
        const similar: Array<string> = await RepositoryFiles.suggestByName(
          context.workspaceRoot,
          relativePath,
        );

        return {
          narration: `read_file ${relativePath} failed: no such file`,
          output: `Error: ${relativePath} does not exist.${
            similar.length > 0
              ? ` Files with that name: ${similar.join(", ")}.`
              : " find_files finds a file by its name."
          }`,
        };
      }
      case "Directory":
        return {
          narration: `read_file ${relativePath} failed: a directory`,
          output: `Error: ${relativePath} is a directory. list_directory shows what is in it.`,
        };
      case "NotAFile":
        return {
          narration: `read_file ${relativePath} failed: not a file`,
          output: `Error: ${relativePath} is not a regular file.`,
        };
      case "Binary":
        return {
          narration: `read_file ${relativePath} failed: a binary file`,
          output: `Error: ${relativePath} is a binary file (${TextFile.describeSize(
            file.sizeInBytes,
          )}). read_file shows text files only.`,
        };
      case "TooLarge":
        return {
          narration: `read_file ${relativePath} failed: too large`,
          output: `Error: ${relativePath} is ${TextFile.describeSize(
            file.sizeInBytes,
          )}, too large to read here. search_files with this path finds the lines you need in it.`,
        };
      case "Text":
        break;
    }

    context.changes.markRead(relativePath);

    const lines: Array<string> = splitTextLines(file.content);
    const total: number = lines.length;

    if (total === 0) {
      return {
        narration: `read ${relativePath}`,
        output: `(${relativePath} is empty)`,
      };
    }

    const startLine: number = Math.max(
      1,
      readIntegerArgument(args, ["start_line", "offset", "line"]) ?? 1,
    );

    if (startLine > total) {
      return {
        narration: `read_file ${relativePath} failed: past its end`,
        output: `Error: start_line ${startLine} is past the end of ${relativePath}, which has ${countOf(
          total,
          "line",
        )}.`,
      };
    }

    const limit: number | undefined = readIntegerArgument(args, ["limit"]);
    const requestedEnd: number =
      readIntegerArgument(args, ["end_line"]) ??
      (limit !== undefined && limit > 0
        ? startLine + limit - 1
        : startLine + READ_FILE_DEFAULT_LINES - 1);

    if (requestedEnd < startLine) {
      return {
        narration: `read_file ${relativePath} failed: end before start`,
        output: `Error: end_line ${requestedEnd} comes before start_line ${startLine}.`,
      };
    }

    const endLine: number = Math.min(requestedEnd, total);
    const window: NumberedWindow = formatNumberedWindow({
      lines,
      startLine,
      endLine,
      maxChars: READ_FILE_MAX_WINDOW_CHARS,
      maxLineChars:
        startLine === endLine
          ? READ_FILE_MAX_WINDOW_CHARS
          : READ_FILE_MAX_LINE_CHARS,
    });

    const isWholeFile: boolean = startLine === 1 && window.lastLine === total;

    if (isWholeFile) {
      return {
        narration: `read ${relativePath}`,
        // Without the newline that ends the last line: the text is all there is.
        output: window.text.substring(0, window.text.length - 1),
      };
    }

    const notes: Array<string> = [
      `${relativePath}: lines ${startLine}-${window.lastLine} of ${total}${
        window.stoppedAtCharLimit
          ? ` (a window holds about ${READ_FILE_MAX_WINDOW_CHARS.toLocaleString(
              "en-US",
            )} characters)`
          : ""
      }.`,
      window.lastLine < total
        ? `Read on with start_line ${window.lastLine + 1}.`
        : "This is the end of the file.",
    ];

    return {
      narration: `read ${relativePath}:${startLine}-${window.lastLine}`,
      output: `${window.text}[${notes.join(" ")}]`,
    };
  }
}
