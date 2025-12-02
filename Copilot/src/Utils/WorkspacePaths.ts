import path from "node:path";
import fs from "node:fs/promises";
import LocalFile from "Common/Server/Utils/LocalFile";
import BadDataException from "Common/Types/Exception/BadDataException";
import AgentLogger from "./AgentLogger";

/** Utility helpers for resolving and validating paths inside the workspace. */
export class WorkspacePaths {
  private readonly root: string;

  /** Stores the canonical workspace root for all future resolutions. */
  public constructor(workspaceRoot: string) {
    this.root = path.resolve(workspaceRoot);
  }

  /**
   * Resolves a candidate path relative to the workspace root while ensuring the
   * result never escapes the allowed directory tree.
   */
  public resolve(candidate: string): string {
    const sanitizedCandidate: string = candidate.trim() || ".";
    const absolutePath: string = path.resolve(this.root, sanitizedCandidate);
    AgentLogger.debug("Resolving workspace path", {
      candidate,
      sanitizedCandidate,
      absolutePath,
    });

    if (!this.isInsideWorkspace(absolutePath)) {
      AgentLogger.error("Path outside workspace", {
        candidate,
        absolutePath,
        workspaceRoot: this.root,
      });
      throw new BadDataException(
        `Path ${candidate} is outside the workspace root ${this.root}`,
      );
    }

    return absolutePath;
  }

  /** Returns the workspace-relative path for a given absolute target. */
  public relative(target: string): string {
    const absolute: string = path.resolve(target);
    const relativePath: string = path.relative(this.root, absolute) || ".";
    AgentLogger.debug("Computed relative path", {
      target,
      absolute,
      relativePath,
    });
    return relativePath;
  }

  /** Exposes the normalized workspace root path. */
  public getRoot(): string {
    return this.root;
  }

  /** Creates parent directories as needed for a file inside the workspace. */
  public async ensureParentDirectory(targetFile: string): Promise<void> {
    const parentDir: string = path.dirname(targetFile);
    if (!(await LocalFile.doesDirectoryExist(parentDir))) {
      AgentLogger.debug("Creating parent directory", {
        parentDir,
      });
      await fs.mkdir(parentDir, { recursive: true });
    }
  }

  /** Ensures the provided absolute path is within the workspace root. */
  private isInsideWorkspace(target: string): boolean {
    const normalizedTarget: string = path.resolve(target);
    return (
      normalizedTarget === this.root ||
      normalizedTarget.startsWith(this.root + path.sep)
    );
  }
}
