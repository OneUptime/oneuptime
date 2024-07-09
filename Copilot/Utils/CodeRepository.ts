import {
  GetCodeRepositoryPassword,
  GetCodeRepositoryUsername,
  GetLocalRepositoryPath,
  GetOneUptimeURL,
  GetRepositorySecretKey,
} from "../Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import PullRequest from "Common/Types/CodeRepository/PullRequest";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import CodeRepositoryServerUtil from "CommonServer/Utils/CodeRepository/CodeRepository";
import GitHubUtil from "CommonServer/Utils/CodeRepository/GitHub/GitHub";
import LocalFile from "CommonServer/Utils/LocalFile";
import logger from "CommonServer/Utils/Logger";
import CopilotCodeRepository from "Model/Models/CopilotCodeRepository";
import ServiceCopilotCodeRepository from "Model/Models/ServiceCopilotCodeRepository";
import Text from "Common/Types/Text";
import Execute from "CommonServer/Utils/Execute";

export interface CodeRepositoryResult {
  codeRepository: CopilotCodeRepository;
  servicesToImprove: Array<ServiceToImproveResult>;
  serviceRepositories: Array<ServiceCopilotCodeRepository>;
}

export interface ServiceToImproveResult {
  serviceRepository: ServiceCopilotCodeRepository;
  numberOfOpenPullRequests: number;
  pullRequests: Array<PullRequest>;
}

export enum RepoScriptType {
  OnAfterClone = "onAfterClone",
  OnBeforeCommit = "onBeforeCommit",
  OnAfterCommit = "OnAfterCommit",
  OnBeforeCopilotAction = "onBeforeCopilotAction",
  OnAfterCopilotAction = "onAfterCopilotAction",
}

export default class CodeRepositoryUtil {
  public static codeRepositoryResult: CodeRepositoryResult | null = null;
  public static gitHubUtil: GitHubUtil | null = null;
  public static folderNameOfClonedRepository: string | null = null;

  public static getLocalRepositoryPath(): string {
    if (this.folderNameOfClonedRepository) {
      return LocalFile.sanitizeFilePath(
        GetLocalRepositoryPath() + "/" + this.folderNameOfClonedRepository,
      );
    }

    return GetLocalRepositoryPath();
  }

  public static async discardAllChangesOnCurrentBranch(): Promise<void> {
    await CodeRepositoryServerUtil.discardAllChangesOnCurrentBranch({
      repoPath: this.getLocalRepositoryPath(),
    });
  }

  public static async setAuthorIdentity(data: {
    name: string;
    email: string;
  }): Promise<void> {
    await CodeRepositoryServerUtil.setAuthorIdentity({
      repoPath: this.getLocalRepositoryPath(),
      authorName: data.name,
      authorEmail: data.email,
    });
  }

  // returns the folder name of the cloned repository.
  public static async cloneRepository(data: {
    codeRepository: CopilotCodeRepository;
  }): Promise<void> {
    // make sure this.getLocalRepositoryPath() is empty.
    const repoLocalPath: string = this.getLocalRepositoryPath();

    await LocalFile.deleteAllDataInDirectory(repoLocalPath);
    await LocalFile.makeDirectory(repoLocalPath);

    // check if the data in the directory eixsts, if it does then delete it.

    if (!data.codeRepository.repositoryHostedAt) {
      throw new BadDataException("Repository Hosted At is required");
    }

    if (!data.codeRepository.mainBranchName) {
      throw new BadDataException("Main Branch Name is required");
    }

    if (!data.codeRepository.organizationName) {
      throw new BadDataException("Organization Name is required");
    }

    if (!data.codeRepository.repositoryName) {
      throw new BadDataException("Repository Name is required");
    }

    const CodeRepositoryUsername: string | null = GetCodeRepositoryUsername();

    if (!CodeRepositoryUsername) {
      throw new BadDataException("Code Repository Username is required");
    }

    const CodeRepositoryPassword: string | null = GetCodeRepositoryPassword();

    if (!CodeRepositoryPassword) {
      throw new BadDataException("Code Repository Password is required");
    }

    const repoUrl: string = `https://${CodeRepositoryUsername}:${CodeRepositoryPassword}@${
      data.codeRepository.repositoryHostedAt === CodeRepositoryType.GitHub
        ? "github.com"
        : ""
    }/${data.codeRepository.organizationName}/${data.codeRepository.repositoryName}.git`;

    const folderName: string = await CodeRepositoryServerUtil.cloneRepository({
      repoUrl: repoUrl,
      repoPath: repoLocalPath,
    });

    this.folderNameOfClonedRepository = folderName;
  }

