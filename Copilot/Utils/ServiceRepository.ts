import ServiceFileTypesUtil from "./FileTypes";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import TechStack from "Common/Types/ServiceCatalog/TechStack";
import CodeRepositoryCommonServerUtil from "Common/Server/Utils/CodeRepository/CodeRepository";
import CodeRepositoryFile from "Common/Server/Utils/CodeRepository/CodeRepositoryFile";
import LocalFile from "Common/Server/Utils/LocalFile";
import ServiceCopilotCodeRepository from "Common/Models/DatabaseModels/ServiceCopilotCodeRepository";
import ServiceLanguageUtil from "Common/Utils/TechStack";
import CodeRepositoryUtil, {
  CodeRepositoryResult,
  ServiceToImproveResult,
} from "./CodeRepository";
import PullRequestUtil from "./PullRequest";
import CopilotPullRequest from "Common/Models/DatabaseModels/CopilotPullRequest";
import logger from "Common/Server/Utils/Logger";
import ProcessUtil from "./Process";
import ObjectID from "Common/Types/ObjectID";

export default class ServiceRepositoryUtil {

  public static codeRepositoryResult: CodeRepositoryResult | null = null;
  public static servicesToImprove: Array<ServiceCopilotCodeRepository> = [];

  public static setCodeRepositoryResult(data: {
    codeRepositoryResult: CodeRepositoryResult;
  }): void {
    ServiceRepositoryUtil.codeRepositoryResult = data.codeRepositoryResult;
  }


  public static async getServicesToImprove(

  ): Promise<Array<ServiceCopilotCodeRepository>> {

    if (this.servicesToImprove) {
      return this.servicesToImprove;
    }

    const codeRepositoryResult: CodeRepositoryResult = ServiceRepositoryUtil.codeRepositoryResult!;

    if (!codeRepositoryResult) {
      throw new BadDataException("Code repository result is not set");
    }

    // before cloning the repo, check if there are any services to improve.
    const openPullRequests: Array<CopilotPullRequest> =
      await PullRequestUtil.getOpenPRs();

    const servicesToImproveResult: Array<ServiceToImproveResult> =
      await CodeRepositoryUtil.getServicesToImproveCode({
        codeRepository: codeRepositoryResult.codeRepository,
        serviceRepositories: codeRepositoryResult.serviceRepositories,
        openPullRequests: openPullRequests,
      });

    const servicesToImprove: Array<ServiceCopilotCodeRepository> =
      servicesToImproveResult.map(
        (serviceToImproveResult: ServiceToImproveResult) => {
          return serviceToImproveResult.serviceRepository;
        },
      );

    if (servicesToImprove.length === 0) {
      logger.info("No services to improve. Exiting.");
      ProcessUtil.haltProcessWithSuccess();
    }

    this.servicesToImprove = servicesToImprove;

    return servicesToImprove;
  }

  public static async getFileLanguage(data: {
    filePath: string;
  }): Promise<TechStack> {
    const fileExtention: string = LocalFile.getFileExtension(data.filePath);

    const techStack: TechStack = ServiceLanguageUtil.getLanguageByFileExtension(
      {
        fileExtension: fileExtention,
      },
    );

    return techStack;
  }

  public static async getFileContent(data: {
    filePath: string;
  }): Promise<string> {
    const { filePath } = data;

    const fileContent: string =
      await CodeRepositoryCommonServerUtil.getFileContent({
        repoPath: CodeRepositoryUtil.getLocalRepositoryPath(),
        filePath: filePath,
      });

    return fileContent;
  }

  public static async getFilesByServiceCatalogId(data: {
    serviceCatalogId: ObjectID;
  }): Promise<Dictionary<CodeRepositoryFile>> {
    const { serviceCatalogId } = data;

    const serviceRepository: ServiceCopilotCodeRepository | undefined =
      ServiceRepositoryUtil.servicesToImprove.find(
        (serviceRepository: ServiceCopilotCodeRepository) => {
          return serviceRepository.serviceCatalog!.id?.toString() === serviceCatalogId.toString();
        },
      );

    if (!serviceRepository) {
      throw new BadDataException("Service repository not found");
    }

    const allFiles: Dictionary<CodeRepositoryFile> =
      await ServiceRepositoryUtil.getFilesInServiceDirectory({
        serviceRepository,
      });

    return allFiles;
  }

  public static async getFilesInServiceDirectory(data: {
    serviceRepository: ServiceCopilotCodeRepository;
  }): Promise<Dictionary<CodeRepositoryFile>> {
    const { serviceRepository } = data;

    if (!serviceRepository.serviceCatalog?.techStack) {
      throw new BadDataException(
        "Service language is not defined in the service catalog",
      );
    }

    const allFiles: Dictionary<CodeRepositoryFile> =
      await CodeRepositoryCommonServerUtil.getFilesInDirectoryRecursive({
        repoPath: CodeRepositoryUtil.getLocalRepositoryPath(),
        directoryPath: serviceRepository.servicePathInRepository || ".",
        acceptedFileExtensions:
          ServiceFileTypesUtil.getFileExtentionsByTechStack(
            serviceRepository.serviceCatalog!.techStack!,
          ),
        ignoreFilesOrDirectories:
          ServiceFileTypesUtil.getCommonFilesToIgnoreByTechStack(
            serviceRepository.serviceCatalog!.techStack!,
          ),
      });

    return allFiles;
  }


}
