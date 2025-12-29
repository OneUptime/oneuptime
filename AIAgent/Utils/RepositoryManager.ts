import Execute from "Common/Server/Utils/Execute";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import path from "path";
import TaskLogger from "./TaskLogger";

export interface CloneResult {
  workingDirectory: string;
  repositoryPath: string;
}

export interface RepositoryConfig {
  organizationName: string;
  repositoryName: string;
  token: string;
  repositoryUrl?: string;
}

export default class RepositoryManager {
  private logger: TaskLogger | null = null;

  public constructor(taskLogger?: TaskLogger) {
    if (taskLogger) {
      this.logger = taskLogger;
    }
  }

  // Clone a repository with token-based authentication
  public async cloneRepository(
    config: RepositoryConfig,
    workDir: string,
  ): Promise<CloneResult> {
    await this.log(
      `Cloning repository ${config.organizationName}/${config.repositoryName}...`,
    );

    // Build the authenticated URL
    const authUrl: string = this.buildAuthenticatedUrl(config);

    // Ensure the working directory exists
    await LocalFile.makeDirectory(workDir);

    // Clone the repository
    await this.runGitCommand(workDir, ["clone", authUrl]);

    const repositoryPath: string = path.join(workDir, config.repositoryName);

    await this.log(`Repository cloned to ${repositoryPath}`);

    // Set git config for the repository
    await this.setGitConfig(repositoryPath);

    return {
      workingDirectory: workDir,
      repositoryPath: repositoryPath,
    };
  }

  // Build URL with embedded token for authentication
  private buildAuthenticatedUrl(config: RepositoryConfig): string {
    if (config.repositoryUrl) {
      // If URL is provided, inject token
      const url: URL = new URL(config.repositoryUrl);
      url.username = "x-access-token";
      url.password = config.token;
      return url.toString();
    }

    // Default to GitHub
    return `https://x-access-token:${config.token}@github.com/${config.organizationName}/${config.repositoryName}.git`;
  }

  // Set git user config for commits
  private async setGitConfig(repoPath: string): Promise<void> {
    await this.runGitCommand(repoPath, [
      "config",
      "user.name",
      "OneUptime AI Agent",
    ]);

    await this.runGitCommand(repoPath, [
      "config",
      "user.email",
      "ai-agent@oneuptime.com",
    ]);
  }

  // Create a new branch
  public async createBranch(
    repoPath: string,
    branchName: string,
  ): Promise<void> {
    await this.log(`Creating branch: ${branchName}`);

    await this.runGitCommand(repoPath, ["checkout", "-b", branchName]);

    await this.log(`Branch ${branchName} created and checked out`);
  }

  // Checkout existing branch
  public async checkoutBranch(
    repoPath: string,
    branchName: string,
  ): Promise<void> {
    await this.log(`Checking out branch: ${branchName}`);

    await this.runGitCommand(repoPath, ["checkout", branchName]);
  }

  // Create branch if doesn't exist, or checkout if it does
  public async createOrCheckoutBranch(
    repoPath: string,
    branchName: string,
  ): Promise<void> {
    try {
      // Check if branch exists locally
      await this.runGitCommand(repoPath, ["rev-parse", "--verify", branchName]);
      await this.checkoutBranch(repoPath, branchName);
    } catch (error) {
      // Branch doesn't exist, create it
      await this.createBranch(repoPath, branchName);
    }
  }

  // Add all changes to staging
  public async addAllChanges(repoPath: string): Promise<void> {
    await this.log("Adding all changes to git staging...");

    await this.runGitCommand(repoPath, ["add", "-A"]);
  }

  // Check if there are any changes to commit
  public async hasChanges(repoPath: string): Promise<boolean> {
    try {
      const status: string = await this.runGitCommand(repoPath, [
        "status",
        "--porcelain",
      ]);
      return status.trim().length > 0;
    } catch (error) {
      logger.error("Error checking for changes:");
      logger.error(error);
      return false;
    }
  }