  public static async executeScript(data: { script: string }): Promise<string> {
    await Execute.executeCommand(`cd ${this.getLocalRepositoryPath()}`); // change directory to the repository path
    return await Execute.executeCommand(data.script); // execute the script
  }

  public static async getRepoScript(data: {
    scriptType: RepoScriptType;
  }): Promise<string | null> {
    const repoPath: string = this.getLocalRepositoryPath();

    const oneUptimeFolderPath: string = LocalFile.sanitizeFilePath(
      `${repoPath}/.oneuptime`,
    );

    const doesDirectoryExist: boolean =
      await LocalFile.doesDirectoryExist(oneUptimeFolderPath);

    if (!doesDirectoryExist) {
      return null;
    }

    const oneuptimeScriptsPath: string = LocalFile.sanitizeFilePath(
      `${oneUptimeFolderPath}/scripts`,
    );

    const doesScriptsDirectoryExist: boolean =
      await LocalFile.doesDirectoryExist(oneuptimeScriptsPath);

    if (!doesScriptsDirectoryExist) {
      return null;
    }

    const scriptPath: string = LocalFile.sanitizeFilePath(
      `${oneuptimeScriptsPath}/${Text.fromPascalCaseToDashes(data.scriptType)}.sh`,
    );

    const doesScriptExist: boolean = await LocalFile.doesFileExist(scriptPath);

    if (!doesScriptExist) {
      return null;
    }

    const scriptContent: string = await LocalFile.read(scriptPath);

    return scriptContent.trim() || null;
  }

  public static hasOpenPRForFile(data: {
    filePath: string;
    pullRequests: Array<PullRequest>;
  }): boolean {
    const pullRequests: Array<PullRequest> = this.getOpenPRForFile(data);
    return pullRequests.length > 0;
  }

  public static getOpenPRForFile(data: {
    filePath: string;
    pullRequests: Array<PullRequest>;
  }): Array<PullRequest> {
    const pullRequests: Array<PullRequest> = [];

    for (const pullRequest of data.pullRequests) {
      if (pullRequest.title.includes(data.filePath)) {
        pullRequests.push(pullRequest);
      }
    }

    return pullRequests;
  }

  public static async listFilesInDirectory(data: {
    directoryPath: string;
  }): Promise<Array<string>> {
    return await CodeRepositoryServerUtil.listFilesInDirectory({
      repoPath: this.getLocalRepositoryPath(),
      directoryPath: data.directoryPath,
    });
  }

  public static getGitHubUtil(): GitHubUtil {
    if (!this.gitHubUtil) {
      const gitHubToken: string | null = GetCodeRepositoryPassword();

      const gitHubUsername: string | null = GetCodeRepositoryUsername();

      if (!gitHubUsername) {
        throw new BadDataException("GitHub Username is required");
      }

      if (!gitHubToken) {
        throw new BadDataException("GitHub Token is required");
      }

      this.gitHubUtil = new GitHubUtil({
        authToken: gitHubToken,
        username: gitHubUsername!,
      });
    }

    return this.gitHubUtil;
  }

  public static async pullChanges(): Promise<void> {
    await CodeRepositoryServerUtil.pullChanges({
      repoPath: this.getLocalRepositoryPath(),
    });
  }

  public static getBranchName(data: {
    branchName: string;
    serviceRepository: ServiceCopilotCodeRepository;
  }): string {
    if (!data.serviceRepository.serviceCatalog) {
      throw new BadDataException("Service Catalog is required");
    }

    if (!data.serviceRepository.serviceCatalog.name) {
      throw new BadDataException("Service Catalog Name is required");
    }

    return (
      "oneuptime-" +
      data.serviceRepository.serviceCatalog?.name?.toLowerCase() +
      "-" +
      data.branchName
    );
  }

