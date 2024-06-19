import { CodeRepositoryResult } from "./Utils/CodeRepository";
import InitUtil from "./Utils/Init";
import ServiceRepositoryUtil from "./Utils/ServiceRepository";
import Dictionary from "Common/Types/Dictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import CodeRepositoryFile from "CommonServer/Utils/CodeRepository/CodeRepositoryFile";
import logger from "CommonServer/Utils/Logger";

const init: PromiseVoidFunction = async (): Promise<void> => {
  const codeRepositoryResult: CodeRepositoryResult = await InitUtil.init();

  for (const serviceRepository of codeRepositoryResult.servicesRepository) {
    const filesInService: Dictionary<CodeRepositoryFile> =
      await ServiceRepositoryUtil.getFilesInServiceDirectory({
        serviceRepository,
      });

    logger.info(
      `Files found in ${serviceRepository.serviceCatalog?.name}: ${
        Object.keys(filesInService).length
      }`,
    );
  }
};

export default init;