  // Get list of changed files
  public async getChangedFiles(repoPath: string): Promise<Array<string>> {
    const status: string = await this.runGitCommand(repoPath, [
      "status",
      "--porcelain",
    ]);

    if (!status.trim()) {
      return [];
    }

    return status
      .split("\n")
      .filter((line: string) => {
        return line.trim().length > 0;
      })
      .map((line: string) => {
        // Status output format is "XY filename" where XY is the status
        return line.substring(3).trim();
      });
  }

  // Commit changes
  public async commitChanges(repoPath: string, message: string): Promise<void> {
    await this.log(`Committing changes: ${message.substring(0, 50)}...`);

    await Execute.executeCommandFile({
      command: "git",
      args: ["commit", "-m", message],
      cwd: repoPath,
    });

    await this.log("Changes committed successfully");
  }

  // Push branch to remote
  public async pushBranch(
    repoPath: string,
    branchName: string,
    config: RepositoryConfig,
  ): Promise<void> {
    await this.log(`Pushing branch ${branchName} to remote...`);

    // Set the remote URL with authentication
    const authUrl: string = this.buildAuthenticatedUrl(config);

    // Update the remote URL
    await this.runGitCommand(repoPath, [
      "remote",
      "set-url",
      "origin",
      authUrl,
    ]);

    // Push with tracking
    await this.runGitCommand(repoPath, ["push", "-u", "origin", branchName]);

    await this.log(`Branch ${branchName} pushed to remote`);
  }

  // Get the current branch name
  public async getCurrentBranch(repoPath: string): Promise<string> {
    const branch: string = await this.runGitCommand(repoPath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    return branch.trim();
  }

  // Get the current commit hash
  public async getCurrentCommitHash(repoPath: string): Promise<string> {
    const hash: string = await this.runGitCommand(repoPath, [
      "rev-parse",
      "HEAD",
    ]);
    return hash.trim();
  }

  // Pull latest changes from remote
  public async pullChanges(repoPath: string): Promise<void> {
    await this.log("Pulling latest changes from remote...");

    await this.runGitCommand(repoPath, ["pull"]);
  }

  // Discard all local changes
  public async discardChanges(repoPath: string): Promise<void> {
    await this.log("Discarding all local changes...");

    await this.runGitCommand(repoPath, ["checkout", "."]);
    await this.runGitCommand(repoPath, ["clean", "-fd"]);
  }

  // Clean up the repository directory
  public async cleanup(workDir: string): Promise<void> {
    await this.log(`Cleaning up workspace: ${workDir}`);

    try {
      await LocalFile.deleteDirectory(workDir);
      await this.log("Workspace cleaned up successfully");
    } catch (error) {
      logger.error(`Error cleaning up workspace ${workDir}:`);
      logger.error(error);
    }
  }

  // Get diff of current changes
  public async getDiff(repoPath: string): Promise<string> {
    try {
      const diff: string = await this.runGitCommand(repoPath, ["diff"]);
      return diff;
    } catch (error) {
      logger.error("Error getting diff:");
      logger.error(error);
      return "";
    }
  }

  // Get staged diff
  public async getStagedDiff(repoPath: string): Promise<string> {
    try {
      const diff: string = await this.runGitCommand(repoPath, [
        "diff",
        "--staged",
      ]);
      return diff;
    } catch (error) {
      logger.error("Error getting staged diff:");
      logger.error(error);
      return "";
    }
  }

  // Helper method to run git commands
  private async runGitCommand(
    repoPath: string,
    args: Array<string>,
  ): Promise<string> {
    const cwd: string = path.resolve(repoPath);

    const logArgs: Array<string> = args.map((arg: string) => {
      // Mask tokens in URLs
      if (arg.includes("x-access-token:")) {
        return arg.replace(/x-access-token:[^@]+@/, "x-access-token:***@");
      }
      return arg.includes(" ") ? `"${arg}"` : arg;
    });

    logger.debug(`Executing git command in ${cwd}: git ${logArgs.join(" ")}`);

    return Execute.executeCommandFile({
      command: "git",
      args,
      cwd,
    });
  }

  // Helper method for logging
  private async log(message: string): Promise<void> {
    if (this.logger) {
      await this.logger.info(message);
    } else {
      logger.debug(message);
    }
  }
}
