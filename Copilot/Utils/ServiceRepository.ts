import { GetLocalRepositoryPath } from "../Config";
import ServiceFileTypesUtil from "./ServiceFileTypes";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import ServiceLanguage from "Common/Types/ServiceCatalog/ServiceLanguage";
import CodeRepositoryCommonServerUtil from "CommonServer/Utils/CodeRepository/CodeRepository";
import CodeRepositoryFile from "CommonServer/Utils/CodeRepository/CodeRepositoryFile";
import LocalFile from "CommonServer/Utils/LocalFile";
import ServiceRepository from "Model/Models/ServiceRepository";
import ServiceLanguageUtil from "Common/Utils/ServiceLanguage";

export default class ServiceRepositoryUtil {
  public static async getFileLanguage(data: {
    filePath: string;
  }): Promise<ServiceLanguage> {
    const fileExtention: string = LocalFile.getFileExtension(data.filePath);

    const serviceLanguage: ServiceLanguage =
      ServiceLanguageUtil.getLanguageByFileExtension({
        fileExtension: fileExtention,
      });

    return serviceLanguage;
  }

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