  public static async createBranch(data: {
    branchName: string;
    serviceRepository: ServiceCopilotCodeRepository;
  }): Promise<void> {
    const branchName: string = this.getBranchName({
      branchName: data.branchName,
      serviceRepository: data.serviceRepository,
    });

    await CodeRepositoryServerUtil.createBranch({
      repoPath: this.getLocalRepositoryPath(),
      branchName: branchName,
    });
  }

  public static async createOrCheckoutBranch(data: {
    serviceRepository: ServiceCopilotCodeRepository;
    branchName: string;
  }): Promise<void> {
    const branchName: string = this.getBranchName({
      branchName: data.branchName,
      serviceRepository: data.serviceRepository,
    });

    await CodeRepositoryServerUtil.createOrCheckoutBranch({
      repoPath: this.getLocalRepositoryPath(),
      branchName: branchName,
    });
  }

  public static async writeToFile(data: {
    filePath: string;
    content: string;
  }): Promise<void> {
    await CodeRepositoryServerUtil.writeToFile({
      repoPath: this.getLocalRepositoryPath(),
      filePath: data.filePath,
      content: data.content,
    });
  }

  public static async createDirectory(data: {
    directoryPath: string;
  }): Promise<void> {
    await CodeRepositoryServerUtil.createDirectory({
      repoPath: this.getLocalRepositoryPath(),
      directoryPath: data.directoryPath,
    });
  }

  public static async deleteFile(data: { filePath: string }): Promise<void> {
    await CodeRepositoryServerUtil.deleteFile({
      repoPath: this.getLocalRepositoryPath(),
      filePath: data.filePath,
    });
  }

  public static async deleteDirectory(data: {
    directoryPath: string;
  }): Promise<void> {
    await CodeRepositoryServerUtil.deleteDirectory({
      repoPath: this.getLocalRepositoryPath(),
      directoryPath: data.directoryPath,
    });
  }

  public static async discardChanges(): Promise<void> {
    await CodeRepositoryServerUtil.discardChanges({
      repoPath: this.getLocalRepositoryPath(),
    });
  }

  public static async checkoutBranch(data: {
    branchName: string;
  }): Promise<void> {
    await CodeRepositoryServerUtil.checkoutBranch({
      repoPath: this.getLocalRepositoryPath(),
      branchName: data.branchName,
    });
  }

  public static async checkoutMainBranch(): Promise<void> {
    const codeRepository: CopilotCodeRepository =
      await this.getCodeRepository();

    if (!codeRepository.mainBranchName) {
      throw new BadDataException("Main Branch Name is required");
    }

    await this.checkoutBranch({
      branchName: codeRepository.mainBranchName!,
    });
  }

  public static async addFilesToGit(data: {
    filePaths: Array<string>;
  }): Promise<void> {
    await CodeRepositoryServerUtil.addFilesToGit({
      repoPath: this.getLocalRepositoryPath(),
      filePaths: data.filePaths,
    });
  }

  public static async commitChanges(data: { message: string }): Promise<void> {
    let username: string | null = null;

    if (
      this.codeRepositoryResult?.codeRepository.repositoryHostedAt ===
      CodeRepositoryType.GitHub
    ) {
      username = GetCodeRepositoryUsername();
    }

    if (!username) {
      throw new BadDataException("Username is required");
    }

    await CodeRepositoryServerUtil.commitChanges({
      repoPath: this.getLocalRepositoryPath(),
      message: data.message,
      username: username,
    });
  }

