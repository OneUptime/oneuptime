import LocalFile from "Common/Server/Utils/LocalFile";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import path from "path";
import os from "os";

export interface WorkspaceInfo {
  workspacePath: string;
  taskId: string;
  createdAt: Date;
}

export default class WorkspaceManager {
  private static readonly BASE_TEMP_DIR: string = path.join(
    os.tmpdir(),
    "oneuptime-ai-agent",
  );

  /*
   * Directory-name shape: `task-<timestamp>-<taskId>-<uniqueId>`.
   *
   * The timestamp comes FIRST and is followed by a separator that cannot
   * occur inside it, because cleanupOldWorkspaces has to read the age back
   * out of the name. The previous layout put the task id first, and a task
   * id is a UUID — which contains hyphens, so the pattern that expected a
   * single hyphen-free field never matched a single real workspace and the
   * sweeper silently reaped nothing. Every workspace a killed Runner left
   * behind (a full repository clone each) stayed on disk forever.
   */
  private static readonly WORKSPACE_NAME_PREFIX: string = "task-";

  // Create a new workspace for a task
  public static async createWorkspace(taskId: string): Promise<WorkspaceInfo> {
    const timestamp: number = Date.now();
    const uniqueId: string = ObjectID.generate().toString().substring(0, 8);
    const workspaceName: string = `${this.WORKSPACE_NAME_PREFIX}${timestamp}-${taskId}-${uniqueId}`;
    const workspacePath: string = path.join(this.BASE_TEMP_DIR, workspaceName);

    logger.debug(`Creating workspace: ${workspacePath}`, {
      taskId,
    } as LogAttributes);

    // Create the workspace directory
    await LocalFile.makeDirectory(workspacePath);

    return {
      workspacePath,
      taskId,
      createdAt: new Date(),
    };
  }

  // Create a subdirectory within a workspace
  public static async createSubdirectory(
    workspacePath: string,
    subdirectoryName: string,
  ): Promise<string> {
    const subdirectoryPath: string = path.join(workspacePath, subdirectoryName);
    await LocalFile.makeDirectory(subdirectoryPath);
    return subdirectoryPath;
  }

  // Check if workspace exists
  public static async workspaceExists(workspacePath: string): Promise<boolean> {
    try {
      await LocalFile.readDirectory(workspacePath);
      return true;
    } catch {
      return false;
    }
  }

  // Delete a workspace and all its contents
  public static async deleteWorkspace(workspacePath: string): Promise<void> {
    logger.debug(`Deleting workspace: ${workspacePath}`, {
      workspacePath,
    } as LogAttributes);

    try {
      /*
       * Verify the path is within our temp directory to prevent accidental
       * deletion. The separator is load-bearing: a bare
       * `startsWith(base)` also accepts every SIBLING whose name merely
       * starts with the base name — `/tmp/oneuptime-ai-agent-backup` passes
       * a prefix test against `/tmp/oneuptime-ai-agent` and would be
       * recursively deleted. (CodeAgentWorkspaceGuard.resolveWorkspacePath
       * already guards its paths this way; this is the same rule.)
       */
      const normalizedPath: string = path.resolve(workspacePath);
      const normalizedBase: string = path.resolve(this.BASE_TEMP_DIR);

      if (
        normalizedPath !== normalizedBase &&
        !normalizedPath.startsWith(normalizedBase + path.sep)
      ) {
        throw new Error(
          `Security error: Cannot delete path outside workspace base: ${workspacePath}`,
        );
      }

      await LocalFile.deleteDirectory(workspacePath);
      logger.debug(`Workspace deleted: ${workspacePath}`, {
        workspacePath,
      } as LogAttributes);
    } catch (error) {
      logger.error(`Error deleting workspace ${workspacePath}:`, {
        workspacePath,
      } as LogAttributes);
      logger.error(error, { workspacePath } as LogAttributes);
    }
  }

