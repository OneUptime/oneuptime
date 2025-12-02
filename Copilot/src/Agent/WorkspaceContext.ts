import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import Execute from "Common/Server/Utils/Execute";
import AgentLogger from "../Utils/AgentLogger";

/**
 * Produces human-readable snapshots of the current workspace, including git
 * metadata and directory listings, so the agent can reason about its
 * environment.
 */
export class WorkspaceContextBuilder {
  /**
   * Builds a multi-section textual snapshot describing the workspace root,
   * git branch/status, and top-level entries.
   */
  public static async buildSnapshot(workspaceRoot: string): Promise<string> {
    const absoluteRoot: string = path.resolve(workspaceRoot);
    const sections: Array<string> = [`Workspace root: ${absoluteRoot}`];
    AgentLogger.debug("Building workspace snapshot", {
      workspaceRoot: absoluteRoot,
    });

    const branch: string | null = await this.tryGitCommand(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      absoluteRoot,
    );
    if (branch) {
      sections.push(`Git branch: ${branch.trim()}`);
      AgentLogger.debug("Detected git branch", { branch: branch.trim() });
    }

    const status: string | null = await this.tryGitCommand(
      ["status", "-sb"],
      absoluteRoot,
    );
    if (status) {
      sections.push(`Git status:\n${status.trim()}`);
      AgentLogger.debug("Captured git status", {
        statusLength: status.length,
      });
    }

    const entries: Array<string> = await this.listTopLevelEntries(absoluteRoot);
    sections.push(
      `Top-level entries (${entries.length}): ${entries.join(", ")}`,
    );
    AgentLogger.debug("Listed top-level entries", {
      entryCount: entries.length,
    });

    const snapshot: string = sections.join("\n");
    AgentLogger.debug("Workspace snapshot complete", {
      sectionCount: sections.length,
      snapshotLength: snapshot.length,
    });
    return snapshot;
  }

  /**
   * Returns an ordered, filtered list of top-level files and directories while
   * hiding dotfiles and heavy folders like node_modules.
   */
  private static async listTopLevelEntries(
    root: string,
  ): Promise<Array<string>> {
    try {
      const dirEntries: Array<Dirent> = await fs.readdir(root, {
        withFileTypes: true,
      });
      return dirEntries
        .filter((entry: Dirent) => {
          return !entry.name.startsWith(".") && entry.name !== "node_modules";
        })
        .slice(0, 25)
        .map((entry: Dirent) => {
          return entry.isDirectory() ? `${entry.name}/` : entry.name;
        });
    } catch (error) {
      AgentLogger.error("Unable to list workspace entries", error as Error);
      return [];
    } finally {
      AgentLogger.debug("listTopLevelEntries completed", {
        root,
      });
    }
  }

  /**
   * Executes a git command and returns the trimmed output, swallowing errors so
   * snapshot generation never fails if git is unavailable.
   */
  private static async tryGitCommand(
    args: Array<string>,
    cwd: string,
  ): Promise<string | null> {
    try {
      const output: string = await Execute.executeCommandFile({
        command: "git",
        args,
        cwd,
      });
      AgentLogger.debug("Git command succeeded", {
        args,
        cwd,
        outputLength: output.length,
      });
      return output;
    } catch (error) {
      AgentLogger.debug("Git command failed", {
        cwd,
        args,
        error: (error as Error).message,
      });
      return null;
    }
  }
}
