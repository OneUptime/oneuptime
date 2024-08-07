import ServiceFileTypesUtil from "./ServiceFileTypes";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import TechStack from "Common/Types/ServiceCatalog/TechStack";
import CodeRepositoryCommonServerUtil from "Common/Server/Utils/CodeRepository/CodeRepository";
import CodeRepositoryFile from "Common/Server/Utils/CodeRepository/CodeRepositoryFile";
import LocalFile from "Common/Server/Utils/LocalFile";
import ServiceCopilotCodeRepository from "Common/Models/DatabaseModels/ServiceCopilotCodeRepository";
import ServiceLanguageUtil from "Common/Utils/TechStack";
import CodeRepositoryUtil from "./CodeRepository";

export default class ServiceCopilotCodeRepositoryUtil {
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
