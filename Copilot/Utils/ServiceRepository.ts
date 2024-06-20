import { GetLocalRepositoryPath } from "../Config";
import ServiceFileTypesUtil from "./ServiceFileTypes";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import CodeRepositoryCommonServerUtil from "CommonServer/Utils/CodeRepository/CodeRepository";
import CodeRepositoryFile from "CommonServer/Utils/CodeRepository/CodeRepositoryFile";
import ServiceRepository from "Model/Models/ServiceRepository";

export default class ServiceRepositoryUtil {
  public static async getFileContent(data: {
    filePath: string;
  }): Promise<string> {
    const { filePath } = data;

    const fileContent: string =
      await CodeRepositoryCommonServerUtil.getFileContent({
        repoPath: GetLocalRepositoryPath(),
        filePath: filePath,
      });

    return fileContent;
  }

  public static async getFilesInServiceDirectory(data: {
    serviceRepository: ServiceRepository;
  }): Promise<Dictionary<CodeRepositoryFile>> {
    const { serviceRepository } = data;

    if (!serviceRepository.serviceCatalog?.serviceLanguage) {
      throw new BadDataException(
        "Service language is not defined in the service catalog",
      );
    }

    const allFiles: Dictionary<CodeRepositoryFile> =
      await CodeRepositoryCommonServerUtil.getFilesInDirectoryRecursive({
        repoPath: GetLocalRepositoryPath(),
        directoryPath: serviceRepository.servicePathInRepository || ".",
        acceptedFileExtensions:
          ServiceFileTypesUtil.getFileExtentionsByServiceLanguage(
            serviceRepository.serviceCatalog!.serviceLanguage!,
          ),
        ignoreFilesOrDirectories:
          ServiceFileTypesUtil.getCommonFilesToIgnoreByServiceLanguage(
            serviceRepository.serviceCatalog!.serviceLanguage!,
          ),
      });

    return allFiles;
  }
}
