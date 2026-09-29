import Execute from "Common/Server/Utils/Execute";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import path from "path";
import TaskLogger from "./TaskLogger";
import GitCredentials, { GitCredentialHandle } from "./GitCredentials";
import GitPorcelain, { GIT_STATUS_PORCELAIN_ARGS } from "./GitPorcelain";
import SecretRedactor from "./SecretRedactor";

export interface CloneResult {
  workingDirectory: string;
  repositoryPath: string;
  /*
   * The branch actually checked out. The pull request MUST target this and
   * not the repository record's stored default: a record whose
   * mainBranchName has gone stale (renamed, or never refreshed after the
   * repository switched from master to main) would otherwise produce a pull
   * request whose diff is every commit between the two branches.
   */
  baseBranch: string;
}

export interface RepositoryConfig {
  organizationName: string;
  repositoryName: string;
  token: string;
  repositoryUrl?: string;
  /*
   * The branch to cut the fix from and target with the pull request. When
   * absent, the remote's own default branch is resolved and used.
   */
  baseBranch?: string | undefined;
}

/*
 * Per-operation wall clocks. Every git command gets one: the code-fix loop
 * processes exactly one run at a time, so a single git command that hangs
 * (an unreachable host mid-transfer, a pathological repository, a hung
 * credential prompt) stalls every queued fix for the whole project until
 * the container is restarted, and the run's own 30-minute agent timeout
 * does not cover the clone that precedes it.
 */
const CLONE_TIMEOUT_MS: number = 10 * 60 * 1000;
const PUSH_TIMEOUT_MS: number = 5 * 60 * 1000;
const DEFAULT_GIT_TIMEOUT_MS: number = 60 * 1000;

// `git log`/`git status` on a large tree can exceed the 1 MB default.
const GIT_MAX_BUFFER_BYTES: number = 32 * 1024 * 1024;

export default class RepositoryManager {
  private logger: TaskLogger | null = null;

  public constructor(taskLogger?: TaskLogger) {
    if (taskLogger) {
      this.logger = taskLogger;
    }
  }

  /*
   * Clone a repository and check out the branch the pull request will
   * target.
   *
   * Authentication goes through a GIT_ASKPASS helper rather than a token
   * embedded in the URL, so the token never reaches argv (and therefore
   * never reaches a git error message, which this pipeline forwards to the
   * server as the run's status) and is never persisted to .git/config,
   * which the code agent can read for the whole of its run.
   */
  public async cloneRepository(
    config: RepositoryConfig,
    workDir: string,
  ): Promise<CloneResult> {
    await this.log(
      `Cloning repository ${config.organizationName}/${config.repositoryName}...`,
    );

    SecretRedactor.register(config.token, "repository-token");

    const remoteUrl: string = GitCredentials.buildRemoteUrl(config);

    await LocalFile.makeDirectory(workDir);

    /*
     * Clone into an explicit directory named for the repository rather than
     * letting git derive one from the URL. Two repositories in the same run
     * can share a name across organizations (acme/api and beta/api), and a
     * derived name would make the second clone fail on a non-empty
     * directory — losing that repository's fix entirely.
     */
    const directoryName: string = this.workspaceDirectoryName(config);
    const repositoryPath: string = path.join(workDir, directoryName);

    const credentials: GitCredentialHandle = await GitCredentials.create(
      config.token,
    );

    try {
      /*
       * Fetch only the branch being fixed. Full history is kept (builds and
       * tests legitimately read tags and history) but the other branches of
       * a large repository are pure transfer cost on a clone that is thrown
       * away at the end of the run.
       */
      const clone: (branch?: string | undefined) => Promise<void> = async (
        branch?: string,
      ): Promise<void> => {
        const cloneArgs: Array<string> = ["clone"];

        if (branch) {
          cloneArgs.push("--single-branch", "--branch", branch);
        }

        cloneArgs.push("--", remoteUrl, repositoryPath);

        await this.runGitCommand(workDir, cloneArgs, {
          timeoutInMS: CLONE_TIMEOUT_MS,
          env: credentials.env,
        });
      };

      try {
        await clone(config.baseBranch);
      } catch (error) {
        /*
         * The requested branch does not exist on the remote — the stored
         * mainBranchName is stale (the repository was renamed from master
         * to main, or the record predates a default-branch change). Falling
         * back to the remote's own default is strictly better than failing
         * the run: the fix still gets attempted, and the pull request
         * targets whatever was actually checked out.
         */
        if (!config.baseBranch) {
          throw error;
        }

        await this.log(
          `Branch "${config.baseBranch}" was not found on the remote — cloning the repository's default branch instead.`,
        );

        await LocalFile.deleteDirectory(repositoryPath).catch(() => {
          // A failed clone may not have created the directory at all.
        });

        await clone();
      }
    } finally {
      await credentials.dispose();
    }

    /*
     * Whatever git actually checked out is the truth. When the caller named
     * a base branch this is that branch; when it did not, this is the
     * remote's own default — which is the correct pull-request base either
     * way, and is resolved here rather than trusted from a stored column.
     */
    const baseBranch: string = await this.getCurrentBranch(repositoryPath);

    await this.log(
      `Repository cloned to ${repositoryPath} (base ${baseBranch})`,
    );

    await this.setGitConfig(repositoryPath);

    return {
      workingDirectory: workDir,
      repositoryPath: repositoryPath,
      baseBranch,
    };
  }

