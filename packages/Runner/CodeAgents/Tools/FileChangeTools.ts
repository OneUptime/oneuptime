import { JSONObject } from "Common/Types/JSON";
import { MAX_WRITE_FILE_CHARS } from "Common/Server/Utils/AI/CodeFix/CodeAgentWorkspaceGuard";
import WorkspaceFileAccess, {
  WorkspaceTarget,
} from "../../Utils/WorkspaceFileAccess";
import {
  CodeAgentToolContext,
  readStringArgument,
  ToolExecution,
} from "./CodeAgentToolTypes";
import fs from "fs";
import path from "path";

export const DELETE_FILE_TOOL_NAME: string = "delete_file";
export const MOVE_FILE_TOOL_NAME: string = "move_file";

/*
 * The tools that write files whole, delete them and move them. Each goes
 * through WorkspaceFileAccess - inside the working tree only, links
 * included, never the repository's git metadata - and records the path as
 * the agent's own change, so the pipeline stages it (a deletion included)
 * and never takes it for a command's output.
 */
export default class FileChangeTools {
  public static async writeFile(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const requestedPath: string = (args["path"] as string) || "";

    /*
     * An absent or non-string `content` must NOT be coerced to "". A model
     * that drops the argument — or emits it as null, or as an object it
     * meant to stringify — would otherwise truncate a real source file to
     * zero bytes and be told the write succeeded. The empty file then flows
     * through as a legitimate edit: staged, committed, and opened as a pull
     * request that deletes the contents of a file nobody asked it to touch.
     *
     * Writing a genuinely empty file is still possible — pass "" explicitly.
     */
    if (typeof args["content"] !== "string") {
      return {
        narration: `refused write_file ${requestedPath || "(no path)"}: no content argument`,
        output:
          "Error: write_file requires a `content` string. Pass the full new " +
          "content of the file. (To empty a file deliberately, pass an empty string.)",
      };
    }

    const content: string = args["content"];
    /*
     * Writes land in the working tree only: never outside the workspace
     * (links included) and never in the repository's git metadata (the
     * pipeline owns the repository's git state).
     */
    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForWrite(
      context.workspaceRoot,
      requestedPath,
    );
    const relativePath: string = target.relativePath;

    /*
     * A model that loops on a generation bug can otherwise fill the
     * Runner's disk from inside a tool call, taking every other capability
     * on the host down with it. No source file a fix needs to write is
     * anywhere near this size.
     */
    if (content.length > MAX_WRITE_FILE_CHARS) {
      return {
        narration: `refused write_file ${relativePath}: ${content.length} chars exceeds the limit`,
        output:
          `Error: refusing to write ${content.length.toLocaleString()} characters to ` +
          `${relativePath} — the per-file limit is ${MAX_WRITE_FILE_CHARS.toLocaleString()} ` +
          `characters. Write a smaller, focused change.`,
      };
    }

    /*
     * Replacing a file the model has not read in this task throws away
     * every line of it the model never saw - a model writing a large file
     * again from memory is the classic way to open a pull request that
     * deletes half of it. The file is read first, and changed with
     * edit_file.
     */
    const existing: fs.Stats | null = await fs.promises
      .stat(target.absolutePath)
      .catch((): null => {
        return null;
      });

    if (existing?.isDirectory()) {
      return {
        narration: `refused write_file ${relativePath}: a directory`,
        output: `Error: ${relativePath} is a directory.`,
      };
    }

    if (existing && !context.changes.hasSeen(relativePath)) {
      return {
        narration: `refused write_file ${relativePath}: not read in this task`,
        output: `Error: ${relativePath} already exists, and you have not read it in this task. write_file replaces a whole file: read it first with read_file, and change it with edit_file, which replaces only the text you name.`,
      };
    }

    await WorkspaceFileAccess.writeFile(target, content);

    /*
     * Remember what the model authored. This survives a later run_command
     * touching the same path, so a file the agent deliberately wrote is
     * never mistaken for build output and dropped from the commit.
     */
    context.changes.markWritten(relativePath);

    return {
      narration: `wrote ${relativePath} (${content.length} chars)`,
      output: `Wrote ${content.length} characters to ${relativePath}${
        existing ? "" : " (a new file)"
      }.`,
    };
  }

  public static async deleteFile(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const requestedPath: string =
      readStringArgument(args, ["path", "file_path"]) || "";

    if (!requestedPath.trim()) {
      return {
        narration: `refused ${DELETE_FILE_TOOL_NAME}: no path given`,
        output: "Error: a path is required: the file to delete.",
      };
    }

    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveEntry(
      context.workspaceRoot,
      requestedPath,
    );
    const stats: fs.Stats | null = await fs.promises
      .lstat(target.absolutePath)
      .catch((): null => {
        return null;
      });

    if (!stats) {
      return {
        narration: `${DELETE_FILE_TOOL_NAME} ${target.relativePath} failed: no such file`,
        output: `Error: ${target.relativePath} does not exist.`,
      };
    }

    if (stats.isDirectory()) {
      return {
        narration: `refused ${DELETE_FILE_TOOL_NAME} ${target.relativePath}: a directory`,
        output: `Error: ${target.relativePath} is a directory; delete_file deletes one file at a time.`,
      };
    }

    await fs.promises.unlink(target.absolutePath);
    context.changes.markWritten(target.relativePath);

    return {
      narration: `deleted ${target.relativePath}`,
      output: `Deleted ${target.relativePath}.`,
    };
  }

  public static async moveFile(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const from: string =
      readStringArgument(args, ["from", "source", "path"]) || "";
    const to: string =
      readStringArgument(args, ["to", "destination", "new_path"]) || "";

    if (!from.trim() || !to.trim()) {
      return {
        narration: `refused ${MOVE_FILE_TOOL_NAME}: from and to are required`,
        output:
          "Error: move_file needs from (the file to move) and to (its new path).",
      };
    }

    const source: WorkspaceTarget = await WorkspaceFileAccess.resolveEntry(
      context.workspaceRoot,
      from,
    );
    const destination: WorkspaceTarget =
      await WorkspaceFileAccess.resolveForWrite(context.workspaceRoot, to);

    const stats: fs.Stats | null = await fs.promises
      .lstat(source.absolutePath)
      .catch((): null => {
        return null;
      });

    if (!stats) {
      return {
        narration: `${MOVE_FILE_TOOL_NAME} ${source.relativePath} failed: no such file`,
        output: `Error: ${source.relativePath} does not exist.`,
      };
    }

    if (stats.isDirectory()) {
      return {
        narration: `refused ${MOVE_FILE_TOOL_NAME} ${source.relativePath}: a directory`,
        output: `Error: ${source.relativePath} is a directory; move_file moves one file at a time.`,
      };
    }

    const occupied: boolean = await fs.promises
      .lstat(destination.absolutePath)
      .then((): boolean => {
        return true;
      })
      .catch((): boolean => {
        return false;
      });

    if (occupied) {
      return {
        narration: `refused ${MOVE_FILE_TOOL_NAME} ${source.relativePath}: ${destination.relativePath} exists`,
        output: `Error: ${destination.relativePath} already exists. Delete it first, or move the file somewhere else.`,
      };
    }

    await fs.promises.mkdir(path.dirname(destination.absolutePath), {
      recursive: true,
    });
    await fs.promises.rename(source.absolutePath, destination.absolutePath);

    context.changes.markWritten(source.relativePath);
    context.changes.markWritten(destination.relativePath);

    return {
      narration: `moved ${source.relativePath} to ${destination.relativePath}`,
      output: `Moved ${source.relativePath} to ${destination.relativePath}.`,
    };
  }
}
