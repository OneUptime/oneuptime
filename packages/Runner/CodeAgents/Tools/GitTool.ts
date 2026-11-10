import { JSONObject } from "Common/Types/JSON";
import GitReadCommand, { GitReadResult } from "../../Utils/GitReadCommand";
import WorkspaceFileAccess, {
  WorkspaceTarget,
} from "../../Utils/WorkspaceFileAccess";
import {
  CodeAgentToolContext,
  readBooleanArgument,
  readIntegerArgument,
  readStringArgument,
  ToolExecution,
} from "./CodeAgentToolTypes";
import {
  GIT_READ_MAX_OUTPUT_BYTES,
  GIT_READ_TIMEOUT_MS,
} from "./CodeAgentToolLimits";
import { LongOutputShape } from "./ToolOutputStore";
import fs from "fs";
import os from "os";
import path from "path";

export const GIT_TOOL_NAME: string = "git";

export const GIT_TOOL_ACTIONS: ReadonlyArray<string> = [
  "status",
  "diff",
  "log",
  "show",
  "blame",
];

const DEFAULT_LOG_COUNT: number = 20;
const MAX_LOG_COUNT: number = 200;
const MAX_REVISION_LENGTH: number = 200;

/*
 * A revision as git names one: a commit, a branch or tag, HEAD~3, a range
 * (a..b), or a file at a revision (HEAD:src/x.ts). Never an option: it may
 * not start with "-", and has no space in it.
 */
const REVISION_PATTERN: RegExp = /^[A-Za-z0-9._/~^@{}:+-]+$/;

/*
 * The read-only git the code agent may use as a tool of its own (issue
 * #6441): what it has changed so far (status, diff), and the history that
 * explains the code it is changing (log, show, blame). On every Runner -
 * a global one, which runs no command a model composes, included - because
 * each action runs git with an argument list of its own: the model chooses
 * the action and fills in a revision, a path, a count or lines, each checked
 * (a revision is never an option, a path goes through WorkspaceFileAccess
 * and after `--`). Nothing here commits, checks out, fetches or writes;
 * GitReadCommand keeps git off the network and off the index.
 */
export default class GitTool {
  public static async run(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const action: string = (
      readStringArgument(args, ["action", "command"]) || ""
    )
      .trim()
      .toLowerCase();

    if (!GIT_TOOL_ACTIONS.includes(action)) {
      return {
        narration: `refused git: ${action ? `unknown action ${action}` : "no action given"}`,
        output: `Error: action must be one of ${GIT_TOOL_ACTIONS.join(
          ", ",
        )}. Only read-only git is available: the pipeline commits, branches and pushes your change.`,
      };
    }

    const revision: string | undefined = (
      readStringArgument(args, ["revision", "commit", "ref"]) || ""
    ).trim();

    if (
      revision &&
      (revision.length > MAX_REVISION_LENGTH ||
        revision.startsWith("-") ||
        !REVISION_PATTERN.test(revision))
    ) {
      return {
        narration: `refused git ${action}: not a revision`,
        output: `Error: ${JSON.stringify(
          revision.substring(0, MAX_REVISION_LENGTH),
        )} is not a revision: a commit, a branch or tag, HEAD~3, a range like main..HEAD, or HEAD:path/to/file.`,
      };
    }

    const requestedPath: string = (
      readStringArgument(args, ["path", "file"]) || ""
    ).trim();
    let relativePath: string | null = null;

    if (requestedPath) {
      const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForRead(
        context.workspaceRoot,
        requestedPath,
      );
      relativePath = target.relativePath === "." ? null : target.relativePath;
    }

    const pathspec: Array<string> = relativePath
      ? ["--", `:(literal)${relativePath}`]
      : [];
    const statOnly: boolean = readBooleanArgument(args, ["stat"]);
    let gitArgs: Array<string>;

    switch (action) {
      case "status":
        gitArgs = [
          "status",
          "--short",
          "--branch",
          "--untracked-files=all",
          ...pathspec,
        ];
        break;
      case "diff":
        gitArgs = [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          ...(statOnly ? ["--stat"] : []),
          revision || "HEAD",
          ...pathspec,
        ];
        break;
      case "log": {
        const count: number = Math.min(
          MAX_LOG_COUNT,
          Math.max(
            1,
            readIntegerArgument(args, ["max_count", "count", "limit"]) ??
              DEFAULT_LOG_COUNT,
          ),
        );
        const patch: boolean = readBooleanArgument(args, ["patch"]);

        gitArgs = [
          "log",
          `--max-count=${count}`,
          "--date=short",
          "--format=%h %ad %an: %s",
          "--no-ext-diff",
          "--no-textconv",
          ...(patch ? ["-p"] : []),
          ...(statOnly && !patch ? ["--stat"] : []),
          ...(revision ? [revision] : []),
          ...pathspec,
        ];
        break;
      }
      case "show":
        gitArgs = [
          "show",
          "--no-ext-diff",
          "--no-textconv",
          ...(statOnly ? ["--stat"] : []),
          revision || "HEAD",
          /*
           * Only that file's change in the commit, a commit named by its
           * message (:/text) included. Git shows a file or folder at a
           * revision (HEAD:path) whole, whatever path says.
           */
          ...pathspec,
        ];
        break;
      default: {
        if (!relativePath) {
          return {
            narration: "refused git blame: no path given",
            output: "Error: blame needs path: the file whose lines to explain.",
          };
        }

        const startLine: number | undefined = readIntegerArgument(args, [
          "start_line",
        ]);
        const endLine: number | undefined = readIntegerArgument(args, [
          "end_line",
        ]);
        const range: Array<string> =
          startLine !== undefined && startLine > 0
            ? [
                "-L",
                `${startLine},${
                  endLine !== undefined && endLine >= startLine
                    ? endLine
                    : startLine + 49
                }`,
              ]
            : [];

        gitArgs = [
          "blame",
          // Blame runs a file's textconv filter unless told not to.
          "--no-textconv",
          "--date=short",
          ...range,
          ...(revision ? [revision] : []),
          "--",
          relativePath,
        ];
        break;
      }
    }

    const narration: string = `ran git ${action}${revision ? ` ${revision}` : ""}${
      relativePath ? ` -- ${relativePath}` : ""
    }`;

    const result: GitReadResult =
      action === "diff"
        ? await GitTool.runOnIndexCopy(context, gitArgs)
        : await GitReadCommand.run({
            cwd: context.workspaceRoot,
            args: gitArgs,
            timeoutMs: GIT_READ_TIMEOUT_MS,
            maxOutputBytes: GIT_READ_MAX_OUTPUT_BYTES,
          });

    if (result.timedOut) {
      return {
        narration: `${narration} (timed out)`,
        output: `Error: git ${action} took longer than ${
          GIT_READ_TIMEOUT_MS / 1000
        } seconds and was stopped. Narrow it with path, or fewer commits.`,
      };
    }

    if (result.exitCode !== 0 && !result.outputLimitReached) {
      return {
        narration: `${narration} (failed)`,
        output: `Error: git ${action} failed: ${
          result.stderr.split("\n").slice(0, 3).join(" ") ||
          `exit ${result.exitCode}`
        }`,
      };
    }

    let text: string = result.stdout.trimEnd();

    // A diff leaves out new files; say which there are, so none is missed.
    if (action === "diff" && !revision?.includes("..")) {
      const newFiles: Array<string> = await GitTool.untrackedFiles(
        context,
        relativePath,
      );

      if (newFiles.length > 0) {
        text = `${text}${text ? "\n\n" : ""}New files git does not track yet (diff leaves them out; read_file reads them):\n${newFiles
          .map((file: string): string => {
            return `  ${file}`;
          })
          .join("\n")}`;
      }
    }

    if (!text) {
      text =
        action === "diff"
          ? "No changes."
          : action === "log"
            ? "No commits."
            : "(no output)";
    }

    if (result.outputLimitReached) {
      text = `${text}\n[The output went past what is kept and was stopped; narrow it with path, stat or fewer commits.]`;
    }

    return {
      narration,
      output: context.outputs.present({
        label: `git ${action}`,
        text,
        shape: LongOutputShape.Start,
      }),
    };
  }

