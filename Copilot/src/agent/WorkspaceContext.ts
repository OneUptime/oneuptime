import fs from "node:fs/promises";
import path from "node:path";
import Execute from "Common/Server/Utils/Execute";
import logger from "Common/Server/Utils/Logger";

export class WorkspaceContextBuilder {
  public static async buildSnapshot(workspaceRoot: string): Promise<string> {
    const absoluteRoot: string = path.resolve(workspaceRoot);
    const sections: Array<string> = [`Workspace root: ${absoluteRoot}`];

    const branch: string | null = await this.tryGitCommand(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      absoluteRoot,
    );
    if (branch) {
      sections.push(`Git branch: ${branch.trim()}`);
    }

    const status: string | null = await this.tryGitCommand(
      ["status", "-sb"],
      absoluteRoot,
    );
    if (status) {
      sections.push(`Git status:\n${status.trim()}`);
    }

    const entries: Array<string> = await this.listTopLevelEntries(absoluteRoot);
    sections.push(`Top-level entries (${entries.length}): ${entries.join(", ")}`);

    return sections.join("\n");
  }

  private static async listTopLevelEntries(root: string): Promise<Array<string>> {
    try {
      const dirEntries = await fs.readdir(root, { withFileTypes: true });
      return dirEntries
        .filter((entry) => {
          return !entry.name.startsWith(".") && entry.name !== "node_modules";
        })
        .slice(0, 25)
        .map((entry) => {
          return entry.isDirectory() ? `${entry.name}/` : entry.name;
        });
    } catch (error) {
      logger.error("Unable to list workspace entries");
      logger.error(error);
      return [];
    }
  }

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
      return output;
    } catch (error) {
      logger.debug(
        `Git command failed in ${cwd}: git ${args.join(" ")} (${(error as Error).message})`,
      );
      return null;
    }
  }
}
