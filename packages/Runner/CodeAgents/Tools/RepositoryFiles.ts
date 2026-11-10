import GitReadCommand, { GitReadResult } from "../../Utils/GitReadCommand";
import {
  GIT_READ_MAX_OUTPUT_BYTES,
  GIT_READ_TIMEOUT_MS,
} from "./CodeAgentToolLimits";
import path from "path";

/*
 * The files of the repository as the model should see them: tracked, and
 * new ones not ignored (a file the agent just created included), but never
 * what .gitignore leaves out (node_modules, build output) and never a
 * tracked file that is deleted in the working tree. git answers this from
 * its index, so a listing never walks into a link: links are listed as
 * themselves.
 */
export default class RepositoryFiles {
  /*
   * Every such file under `relativeDirectory` ("." for all), as paths
   * relative to the repository root, sorted.
   */
  public static async list(
    workspaceRoot: string,
    relativeDirectory: string,
  ): Promise<Array<string>> {
    // Literal: a folder named like a pattern (a route's "[id]") is that folder.
    const pathspec: Array<string> =
      relativeDirectory === "." ? [] : ["--", `:(literal)${relativeDirectory}`];

    const [listed, deleted] = await Promise.all([
      RepositoryFiles.runListing(workspaceRoot, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        ...pathspec,
      ]),
      RepositoryFiles.runListing(workspaceRoot, [
        "ls-files",
        "--deleted",
        "-z",
        ...pathspec,
      ]),
    ]);

    const deletedPaths: Set<string> = new Set<string>(deleted);
    const unique: Set<string> = new Set<string>();

    for (const file of listed) {
      if (!deletedPaths.has(file)) {
        unique.add(file);
      }
    }

    return Array.from(unique).sort();
  }

  /*
   * Up to `max` files whose name is the name of a path that does not exist,
   * for the answer that says so: the model often guesses a folder wrong
   * and the name right.
   */
  public static async suggestByName(
    workspaceRoot: string,
    requestedPath: string,
    max: number = 5,
  ): Promise<Array<string>> {
    const name: string = path.basename(requestedPath).toLowerCase();

    if (!name || name === "." || name === "..") {
      return [];
    }

    try {
      const files: Array<string> = await RepositoryFiles.list(
        workspaceRoot,
        ".",
      );

      return files
        .filter((file: string): boolean => {
          return path.basename(file).toLowerCase() === name;
        })
        .slice(0, max);
    } catch {
      return [];
    }
  }

  private static async runListing(
    workspaceRoot: string,
    args: Array<string>,
  ): Promise<Array<string>> {
    const result: GitReadResult = await GitReadCommand.run({
      cwd: workspaceRoot,
      args,
      timeoutMs: GIT_READ_TIMEOUT_MS,
      maxOutputBytes: GIT_READ_MAX_OUTPUT_BYTES,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Could not list the repository's files: ${
          result.timedOut
            ? "git ls-files took too long"
            : result.stderr || `git ls-files exited ${result.exitCode}`
        }`,
      );
    }

    return result.stdout.split("\0").filter((entry: string): boolean => {
      return entry.length > 0;
    });
  }
}
