import { JSONObject } from "Common/Types/JSON";
import GitReadCommand, { GitReadResult } from "../../Utils/GitReadCommand";
import WorkspaceFileAccess, {
  WorkspaceTarget,
} from "../../Utils/WorkspaceFileAccess";
import {
  CodeAgentToolContext,
  countOf,
  readBooleanArgument,
  readIntegerArgument,
  readStringArgument,
  ToolExecution,
} from "./CodeAgentToolTypes";
import {
  GIT_READ_MAX_OUTPUT_BYTES,
  GIT_READ_TIMEOUT_MS,
  SEARCH_MAX_OUTPUT_BYTES,
  LIST_DIRECTORY_DEFAULT_DEPTH,
  LIST_DIRECTORY_MAX_DEPTH,
  LIST_DIRECTORY_MAX_ENTRIES,
  READ_FILE_MAX_LINE_CHARS,
  SEARCH_MAX_CONTEXT_LINES,
} from "./CodeAgentToolLimits";
import GlobMatcher from "./GlobMatcher";
import RepositoryFiles from "./RepositoryFiles";
import { LongOutputShape } from "./ToolOutputStore";
import fs from "fs";
import path from "path";

export const FIND_FILES_TOOL_NAME: string = "find_files";

// What git grep says when it was built without Perl-compatible patterns.
const NO_PCRE_PATTERN: RegExp =
  /perl-compatible|USE_LIBPCRE|not compiled with/i;

