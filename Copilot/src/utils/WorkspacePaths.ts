import path from "node:path";
import fs from "node:fs/promises";
import LocalFile from "Common/Server/Utils/LocalFile";
import BadDataException from "Common/Types/Exception/BadDataException";
import AgentLogger from "./AgentLogger";

export class WorkspacePaths {
  private readonly root: string;

  public constructor(workspaceRoot: string) {
    this.root = path.resolve(workspaceRoot);
  }

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

  public getRoot(): string {
    return this.root;
  }

  public async ensureParentDirectory(targetFile: string): Promise<void> {
    const parentDir: string = path.dirname(targetFile);
    if (!(await LocalFile.doesDirectoryExist(parentDir))) {
      AgentLogger.debug("Creating parent directory", {
        parentDir,
      });
      await fs.mkdir(parentDir, { recursive: true });
    }
  }

  private isInsideWorkspace(target: string): boolean {
    const normalizedTarget: string = path.resolve(target);
    return (
      normalizedTarget === this.root ||
      normalizedTarget.startsWith(this.root + path.sep)
    );
  }
}
