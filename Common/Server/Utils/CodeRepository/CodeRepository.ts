import Execute from "../Execute";
import LocalFile from "../LocalFile";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CodeRepositoryFile from "./CodeRepositoryFile";
import Dictionary from "../../../Types/Dictionary";

export default class CodeRepositoryUtil {
  @CaptureSpan()
  public static getCurrentCommitHash(data: {
    repoPath: string;
  }): Promise<string> {
    const command: string = `cd ${data.repoPath} && git rev-parse HEAD`;

    logger.debug("Executing command: " + command);

    return Execute.executeCommand(command);
  }

  @CaptureSpan()
  public static async addAllChangedFilesToGit(data: {
    repoPath: string;
  }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git add -A`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async setAuthorIdentity(data: {
    repoPath: string;
    authorName: string;
    authorEmail: string;
  }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git config --global user.name "${data.authorName}" && git config --global user.email "${data.authorEmail}"`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async discardAllChangesOnCurrentBranch(data: {
    repoPath: string;
  }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git checkout .`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  // returns the folder name of the cloned repository
  @CaptureSpan()
  public static async cloneRepository(data: {
    repoPath: string;
    repoUrl: string;
  }): Promise<string> {
    const command: string = `cd ${data.repoPath} && git clone ${data.repoUrl}`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);

    // get the folder name of the repository from the disk.

    const getFolderNameCommand: string = `cd ${data.repoPath} && ls`;

    const folderName: string =
      await Execute.executeCommand(getFolderNameCommand);

    return folderName.trim();
  }

  @CaptureSpan()
  public static async pullChanges(data: { repoPath: string }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git pull`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async createOrCheckoutBranch(data: {
    repoPath: string;
    branchName: string;
  }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git checkout ${data.branchName} || git checkout -b ${data.branchName}`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static getFileContent(data: {
    repoPath: string;
    filePath: string;
  }): Promise<string> {
    const path: string = LocalFile.sanitizeFilePath(
      `${data.repoPath}/${data.filePath}`,
    );

    const command: string = `cat ${path}`;

    logger.debug("Executing command: " + command);

    return Execute.executeCommand(`${command}`);
  }

  // discard all changes in the working directory
  @CaptureSpan()
  public static async discardChanges(data: {
    repoPath: string;
  }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git checkout .`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
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
    const command: string = `cd ${data.repoPath} && git checkout -b ${data.branchName}`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async checkoutBranch(data: {
    repoPath: string;
    branchName: string;
  }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git checkout ${data.branchName}`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async addFilesToGit(data: {
    repoPath: string;
    filePaths: Array<string>;
  }): Promise<void> {
    const filePaths: Array<string> = data.filePaths.map((filePath: string) => {
      if (filePath.startsWith("/")) {
        // remove the leading slash and return
        return filePath.substring(1);
      }

      return filePath;
    });

    const command: string = `cd ${
      data.repoPath
    } && git add ${filePaths.join(" ")}`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async setUsername(data: {
    repoPath: string;
    username: string;
  }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git config user.name "${data.username}"`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

    logger.debug(stdout);
  }

  @CaptureSpan()
  public static async commitChanges(data: {
    repoPath: string;
    message: string;
  }): Promise<void> {
    const command: string = `cd ${data.repoPath} && git commit -m "${data.message}"`;

    logger.debug("Executing command: " + command);

    const stdout: string = await Execute.executeCommand(command);

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

    const command: string = `cd ${repoPath} && git log -1 --pretty=format:"%H" ".${filePath}"`;

    logger.debug("Executing command: " + command);

    const hash: string = await Execute.executeCommand(command);

    logger.debug(hash);

    return hash;
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

    const output: string = await Execute.executeCommand(`ls ${totalPath}`);

    const fileNames: Array<string> = output.split("\n");

    return fileNames;
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
    const output: string = await Execute.executeCommand(`ls ${totalPath}`);

    const fileNames: Array<string> = output.split("\n");

    const subDirectories: Array<string> = [];

    for (const fileName of fileNames) {
      if (fileName === "") {
        continue;
      }

      const filePath: string = LocalFile.sanitizeFilePath(
        `${directoryPath}/${fileName}`,
      );

      if (data.ignoreFilesOrDirectories.includes(fileName)) {
        continue;
      }

      const isDirectory: boolean = (
        await Execute.executeCommand(
          `file "${LocalFile.sanitizeFilePath(`${totalPath}/${fileName}`)}"`,
        )
      ).includes("directory");

      if (isDirectory) {
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
}