// The characters a :(glob) pathspec reads as a pattern (or an escape).
const GLOB_PATTERN_CHARACTER: RegExp = /[\\*?[]/g;

/*
 * A path as a :(glob) pathspec reads it: as written, each character a glob
 * would take for a pattern escaped - a folder such as app/[id] (a route of
 * many web frameworks) is that folder, never app/i or app/d.
 */
function escapeGlobPath(text: string): string {
  return text.replace(GLOB_PATTERN_CHARACTER, "\\$&");
}

/*
 * Finding things in the repository (issue #6441): files by name
 * (find_files), lines by text or pattern (search_files), and what a folder
 * holds, as deep as asked (list_directory).
 *
 * Every one of them sees the repository the way git does - tracked files
 * and new ones not ignored, never node_modules or build output - and runs
 * git with an argument list of its own, the model's values placed where git
 * reads them as values. Paths go through WorkspaceFileAccess first, so no
 * search leaves the workspace through a link. A long answer is kept for
 * read_tool_output rather than cut.
 */
export default class RepositorySearchTools {
  public static async searchFiles(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const pattern: string =
      readStringArgument(args, ["pattern", "query"]) || "";

    if (!pattern) {
      return {
        narration: "refused search_files: no pattern given",
        output: "Error: a search pattern is required.",
      };
    }

    const narration: string = `searched files for "${pattern}"`;
    const literal: boolean = readBooleanArgument(args, [
      "literal",
      "fixed_strings",
    ]);
    const ignoreCase: boolean = readBooleanArgument(args, [
      "case_insensitive",
      "ignore_case",
    ]);
    const filesOnly: boolean = readBooleanArgument(args, [
      "files_only",
      "names_only",
    ]);
    const contextLines: number = Math.min(
      SEARCH_MAX_CONTEXT_LINES,
      Math.max(0, readIntegerArgument(args, ["context_lines", "context"]) ?? 0),
    );

    const pathspecs: Array<string> | string =
      await RepositorySearchTools.searchPathspecs(context, args);

    if (typeof pathspecs === "string") {
      return { narration, output: `Error: ${pathspecs}` };
    }

    const buildArgs: (flavor: string) => Array<string> = (
      flavor: string,
    ): Array<string> => {
      return [
        "grep",
        "--untracked",
        "-I",
        "--no-color",
        ...(filesOnly ? ["-l"] : ["-n"]),
        ...(ignoreCase ? ["-i"] : []),
        flavor,
        ...(contextLines > 0 && !filesOnly ? ["-C", String(contextLines)] : []),
        "-e",
        pattern,
        "--",
        ...pathspecs,
      ];
    };

    let result: GitReadResult = await RepositorySearchTools.git(
      context,
      buildArgs(literal ? "-F" : "-P"),
      SEARCH_MAX_OUTPUT_BYTES,
    );

    // A git built without PCRE: the same search, as an extended pattern.
    if (
      !literal &&
      result.exitCode !== 0 &&
      result.exitCode !== 1 &&
      NO_PCRE_PATTERN.test(result.stderr)
    ) {
      result = await RepositorySearchTools.git(
        context,
        buildArgs("-E"),
        SEARCH_MAX_OUTPUT_BYTES,
      );
    }

    if (result.timedOut) {
      return {
        narration,
        output: `Error: the search took longer than ${
          GIT_READ_TIMEOUT_MS / 1000
        } seconds and was stopped. Narrow it with path or glob, or use a simpler pattern.`,
      };
    }

    /*
     * The answer never repeats the pattern: what the model is shown comes
     * from the repository's files, and from nothing else.
     */
    if (result.exitCode === 1 && !result.stdout) {
      return {
        narration,
        output: `No matches found${
          literal
            ? ""
            : " (the pattern is read as a regular expression; set literal to search for the text as written)"
        }.`,
      };
    }

    if (result.exitCode !== 0 && !result.outputLimitReached) {
      return {
        narration,
        output: `Error: the search failed: ${
          result.stderr.split("\n")[0] || `git grep exited ${result.exitCode}`
        }${literal ? "" : ". If the pattern is meant as plain text, set literal."}`,
      };
    }

    const lines: Array<string> = result.stdout
      .split("\n")
      .filter((line: string): boolean => {
        return line.length > 0;
      })
      .map((line: string): string => {
        return line.length > READ_FILE_MAX_LINE_CHARS
          ? `${line.substring(0, READ_FILE_MAX_LINE_CHARS)} [... line cut]`
          : line;
      });

    const note: string = result.outputLimitReached
      ? "\n[The search found more than it could keep and stopped; narrow it with path or glob.]"
      : "";

    return {
      narration,
      output: `${context.outputs.present({
        label: `search_files ${pattern}`,
        text: lines.join("\n"),
        shape: LongOutputShape.Start,
      })}${note}`,
    };
  }

  public static async findFiles(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const pattern: string = (
      readStringArgument(args, ["pattern", "name", "glob"]) || ""
    ).trim();

    if (!pattern) {
      return {
        narration: `refused ${FIND_FILES_TOOL_NAME}: no pattern given`,
        output:
          "Error: a pattern is required: a file name, part of a path, or a glob such as **/*.test.ts.",
      };
    }

    const narration: string = `searched file names for "${pattern}"`;
    const directory: WorkspaceTarget = await WorkspaceFileAccess.resolveForRead(
      context.workspaceRoot,
      readStringArgument(args, ["path", "directory"]) || ".",
    );
    const files: Array<string> = await RepositoryFiles.list(
      context.workspaceRoot,
      directory.relativePath,
    );
    const base: string =
      directory.relativePath === "." ? "" : `${directory.relativePath}/`;

    const relativeToBase: (file: string) => string = (file: string): string => {
      return base && file.startsWith(base) ? file.substring(base.length) : file;
    };

    let matching: Array<string>;
    let ignoredCase: boolean = false;

    if (GlobMatcher.isGlob(pattern)) {
      const matcher: GlobMatcher = new GlobMatcher(pattern);
      matching = files.filter((file: string): boolean => {
        return matcher.matches(relativeToBase(file));
      });

      if (matching.length === 0) {
        const caseless: GlobMatcher = new GlobMatcher(pattern, {
          ignoreCase: true,
        });
        matching = files.filter((file: string): boolean => {
          return caseless.matches(relativeToBase(file));
        });
        ignoredCase = matching.length > 0;
      }
    } else {
      const needle: string = pattern.toLowerCase();
      matching = files.filter((file: string): boolean => {
        return relativeToBase(file).toLowerCase().includes(needle);
      });
    }

    if (matching.length === 0) {
      return {
        narration,
        output: `No file${
          directory.relativePath === "."
            ? ""
            : ` under ${directory.relativePath}`
        } matches ${JSON.stringify(pattern)}.${
          GlobMatcher.isGlob(pattern)
            ? " A pattern without / matches file names anywhere; one with / matches the path."
            : ""
        }`,
      };
    }

    return {
      narration,
      output: `${countOf(matching.length, "file")} match${
        matching.length === 1 ? "es" : ""
      }${ignoredCase ? " (ignoring case)" : ""}:\n${context.outputs.present({
        label: `find_files ${pattern}`,
        text: matching.join("\n"),
        shape: LongOutputShape.Start,
      })}`,
    };
  }

  public static async listDirectory(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<ToolExecution> {
    const requestedPath: string =
      readStringArgument(args, ["path", "directory"]) || ".";
    const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForRead(
      context.workspaceRoot,
      requestedPath,
    );
    const relativePath: string = target.relativePath;
    const depth: number = Math.min(
      LIST_DIRECTORY_MAX_DEPTH,
      Math.max(
        1,
        readIntegerArgument(args, ["depth"]) ?? LIST_DIRECTORY_DEFAULT_DEPTH,
      ),
    );

    const stats: fs.Stats | null = await fs.promises
      .stat(target.absolutePath)
      .catch((): null => {
        return null;
      });

    if (!stats) {
      return {
        narration: `list_directory ${relativePath} failed: no such directory`,
        output: `Error: ${relativePath} does not exist.`,
      };
    }

    if (!stats.isDirectory()) {
      return {
        narration: `list_directory ${relativePath} failed: a file`,
        output: `Error: ${relativePath} is a file. read_file reads it.`,
      };
    }

    const ignored: Set<string> =
      depth > 1
        ? await RepositorySearchTools.ignoredPaths(context, relativePath)
        : new Set<string>();
    const lines: Array<string> = [];
    let entries: number = 0;
    let stoppedAtLimit: boolean = false;

    const walk: (
      absoluteDirectory: string,
      repositoryRelative: string,
      level: number,
    ) => Promise<void> = async (
      absoluteDirectory: string,
      repositoryRelative: string,
      level: number,
    ): Promise<void> => {
      const children: Array<fs.Dirent> = (
        await fs.promises.readdir(absoluteDirectory, { withFileTypes: true })
      ).sort((a: fs.Dirent, b: fs.Dirent): number => {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });

      for (const child of children) {
        if (entries >= LIST_DIRECTORY_MAX_ENTRIES) {
          stoppedAtLimit = true;
          return;
        }

        entries++;
        const indent: string = "  ".repeat(level - 1);
        // A link is listed as itself and never followed, so a walk stays in.
        const isDirectory: boolean = child.isDirectory();
        const childRelative: string =
          repositoryRelative === "."
            ? child.name
            : `${repositoryRelative}/${child.name}`;

        if (!isDirectory) {
          lines.push(
            `${indent}${child.name}${child.isSymbolicLink() ? " (link)" : ""}`,
          );
          continue;
        }

        if (level >= depth) {
          lines.push(`${indent}${child.name}/`);
          continue;
        }

        if (child.name === ".git") {
          lines.push(`${indent}${child.name}/ (git metadata; not listed)`);
          continue;
        }

        if (ignored.has(childRelative)) {
          lines.push(
            `${indent}${child.name}/ (ignored by .gitignore; not listed)`,
          );
          continue;
        }

        lines.push(`${indent}${child.name}/`);
        await walk(
          path.join(absoluteDirectory, child.name),
          childRelative,
          level + 1,
        );
      }
    };

    await walk(target.absolutePath, relativePath, 1);

    if (lines.length === 0) {
      return {
        narration: `listed ${relativePath}`,
        output: "(empty directory)",
      };
    }

    const note: string = stoppedAtLimit
      ? `\n[Stopped at ${LIST_DIRECTORY_MAX_ENTRIES.toLocaleString(
          "en-US",
        )} entries. List a folder inside it, or a smaller depth; find_files finds files by name.]`
      : "";

    return {
      narration: `listed ${relativePath}`,
      output: `${context.outputs.present({
        label: `list_directory ${relativePath}`,
        text: lines.join("\n"),
        shape: LongOutputShape.Start,
      })}${note}`,
    };
  }

  /*
   * The pathspecs a search is held to: the path (literal, never pathspec
   * magic) and the glob - or what is wrong with them. With both, the path
   * leads the glob, escaped so it is read as written.
   */
  private static async searchPathspecs(
    context: CodeAgentToolContext,
    args: JSONObject,
  ): Promise<Array<string> | string> {
    const requestedPath: string | undefined = readStringArgument(args, [
      "path",
      "directory",
    ]);
    const glob: string = (
      readStringArgument(args, ["glob", "include"]) || ""
    ).trim();

    let relativePath: string = ".";

    if (requestedPath && requestedPath.trim()) {
      const target: WorkspaceTarget = await WorkspaceFileAccess.resolveForRead(
        context.workspaceRoot,
        requestedPath,
      );
      relativePath = target.relativePath;
    }

    if (glob) {
      if (glob.split("/").includes("..") || glob.startsWith("/")) {
        return "glob matches paths inside the folder searched: no .. and no leading /.";
      }

      const prefix: string =
        relativePath === "." ? "" : `${escapeGlobPath(relativePath)}/`;
      const pattern: string = glob.includes("/") ? glob : `**/${glob}`;

      return [`:(glob)${prefix}${pattern.replace(/^\.\//, "")}`];
    }

    return relativePath === "." ? [] : [`:(literal)${relativePath}`];
  }

  // The ignored folders under a folder, as repository-relative paths.
  private static async ignoredPaths(
    context: CodeAgentToolContext,
    relativePath: string,
  ): Promise<Set<string>> {
    const result: GitReadResult = await RepositorySearchTools.git(context, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
      ...(relativePath === "." ? [] : ["--", `:(literal)${relativePath}`]),
    ]);

    if (result.exitCode !== 0) {
      return new Set<string>();
    }

    return new Set<string>(
      result.stdout
        .split("\0")
        .filter((entry: string): boolean => {
          return entry.endsWith("/");
        })
        .map((entry: string): string => {
          return entry.substring(0, entry.length - 1);
        }),
    );
  }

  private static git(
    context: CodeAgentToolContext,
    args: Array<string>,
    maxOutputBytes: number = GIT_READ_MAX_OUTPUT_BYTES,
  ): Promise<GitReadResult> {
    return GitReadCommand.run({
      cwd: context.workspaceRoot,
      args,
      timeoutMs: GIT_READ_TIMEOUT_MS,
      maxOutputBytes,
    });
  }
}
