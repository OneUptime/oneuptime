import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
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

  // Create a new workspace for a task
  public static async createWorkspace(taskId: string): Promise<WorkspaceInfo> {
    const timestamp: number = Date.now();
    const uniqueId: string = ObjectID.generate().toString().substring(0, 8);
    const workspaceName: string = `task-${taskId}-${timestamp}-${uniqueId}`;
    const workspacePath: string = path.join(this.BASE_TEMP_DIR, workspaceName);

    logger.debug(`Creating workspace: ${workspacePath}`);

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
    logger.debug(`Deleting workspace: ${workspacePath}`);

    try {
      // Verify the path is within our temp directory to prevent accidental deletion
      const normalizedPath: string = path.normalize(workspacePath);
      const normalizedBase: string = path.normalize(this.BASE_TEMP_DIR);

      if (!normalizedPath.startsWith(normalizedBase)) {
        throw new Error(
          `Security error: Cannot delete path outside workspace base: ${workspacePath}`,
        );
      }

      await LocalFile.deleteDirectory(workspacePath);
      logger.debug(`Workspace deleted: ${workspacePath}`);
    } catch (error) {
      logger.error(`Error deleting workspace ${workspacePath}:`);
      logger.error(error);
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
    logger.debug(`Cleaning up workspaces older than ${maxAgeHours} hours`);

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

        /*
         * Try to extract timestamp from directory name
         * Format: task-{taskId}-{timestamp}-{uniqueId}
         */
        const match: RegExpMatchArray | null = entry.name.match(
          /task-[^-]+-(\d+)-[^-]+/,
        );

        if (match) {
          const timestamp: number = parseInt(match[1] || "0", 10);

          if (now - timestamp > maxAge) {
            await this.deleteWorkspace(workspacePath);
            cleanedCount++;
          }
        }
      }
    } catch (error) {
      logger.error("Error during workspace cleanup:");
      logger.error(error);
    }

    logger.debug(`Cleaned up ${cleanedCount} old workspaces`);

    return cleanedCount;
  }

  // Initialize workspace manager (create base directory if needed)
  public static async initialize(): Promise<void> {
    try {
      await LocalFile.makeDirectory(this.BASE_TEMP_DIR);
      logger.debug(
        `Workspace base directory initialized: ${this.BASE_TEMP_DIR}`,
      );
    } catch (error) {
      logger.error("Error initializing workspace manager:");
      logger.error(error);
    }
  }

  // Get the base temp directory path
  public static getBaseTempDir(): string {
    return this.BASE_TEMP_DIR;
  }
}
