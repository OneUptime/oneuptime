import path from "path";
import fs from "fs";
import Execute from "../Execute";
import LocalFile from "../LocalFile";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CodeRepositoryFile from "./CodeRepositoryFile";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";

export default class CodeRepositoryUtil {
  @CaptureSpan()
  public static getCurrentCommitHash(data: {
    repoPath: string;
  }): Promise<string> {
    return this.runGitCommand(data.repoPath, ["rev-parse", "HEAD"]);
  }

  @CaptureSpan()
  public static async addAllChangedFilesToGit(data: {
    repoPath: string;
  }): Promise<void> {
    await this.runGitCommand(data.repoPath, ["add", "-A"]);
  }

  @CaptureSpan()
  public static async setAuthorIdentity(data: {
    repoPath: string;
    authorName: string;
    authorEmail: string;
  }): Promise<void> {
    await this.runGitCommand(data.repoPath, [
      "config",
      "--global",
      "user.name",
      data.authorName,
    ]);

    await this.runGitCommand(data.repoPath, [
      "config",
      "--global",
      "user.email",
      data.authorEmail,
    ]);
  }

  @CaptureSpan()
  public static async discardAllChangesOnCurrentBranch(data: {
    repoPath: string;
  }): Promise<void> {
    await this.runGitCommand(data.repoPath, ["checkout", "."]);
  }

  // returns the folder name of the cloned repository
  @CaptureSpan()
  public static async cloneRepository(data: {
    repoPath: string;
    repoUrl: string;
  }): Promise<string> {
    await this.runGitCommand(data.repoPath, ["clone", data.repoUrl]);

    const normalizedUrl: string = data.repoUrl.trim().replace(/\/+$/g, "");
    const lastSegment: string =
      normalizedUrl.split("/").pop() || normalizedUrl.split(":").pop() || "";
    const folderName: string = lastSegment.replace(/\.git$/i, "");

    if (!folderName) {
      throw new BadDataException(
        "Unable to determine repository folder name after cloning.",
      );
    }

    return folderName.trim();
  }

  @CaptureSpan()
  public static async pullChanges(data: { repoPath: string }): Promise<void> {
    // Add the repository to safe.directory to avoid "dubious ownership" errors
    // This is needed when running in containers where the repo may be owned by a different user
    await this.runGitCommand(data.repoPath, [
      "config",
      "--global",
      "--add",
      "safe.directory",
      path.resolve(data.repoPath),
    ]);
    await this.runGitCommand(data.repoPath, ["pull"]);
  }

  @CaptureSpan()
  public static async createOrCheckoutBranch(data: {
    repoPath: string;
    branchName: string;
  }): Promise<void> {
    try {
      await this.runGitCommand(data.repoPath, [
        "rev-parse",
        "--verify",
        data.branchName,
      ]);
      await this.runGitCommand(data.repoPath, ["checkout", data.branchName]);
    } catch (error) {
      logger.debug(
        `Branch ${data.branchName} not found. Creating a new branch instead.`,
      );

      logger.debug(error);

      await this.runGitCommand(data.repoPath, [
        "checkout",
        "-b",
        data.branchName,
      ]);
    }
  }

  @CaptureSpan()
  public static getFileContent(data: {
    repoPath: string;
    filePath: string;
  }): Promise<string> {
    const absolutePath: string = this.resolvePathWithinRepo(
      data.repoPath,
      data.filePath,
    );

    return LocalFile.read(absolutePath);
  }

  // discard all changes in the working directory
  @CaptureSpan()
  public static async discardChanges(data: {
    repoPath: string;
  }): Promise<void> {
    await this.runGitCommand(data.repoPath, ["checkout", "."]);
  }

  @CaptureSpan()
  public static async writeToFile(data: {
    filePath: string;
    repoPath: string;
    content: string;
  }): Promise<void> {
    const totalPath: string = LocalFile.sanitizeFilePath(
      `${data.repoPath}/${data.filePath}`,
    );

    await LocalFile.write(totalPath, data.content);
  }

  @CaptureSpan()
  public static async createDirectory(data: {
    repoPath: string;
    directoryPath: string;
  }): Promise<void> {
    const totalPath: string = LocalFile.sanitizeFilePath(
      `${data.repoPath}/${data.directoryPath}`,
    );

    await LocalFile.makeDirectory(totalPath);
  }

  @CaptureSpan()
  public static async deleteFile(data: {
    repoPath: string;
    filePath: string;
  }): Promise<void> {
    const totalPath: string = LocalFile.sanitizeFilePath(
      `${data.repoPath}/${data.filePath}`,
    );

    await LocalFile.deleteFile(totalPath);
  }