  public static async pushChanges(data: {
    branchName: string;
    serviceRepository: ServiceCopilotCodeRepository;
  }): Promise<void> {
    const branchName: string = this.getBranchName({
      branchName: data.branchName,
      serviceRepository: data.serviceRepository,
    });

    const codeRepository: CopilotCodeRepository =
      await this.getCodeRepository();

    if (!codeRepository.mainBranchName) {
      throw new BadDataException("Main Branch Name is required");
    }

    if (!codeRepository.organizationName) {
      throw new BadDataException("Organization Name is required");
    }

    if (!codeRepository.repositoryName) {
      throw new BadDataException("Repository Name is required");
    }

    if (codeRepository.repositoryHostedAt === CodeRepositoryType.GitHub) {
      return await this.getGitHubUtil().pushChanges({
        repoPath: this.getLocalRepositoryPath(),
        branchName: branchName,
        organizationName: codeRepository.organizationName,
        repositoryName: codeRepository.repositoryName,
      });
    }
  }

  public static async switchToMainBranch(): Promise<void> {
    const codeRepository: CopilotCodeRepository =
      await this.getCodeRepository();

    if (!codeRepository.mainBranchName) {
      throw new BadDataException("Main Branch Name is required");
    }

    await this.checkoutBranch({
      branchName: codeRepository.mainBranchName!,
    });
  }

  public static async createPullRequest(data: {
    branchName: string;
    title: string;
    body: string;
    serviceRepository: ServiceCopilotCodeRepository;
  }): Promise<PullRequest> {
    const branchName: string = this.getBranchName({
      branchName: data.branchName,
      serviceRepository: data.serviceRepository,
    });

    const codeRepository: CopilotCodeRepository =
      await this.getCodeRepository();

    if (!codeRepository.mainBranchName) {
      throw new BadDataException("Main Branch Name is required");
    }

    if (!codeRepository.organizationName) {
      throw new BadDataException("Organization Name is required");
    }

    if (!codeRepository.repositoryName) {
      throw new BadDataException("Repository Name is required");
    }

    if (codeRepository.repositoryHostedAt === CodeRepositoryType.GitHub) {
      return await this.getGitHubUtil().createPullRequest({
        headBranchName: branchName,
        baseBranchName: codeRepository.mainBranchName,
        organizationName: codeRepository.organizationName,
        repositoryName: codeRepository.repositoryName,
        title: data.title,
        body: data.body,
      });
    }
    throw new BadDataException("Code Repository type not supported");
  }

  public static async getServicesToImproveCode(data: {
    codeRepository: CopilotCodeRepository;
    services: Array<ServiceCopilotCodeRepository>;
  }): Promise<Array<ServiceToImproveResult>> {
    const servicesToImproveCode: Array<ServiceToImproveResult> = [];

    for (const service of data.services) {
      if (!data.codeRepository.mainBranchName) {
        throw new BadDataException("Main Branch Name is required");
      }

      if (!data.codeRepository.organizationName) {
        throw new BadDataException("Organization Name is required");
      }

      if (!data.codeRepository.repositoryName) {
        throw new BadDataException("Repository Name is required");
      }

      if (!service.limitNumberOfOpenPullRequestsCount) {
        throw new BadDataException(
          "Limit Number Of Open Pull Requests Count is required",
        );
      }

      if (
        data.codeRepository.repositoryHostedAt === CodeRepositoryType.GitHub
      ) {
        const gitHuhbToken: string | null = GetCodeRepositoryPassword();

        if (!gitHuhbToken) {
          throw new BadDataException("GitHub Token is required");
        }

        const pullRequestByService: Array<PullRequest> =
          await this.getGitHubUtil().getPullRequestsByService({
            serviceRepository: service,
            pullRequestState: PullRequestState.Open,
            baseBranchName: data.codeRepository.mainBranchName,
            organizationName: data.codeRepository.organizationName,
            repositoryName: data.codeRepository.repositoryName,
          });

        const numberOfPullRequestForThisService: number =
          pullRequestByService.length;

        if (
          numberOfPullRequestForThisService <
          service.limitNumberOfOpenPullRequestsCount
        ) {
          servicesToImproveCode.push({
            serviceRepository: service,
            numberOfOpenPullRequests: numberOfPullRequestForThisService,
            pullRequests: pullRequestByService,
          });
          logger.info(
            `Service ${service.serviceCatalog?.name} has ${numberOfPullRequestForThisService} open pull requests. Limit is ${service.limitNumberOfOpenPullRequestsCount}. Adding to the list to improve code...`,
          );
        } else {
          logger.warn(
            `Service ${service.serviceCatalog?.name} has ${numberOfPullRequestForThisService} open pull requests. Limit is ${service.limitNumberOfOpenPullRequestsCount}. Skipping...`,
          );
        }
      }
    }

    return servicesToImproveCode;
  }

