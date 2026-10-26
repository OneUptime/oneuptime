import CodeAgentWorkspaceGuard from "Common/Server/Utils/AI/CodeFix/CodeAgentWorkspaceGuard";
import BadDataException from "Common/Types/Exception/BadDataException";
import fs from "fs";
import path from "path";

/*
 * Where the code agent's file tools may read and write: inside the
 * workspace, judged by where a path really leads (every link resolved), not
 * by its text alone (CodeAgentWorkspaceGuard.resolveWorkspacePath checks the
 * text first). The file tools are the agent's whole surface on a global
 * Runner (it runs no shell there), so they hold this boundary themselves:
 *
 *   - Reads (read_file, list_directory) follow links only while they stay
 *     inside the workspace. A link that leads out of it, or to nothing, is
 *     refused.
 *   - Writes (write_file) land only in the working tree: never outside the
 *     workspace, never through a link that leads to nothing, and never in a
 *     repository's git metadata (`.git`): the pipeline owns the
 *     repository's git state.
 *
 * The answer is the real location (links resolved), and the tools act on
 * that location, so what was checked is what is touched.
 */

export interface WorkspaceTarget {
  // The real location, every link resolved.
  absolutePath: string;
  // The same location relative to the workspace's real root ("." for it).
  relativePath: string;
}

const GIT_METADATA_DIRECTORY: string = ".git";

// Writes never follow a link at the final component, even one made later.
const WRITE_FLAGS: number =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_TRUNC |
  (fs.constants.O_NOFOLLOW ?? 0);

export default class WorkspaceFileAccess {
  public static async resolveForRead(
    workspaceRoot: string,
    requestedPath: string,
  ): Promise<WorkspaceTarget> {
    return this.resolveRealTarget(workspaceRoot, requestedPath);
  }

  public static async resolveForWrite(
    workspaceRoot: string,
    requestedPath: string,
  ): Promise<WorkspaceTarget> {
    const target: WorkspaceTarget = await this.resolveRealTarget(
      workspaceRoot,
      requestedPath,
    );

    if (target.relativePath === ".") {
      throw new BadDataException(
        `Cannot write to the workspace root itself: ${requestedPath}`,
      );
    }

    if (this.isInGitMetadata(target.relativePath)) {
      throw new BadDataException(
        `Refused: ${requestedPath} is inside the repository's git metadata (.git). ` +
          `The pipeline owns the repository's git state; change files in the working tree only.`,
      );
    }

    return target;
  }

  /*
   * Write a file at a target resolveForWrite returned, creating its parent
   * directories. The final component is opened without following a link.
   */
  public static async writeFile(
    target: WorkspaceTarget,
    content: string,
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(target.absolutePath), {
      recursive: true,
    });

    const handle: fs.promises.FileHandle = await fs.promises.open(
      target.absolutePath,
      WRITE_FLAGS,
      0o644,
    );

    try {
      await handle.writeFile(content, { encoding: "utf-8" });
    } finally {
      await handle.close();
    }
  }

  // Whether a workspace-relative path lies in a `.git` directory, any case.
  public static isInGitMetadata(relativePath: string): boolean {
    return relativePath.split(path.sep).some((segment: string) => {
      return segment.toLowerCase() === GIT_METADATA_DIRECTORY;
    });
  }

  /*
   * Walk the requested path one component at a time from the workspace's
   * real root, resolving every link on the way and refusing the walk the
   * moment it leaves the workspace. Components that do not exist yet (a
   * file or directory a write creates) are appended as text: nothing can
   * lie beyond them.
   */
  private static async resolveRealTarget(
    workspaceRoot: string,
    requestedPath: string,
  ): Promise<WorkspaceTarget> {
    // Text-level escapes (`..`, absolute paths elsewhere) are refused first.
    const lexicalPath: string = CodeAgentWorkspaceGuard.resolveWorkspacePath(
      workspaceRoot,
      requestedPath,
    );

    const realRoot: string = await fs.promises.realpath(
      path.resolve(workspaceRoot),
    );

    const segments: Array<string> = path
      .relative(path.resolve(workspaceRoot), lexicalPath)
      .split(path.sep)
      .filter((segment: string) => {
        return segment.length > 0;
      });

    let current: string = realRoot;

    for (let index: number = 0; index < segments.length; index++) {
      const next: string = path.join(current, segments[index] as string);

      let stats: fs.Stats;

      try {
        stats = await fs.promises.lstat(next);
      } catch (error) {
        const code: string | undefined = (error as NodeJS.ErrnoException).code;

        if (code === "ENOENT" || code === "ENOTDIR") {
          current = path.join(next, ...segments.slice(index + 1));
          break;
        }

        throw error;
      }

      if (stats.isSymbolicLink()) {
        let resolved: string;

        try {
          resolved = await fs.promises.realpath(next);
        } catch {
          throw this.outsideWorkspace(requestedPath);
        }

        if (!this.isWithin(realRoot, resolved)) {
          throw this.outsideWorkspace(requestedPath);
        }

        current = resolved;
        continue;
      }

      current = next;
    }

    if (!this.isWithin(realRoot, current)) {
      throw this.outsideWorkspace(requestedPath);
    }

    return {
      absolutePath: current,
      relativePath: path.relative(realRoot, current) || ".",
    };
  }

  private static isWithin(root: string, candidate: string): boolean {
    return candidate === root || candidate.startsWith(root + path.sep);
  }

  private static outsideWorkspace(requestedPath: string): BadDataException {
    return new BadDataException(
      `Refused: ${requestedPath} leads outside the workspace (through a link). ` +
        `Only files inside the repository can be read or written.`,
    );
  }
}