  @CaptureSpan()
  public static async deleteDirectory(data: {
    repoPath: string;
    directoryPath: string;
  }): Promise<void> {
    const totalPath: string = LocalFile.sanitizeFilePath(
      `${data.repoPath}/${data.directoryPath}`,
    );

    logger.debug("Deleting directory: " + totalPath);

    await LocalFile.deleteDirectory(totalPath);
  }

  @CaptureSpan()
  public static async createBranch(data: {
    repoPath: string;
    branchName: string;
  }): Promise<void> {
    logger.debug(
      `Creating git branch '${data.branchName}' in ${path.resolve(data.repoPath)}`,
    );

    const stdout: string = await this.runGitCommand(data.repoPath, [
      "checkout",
      "-b",
      data.branchName,
    ]);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async checkoutBranch(data: {
    repoPath: string;
    branchName: string;
  }): Promise<void> {
    logger.debug(
      `Checking out git branch '${data.branchName}' in ${path.resolve(data.repoPath)}`,
    );

    const stdout: string = await this.runGitCommand(data.repoPath, [
      "checkout",
      data.branchName,
    ]);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async addFilesToGit(data: {
    repoPath: string;
    filePaths: Array<string>;
  }): Promise<void> {
    const repoRoot: string = path.resolve(data.repoPath);

    const sanitizedRelativeFilePaths: Array<string> = [];

    for (const inputFilePath of data.filePaths) {
      const normalizedPath: string = inputFilePath.startsWith("/")
        ? inputFilePath.substring(1)
        : inputFilePath;

      if (normalizedPath.trim() === "") {
        continue;
      }

      const absoluteFilePath: string = this.resolvePathWithinRepo(
        data.repoPath,
        normalizedPath,
      );

      const relativeFilePath: string = path.relative(
        repoRoot,
        absoluteFilePath,
      );

      if (relativeFilePath.trim() === "") {
        continue;
      }

      sanitizedRelativeFilePaths.push(
        LocalFile.sanitizeFilePath(relativeFilePath),
      );
    }

    if (sanitizedRelativeFilePaths.length === 0) {
      logger.debug("git add skipped because no file paths were provided");
      return;
    }

    logger.debug(
      `Adding ${sanitizedRelativeFilePaths.length} file(s) to git in ${path.resolve(data.repoPath)}`,
    );

    const stdout: string = await this.runGitCommand(data.repoPath, [
      "add",
      ...sanitizedRelativeFilePaths,
    ]);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async setUsername(data: {
    repoPath: string;
    username: string;
  }): Promise<void> {
    logger.debug(`Setting git user.name in ${path.resolve(data.repoPath)}`);

    const stdout: string = await this.runGitCommand(data.repoPath, [
      "config",
      "user.name",
      data.username,
    ]);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async commitChanges(data: {
    repoPath: string;
    message: string;
  }): Promise<void> {
    logger.debug("Executing git commit");

    const stdout: string = await Execute.executeCommandFile({
      command: "git",
      args: ["commit", "-m", data.message],
      cwd: data.repoPath,
    });

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async getGitCommitHashForFile(data: {
    repoPath: string;
    filePath: string;
  }): Promise<string> {
    if (!data.filePath.startsWith("/")) {
      data.filePath = "/" + data.filePath;
    }

    if (!data.repoPath.startsWith("/")) {
      data.repoPath = "/" + data.repoPath;
    }

    const { repoPath, filePath } = data;

    const repoRoot: string = path.resolve(repoPath);
    const absoluteTarget: string = this.resolvePathWithinRepo(
      repoPath,
      filePath,
    );
    const relativeTarget: string = path.relative(repoRoot, absoluteTarget);
    const gitArgument: string = LocalFile.sanitizeFilePath(
      `./${relativeTarget}`,
    );

    logger.debug(`Getting last commit hash for ${gitArgument} in ${repoRoot}`);

    const hash: string = await this.runGitCommand(repoRoot, [
      "log",
      "-1",
      "--pretty=format:%H",
      gitArgument,
    ]);

    logger.debug(hash);

    return hash.trim();
  }

  @CaptureSpan()
  public static async listFilesInDirectory(data: {
    directoryPath: string;
    repoPath: string;
  }): Promise<Array<string>> {
    if (!data.directoryPath.startsWith("/")) {
      data.directoryPath = "/" + data.directoryPath;
    }

    if (!data.repoPath.startsWith("/")) {
      data.repoPath = "/" + data.repoPath;
    }

    const { directoryPath, repoPath } = data;

    let totalPath: string = `${repoPath}/${directoryPath}`;

    totalPath = LocalFile.sanitizeFilePath(totalPath); // clean up the path

    const entries: Array<fs.Dirent> = await LocalFile.readDirectory(totalPath);

    return entries.map((entry: fs.Dirent) => {
      return entry.name;
    });
  }

  @CaptureSpan()
  public static async getFilesInDirectory(data: {
    directoryPath: string;
    repoPath: string;
    acceptedFileExtensions?: Array<string>;
    ignoreFilesOrDirectories: Array<string>;
  }): Promise<{
    files: Dictionary<CodeRepositoryFile>;
    subDirectories: Array<string>;
  }> {
    if (!data.directoryPath.startsWith("/")) {
      data.directoryPath = "/" + data.directoryPath;
    }

    if (!data.repoPath.startsWith("/")) {
      data.repoPath = "/" + data.repoPath;
    }

    const { directoryPath, repoPath } = data;

    let totalPath: string = `${repoPath}/${directoryPath}`;

    totalPath = LocalFile.sanitizeFilePath(totalPath); // clean up the path

    const files: Dictionary<CodeRepositoryFile> = {};
    const subDirectories: Array<string> = [];

    const entries: Array<fs.Dirent> = await LocalFile.readDirectory(totalPath);

    for (const entry of entries) {
      const fileName: string = entry.name;

      const filePath: string = LocalFile.sanitizeFilePath(
        `${directoryPath}/${fileName}`,
      );

      if (data.ignoreFilesOrDirectories.includes(fileName)) {
        continue;
      }

      if (entry.isDirectory()) {
        subDirectories.push(
          LocalFile.sanitizeFilePath(`${directoryPath}/${fileName}`),
        );
        continue;
      } else if (
        data.acceptedFileExtensions &&
        data.acceptedFileExtensions.length > 0
      ) {
        let shouldSkip: boolean = true;

        for (const fileExtension of data.acceptedFileExtensions) {
          if (fileName.endsWith(fileExtension)) {
            shouldSkip = false;
            break;
          }
        }

        if (shouldSkip) {
          continue;
        }
      }

      files[filePath] = {
        fileContent: await this.getFileContent({
          filePath: LocalFile.sanitizeFilePath(`${directoryPath}/${fileName}`),
          repoPath,
        }),
        filePath: filePath,
      };
    }

    return {
      files,
      subDirectories: subDirectories,
    };
  }

  @CaptureSpan()
  public static async getFilesInDirectoryRecursive(data: {
    repoPath: string;
    directoryPath: string;
    acceptedFileExtensions: Array<string>;
    ignoreFilesOrDirectories: Array<string>;
  }): Promise<Dictionary<CodeRepositoryFile>> {
    let files: Dictionary<CodeRepositoryFile> = {};

    const { files: filesInDirectory, subDirectories } =
      await this.getFilesInDirectory({
        directoryPath: data.directoryPath,
        repoPath: data.repoPath,
        acceptedFileExtensions: data.acceptedFileExtensions,
        ignoreFilesOrDirectories: data.ignoreFilesOrDirectories,
      });

    files = {
      ...files,
      ...filesInDirectory,
    };

    for (const subDirectory of subDirectories) {
      files = {
        ...files,
        ...(await this.getFilesInDirectoryRecursive({
          repoPath: data.repoPath,
          directoryPath: subDirectory,
          acceptedFileExtensions: data.acceptedFileExtensions,
          ignoreFilesOrDirectories: data.ignoreFilesOrDirectories,
        })),
      };
    }

    return files;
  }

  private static runGitCommand(
    repoPath: string,
    args: Array<string>,
  ): Promise<string> {
    const cwd: string = path.resolve(repoPath);

    logger.debug(
      `Executing git command in ${cwd}: git ${args
        .map((arg: string) => {
          return arg.includes(" ") ? `"${arg}"` : arg;
        })
        .join(" ")}`,
    );

    return Execute.executeCommandFile({
      command: "git",
      args,
      cwd,
    });
  }

  private static resolvePathWithinRepo(
    repoPath: string,
    targetPath: string,
  ): string {
    const root: string = path.resolve(repoPath);
    const sanitizedTarget: string = LocalFile.sanitizeFilePath(
      targetPath,
    ).replace(/^\/+/, "");
    const absoluteTarget: string = path.resolve(root, sanitizedTarget);

    if (
      absoluteTarget !== root &&
      !absoluteTarget.startsWith(root + path.sep)
    ) {
      throw new BadDataException("File path is outside the repository");
    }

    return absoluteTarget;
  }
}