  /*
   * A filesystem-safe, collision-free directory name for one repository in
   * a shared workspace. Organization-qualified because repository names are
   * only unique within an organization.
   */
  private workspaceDirectoryName(config: RepositoryConfig): string {
    const sanitize: (value: string) => string = (value: string): string => {
      return value.replace(/[^A-Za-z0-9._-]/g, "-");
    };

    return `${sanitize(config.organizationName)}__${sanitize(config.repositoryName)}`;
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
    } catch {
      // Branch doesn't exist, create it
      await this.createBranch(repoPath, branchName);
    }
  }

  // Add all changes to staging
  public async addAllChanges(repoPath: string): Promise<void> {
    await this.log("Adding all changes to git staging...");

    await this.runGitCommand(repoPath, ["add", "-A"]);
  }

  /*
   * Stage an explicit set of paths. Used by the fix pipelines instead of
   * addAllChanges once the repository's own build/test commands have run in
   * the workspace: `git add -A` would sweep whatever those commands emitted
   * (build output, caches, lockfile churn) into the pull request as part of
   * the "fix", and the target repository's .gitignore is not ours to rely
   * on. Paths are passed after `--` so a filename can never be read as a
   * flag.
   *
   * Paths that no longer resolve are dropped first. The path list is a
   * snapshot taken before the repository's verification commands ran, and a
   * build step legitimately deletes files that existed when the snapshot
   * was taken. `git add` treats a pathspec that matches nothing as a fatal
   * error, so one such path would abort the whole repository with the fix
   * already written but never committed or pushed.
   */
  public async addPaths(repoPath: string, paths: Array<string>): Promise<void> {
    const uniquePaths: Array<string> = Array.from(
      new Set(
        paths.filter((path: string) => {
          return path.trim().length > 0;
        }),
      ),
    );

    if (uniquePaths.length === 0) {
      return;
    }

    const stageablePaths: Array<string> = await this.filterStageablePaths(
      repoPath,
      uniquePaths,
    );

    if (stageablePaths.length === 0) {
      await this.log("No stageable paths remain — nothing to stage.");
      return;
    }

    if (stageablePaths.length < uniquePaths.length) {
      await this.log(
        `Staging ${stageablePaths.length} path(s); ${
          uniquePaths.length - stageablePaths.length
        } no longer exist and were skipped.`,
      );
    } else {
      await this.log(`Staging ${stageablePaths.length} path(s)...`);
    }

    /*
     * `--all` so a path that is now deleted stages its deletion rather than
     * being silently skipped — an agent that removes a file as part of the
     * fix must have that removal in the commit.
     */
    await this.runGitCommand(repoPath, [
      "add",
      "--all",
      "--",
      ...stageablePaths,
    ]);
  }

  /*
   * Keep only the paths `git add` can resolve: those still present in the
   * working tree, plus those absent from it but still tracked in the index
   * (a deletion that must be staged). Tracked-ness is resolved in a single
   * git call, and only for the paths that are actually missing on disk.
   */
  private async filterStageablePaths(
    repoPath: string,
    paths: Array<string>,
  ): Promise<Array<string>> {
    const present: Array<string> = [];
    const missing: Array<string> = [];

    for (const relativePath of paths) {
      const exists: boolean = await LocalFile.doesFileExist(
        path.join(repoPath, relativePath),
      );

      if (exists) {
        present.push(relativePath);
      } else {
        missing.push(relativePath);
      }
    }

    if (missing.length === 0) {
      return present;
    }

    try {
      const tracked: string = await this.runGitCommand(repoPath, [
        "ls-files",
        "-z",
        "--",
        ...missing,
      ]);

      const trackedPaths: Array<string> = tracked
        .split("\0")
        .filter((entry: string) => {
          return entry.length > 0;
        });

      return [...present, ...trackedPaths];
    } catch (error) {
      logger.warn(
        `Could not resolve tracked state for missing paths: ${SecretRedactor.redactError(error)}`,
      );
      return present;
    }
  }

  // Check if there are any changes to commit
  public async hasChanges(repoPath: string): Promise<boolean> {
    try {
      const status: string = await this.runGitCommand(
        repoPath,
        GIT_STATUS_PORCELAIN_ARGS,
      );
      return GitPorcelain.dirtyPaths(status).length > 0;
    } catch (error) {
      logger.error("Error checking for changes:", {
        repoPath,
      } as LogAttributes);
      logger.error(SecretRedactor.redactError(error), {
        repoPath,
      } as LogAttributes);
      return false;
    }
  }

  // Whether anything is staged and would therefore produce a commit.
  public async hasStagedChanges(repoPath: string): Promise<boolean> {
    try {
      await this.runGitCommand(repoPath, [
        "diff",
        "--cached",
        "--quiet",
        "--exit-code",
      ]);
      // Exit 0 means no staged differences.
      return false;
    } catch {
      /*
       * `--exit-code` makes git exit 1 when there IS a difference, which
       * Execute surfaces as a rejection. That is the signal, not a failure.
       */
      return true;
    }
  }

  /*
   * Every dirty path in the working tree.
   *
   * Parsed by GitPorcelain rather than by slicing characters off lines:
   * renames, paths containing spaces or quotes, and files inside newly
   * created directories all come out of naive parsing as strings `git add`
   * rejects — which aborts the repository and loses the pull request.
   */
  public async getChangedFiles(repoPath: string): Promise<Array<string>> {
    const status: string = await this.runGitCommand(
      repoPath,
      GIT_STATUS_PORCELAIN_ARGS,
    );

    return GitPorcelain.dirtyPaths(status);
  }

  /*
   * Commit the staged changes.
   *
   * `--no-verify` because the repository's own hooks are not ours to run: a
   * setup command like `npm ci` installs husky, which points core.hooksPath
   * at the repository's committed hooks, and those hooks then run inside
   * this commit — where a lint-staged hook can rewrite the very files being
   * committed, or a failing pre-commit hook aborts the fix outright. Hooks
   * are the target repository's CI concern, and its CI will run them on the
   * pull request.
   */
  public async commitChanges(repoPath: string, message: string): Promise<void> {
    await this.log(`Committing changes: ${message.substring(0, 50)}...`);

    await this.runGitCommand(repoPath, [
      "commit",
      "--no-verify",
      "-m",
      message,
    ]);

    await this.log("Changes committed successfully");
  }

  /*
   * Push the branch.
   *
   * The remote keeps its credential-free URL; authentication is supplied
   * for this one command through the askpass environment, so nothing
   * authenticated is ever written to .git/config.
   */
  public async pushBranch(
    repoPath: string,
    branchName: string,
    config: RepositoryConfig,
  ): Promise<void> {
    await this.log(`Pushing branch ${branchName} to remote...`);

    SecretRedactor.register(config.token, "repository-token");

    const credentials: GitCredentialHandle = await GitCredentials.create(
      config.token,
    );

    try {
      await this.runGitCommand(
        repoPath,
        ["remote", "set-url", "origin", GitCredentials.buildRemoteUrl(config)],
        { env: credentials.env },
      );

      await this.runGitCommand(repoPath, ["push", "-u", "origin", branchName], {
        timeoutInMS: PUSH_TIMEOUT_MS,
        env: credentials.env,
      });
    } finally {
      await credentials.dispose();
    }

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

  /*
   * Discard every local change, staged or not.
   *
   * `git checkout .` (the previous implementation) restores tracked files
   * from the INDEX, so it leaves staged changes staged and untracked files
   * in place — "discard" that discards nothing when something is already
   * staged. `reset --hard` plus `clean -fd` is the operation this name
   * promises.
   */
  public async discardChanges(repoPath: string): Promise<void> {
    await this.log("Discarding all local changes...");

    await this.runGitCommand(repoPath, ["reset", "--hard", "HEAD"]);
    await this.runGitCommand(repoPath, ["clean", "-fd"]);
  }

  // Clean up the repository directory
  public async cleanup(workDir: string): Promise<void> {
    await this.log(`Cleaning up workspace: ${workDir}`);

    try {
      await LocalFile.deleteDirectory(workDir);
      await this.log("Workspace cleaned up successfully");
    } catch (error) {
      logger.error(`Error cleaning up workspace ${workDir}:`, {
        workDir,
      } as LogAttributes);
      logger.error(SecretRedactor.redactError(error), {
        workDir,
      } as LogAttributes);
    }
  }

  // Get diff of current changes
  public async getDiff(repoPath: string): Promise<string> {
    try {
      const diff: string = await this.runGitCommand(repoPath, ["diff"]);
      return diff;
    } catch (error) {
      logger.error("Error getting diff:", { repoPath } as LogAttributes);
      logger.error(SecretRedactor.redactError(error), {
        repoPath,
      } as LogAttributes);
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
      logger.error("Error getting staged diff:", { repoPath } as LogAttributes);
      logger.error(SecretRedactor.redactError(error), {
        repoPath,
      } as LogAttributes);
      return "";
    }
  }

  /*
   * Run one git command.
   *
   * Two things every call depends on:
   *   - a timeout, so no git command can wedge the strictly-serial code-fix
   *     loop indefinitely;
   *   - a redacted rejection. Node's execFile puts the whole command line
   *     into the Error message, and the task handlers forward that message
   *     to the server as the run's statusMessage, where it is stored and
   *     displayed. Re-throwing a redacted Error is what keeps a credential
   *     that reached argv by any route out of the database.
   */
  private async runGitCommand(
    repoPath: string,
    args: Array<string>,
    options?: {
      timeoutInMS?: number | undefined;
      env?: Record<string, string> | undefined;
    },
  ): Promise<string> {
    const cwd: string = path.resolve(repoPath);

    logger.debug(
      SecretRedactor.redact(
        `Executing git command in ${cwd}: git ${args.join(" ")}`,
      ),
      {
        repoPath: cwd,
      } as LogAttributes,
    );

    try {
      return await Execute.executeCommandFile({
        command: "git",
        args,
        cwd,
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        timeoutInMS: options?.timeoutInMS ?? DEFAULT_GIT_TIMEOUT_MS,
        ...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
      });
    } catch (error) {
      throw new Error(SecretRedactor.redactError(error));
    }
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