  /*
   * git diff refreshes the index it reads whatever GIT_OPTIONAL_LOCKS says,
   * and the index is the pipeline's: a refresh stopped at its timeout would
   * leave it locked, and the pipeline unable to stage the change. So the
   * diff reads a copy of it, in a folder of its own removed after - a
   * repository with no index yet gets a fresh one there, as git would.
   */
  private static async runOnIndexCopy(
    context: CodeAgentToolContext,
    args: Array<string>,
  ): Promise<GitReadResult> {
    const located: GitReadResult = await GitReadCommand.run({
      cwd: context.workspaceRoot,
      args: ["rev-parse", "--git-path", "index"],
      timeoutMs: GIT_READ_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024,
    });

    if (located.exitCode !== 0 || !located.stdout.trim()) {
      return located;
    }

    const indexPath: string = path.resolve(
      context.workspaceRoot,
      located.stdout.trim(),
    );
    const scratch: string = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "oneuptime-git-index-"),
    );

    try {
      await fs.promises
        .copyFile(indexPath, path.join(scratch, "index"))
        .catch((error: NodeJS.ErrnoException): void => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        });

      return await GitReadCommand.run({
        cwd: context.workspaceRoot,
        args,
        timeoutMs: GIT_READ_TIMEOUT_MS,
        maxOutputBytes: GIT_READ_MAX_OUTPUT_BYTES,
        indexFile: path.join(scratch, "index"),
      });
    } finally {
      await fs.promises.rm(scratch, { recursive: true, force: true });
    }
  }

  private static async untrackedFiles(
    context: CodeAgentToolContext,
    relativePath: string | null,
  ): Promise<Array<string>> {
    const result: GitReadResult = await GitReadCommand.run({
      cwd: context.workspaceRoot,
      args: [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        ...(relativePath ? ["--", `:(literal)${relativePath}`] : []),
      ],
      timeoutMs: GIT_READ_TIMEOUT_MS,
      maxOutputBytes: GIT_READ_MAX_OUTPUT_BYTES,
    });

    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout.split("\0").filter((entry: string): boolean => {
      return entry.length > 0;
    });
  }
}