  // Write a file to workspace
  public static async writeFile(
    workspacePath: string,
    relativePath: string,
    content: string,
  ): Promise<string> {
    const filePath: string = path.join(workspacePath, relativePath);

    // Ensure parent directory exists
    const parentDir: string = path.dirname(filePath);
    await LocalFile.makeDirectory(parentDir);

    await LocalFile.write(filePath, content);

    return filePath;
  }

  // Read a file from workspace
  public static async readFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<string> {
    const filePath: string = path.join(workspacePath, relativePath);
    return LocalFile.read(filePath);
  }

  // Check if a file exists in workspace
  public static async fileExists(
    workspacePath: string,
    relativePath: string,
  ): Promise<boolean> {
    try {
      const filePath: string = path.join(workspacePath, relativePath);
      await LocalFile.read(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Delete a file from workspace
  public static async deleteFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<void> {
    const filePath: string = path.join(workspacePath, relativePath);
    await LocalFile.deleteFile(filePath);
  }

  // List files in workspace directory
  public static async listFiles(workspacePath: string): Promise<Array<string>> {
    const entries: Array<{ name: string; isDirectory(): boolean }> =
      await LocalFile.readDirectory(workspacePath);
    return entries.map((entry: { name: string }) => {
      return entry.name;
    });
  }

  // Get the full path for a relative path in workspace
  public static getFullPath(
    workspacePath: string,
    relativePath: string,
  ): string {
    return path.join(workspacePath, relativePath);
  }

  // Clean up old workspaces (older than specified hours)
  public static async cleanupOldWorkspaces(
    maxAgeHours: number = 24,
  ): Promise<number> {
    logger.debug(
      `Cleaning up workspaces older than ${maxAgeHours} hours`,
      {} as LogAttributes,
    );

    let cleanedCount: number = 0;

    try {
      // Ensure base directory exists
      try {
        await LocalFile.readDirectory(this.BASE_TEMP_DIR);
      } catch {
        // Base directory doesn't exist, nothing to clean
        return 0;
      }

      const entries: Array<{ name: string; isDirectory(): boolean }> =
        await LocalFile.readDirectory(this.BASE_TEMP_DIR);

      const maxAge: number = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds
      const now: number = Date.now();

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const workspacePath: string = path.join(this.BASE_TEMP_DIR, entry.name);

        const timestamp: number | null = this.timestampFromWorkspaceName(
          entry.name,
        );

        if (timestamp !== null && now - timestamp > maxAge) {
          await this.deleteWorkspace(workspacePath);
          cleanedCount++;
        }
      }
    } catch (error) {
      logger.error("Error during workspace cleanup:", {} as LogAttributes);
      logger.error(error, {} as LogAttributes);
    }

    logger.debug(
      `Cleaned up ${cleanedCount} old workspaces`,
      {} as LogAttributes,
    );

    return cleanedCount;
  }

  /*
   * The creation time encoded in a workspace directory name, or null when
   * the name is not one of ours.
   *
   * Anchored at the start and reading the timestamp as the FIRST field:
   * everything after it is a task id and a unique suffix, whose contents
   * (a UUID, with hyphens) must not have to be parsed at all.
   */
  public static timestampFromWorkspaceName(name: string): number | null {
    const match: RegExpMatchArray | null = name.match(
      new RegExp(`^${this.WORKSPACE_NAME_PREFIX}(\\d+)-`),
    );

    if (!match || !match[1]) {
      return null;
    }

    const timestamp: number = parseInt(match[1], 10);

    return Number.isFinite(timestamp) ? timestamp : null;
  }

  // Initialize workspace manager (create base directory if needed)
  public static async initialize(): Promise<void> {
    try {
      await LocalFile.makeDirectory(this.BASE_TEMP_DIR);
      logger.debug(
        `Workspace base directory initialized: ${this.BASE_TEMP_DIR}`,
        {} as LogAttributes,
      );
    } catch (error) {
      logger.error(
        "Error initializing workspace manager:",
        {} as LogAttributes,
      );
      logger.error(error, {} as LogAttributes);
    }
  }

  // Get the base temp directory path
  public static getBaseTempDir(): string {
    return this.BASE_TEMP_DIR;
  }
}
