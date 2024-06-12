import { GetLocalRepositoryPath } from '../Config';
import Dictionary from 'Common/Types/Dictionary';
import CodeRepositoryCommonServerUtil from 'CommonServer/Utils/CodeRepository/CodeRepository';
import CodeRepositoryFile from 'CommonServer/Utils/CodeRepository/CodeRepositoryFile';
import ServiceRepository from 'Model/Models/ServiceRepository';

export default class ServiceRepositoryUtil {
    public static async getFilesInServiceDirectory(data: {
        serviceRepository: ServiceRepository;
    }): Promise<Dictionary<CodeRepositoryFile>> {
        const { serviceRepository } = data;

        const allFiles: Dictionary<CodeRepositoryFile> =
            await CodeRepositoryCommonServerUtil.getFilesInDirectoryRecursive({
                repoPath: GetLocalRepositoryPath(),
                directoryPath: serviceRepository.servicePathInRepository || '.',
            });

        return allFiles;
    }
}