  public static async getCodeRepositoryResult(): Promise<CodeRepositoryResult> {
    if (this.codeRepositoryResult) {
      return this.codeRepositoryResult;
    }

    const repositorySecretKey: string | null = GetRepositorySecretKey();

    if (!repositorySecretKey) {
      throw new BadDataException("Repository Secret Key is required");
    }

    const url: URL = URL.fromString(
      GetOneUptimeURL().toString() + "/api",
    ).addRoute(
      `${new CopilotCodeRepository()
        .getCrudApiPath()
        ?.toString()}/get-code-repository/${repositorySecretKey}`,
    );

    const codeRepositoryResult: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(url);

    if (codeRepositoryResult instanceof HTTPErrorResponse) {
      throw codeRepositoryResult;
    }

    const codeRepository: CopilotCodeRepository =
      CopilotCodeRepository.fromJSON(
        codeRepositoryResult.data["codeRepository"] as JSONObject,
        CopilotCodeRepository,
      ) as CopilotCodeRepository;

    const servicesRepository: Array<ServiceCopilotCodeRepository> = (
      codeRepositoryResult.data["servicesRepository"] as JSONArray
    ).map((serviceRepository: JSONObject) => {
      return ServiceCopilotCodeRepository.fromJSON(
        serviceRepository,
        ServiceCopilotCodeRepository,
      ) as ServiceCopilotCodeRepository;
    });

    if (!codeRepository) {
      throw new BadDataException(
        "Code Repository not found with the secret key provided.",
      );
    }

    if (!servicesRepository || servicesRepository.length === 0) {
      throw new BadDataException(
        "No services attached to this repository. Please attach services to this repository on OneUptime Dashboard.",
      );
    }

    logger.info(`Code Repository found: ${codeRepository.name}`);

    logger.info("Services found in the repository:");

    servicesRepository.forEach(
      (serviceRepository: ServiceCopilotCodeRepository) => {
        logger.info(`- ${serviceRepository.serviceCatalog?.name}`);
      },
    );

    this.codeRepositoryResult = {
      codeRepository,
      servicesToImprove: await this.getServicesToImproveCode({
        codeRepository,
        services: servicesRepository,
      }),
      serviceRepositories: servicesRepository,
    };

    return this.codeRepositoryResult;
  }

  public static async getCodeRepository(): Promise<CopilotCodeRepository> {
    if (!this.codeRepositoryResult) {
      const result: CodeRepositoryResult = await this.getCodeRepositoryResult();
      return result.codeRepository;
    }

    return this.codeRepositoryResult.codeRepository;
  }

  public static async getServiceRepositories(): Promise<
    Array<ServiceCopilotCodeRepository>
  > {
    if (!this.codeRepositoryResult) {
      this.codeRepositoryResult = await this.getCodeRepositoryResult();
    }

    return this.codeRepositoryResult.servicesToImprove.map(
      (serviceToImprove: ServiceToImproveResult) => {
        return serviceToImprove.serviceRepository;
      },
    );
  }

  public static getCodeFileExtentions(): Array<string> {
    return [
      ".ts",
      ".js",
      ".tsx",
      ".jsx",
      ".py",
      ".go",
      ".java",
      ".c",
      ".cpp",
      ".cs",
      ".swift",
      ".php",
      ".rb",
      ".rs",
      ".kt",
      ".dart",
      ".sh",
      ".pl",
      ".lua",
      ".r",
      ".scala",
      ".ts",
      ".js",
      ".tsx",
      ".jsx",
    ];
  }

  public static getReadmeFileExtentions(): Array<string> {
    return [".md"];
  }
}
