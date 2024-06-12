import { CodeRepositoryResult } from './Utils/CodeRepository';
import InitUtil from './Utils/Init';
import Dictionary from 'Common/Types/Dictionary';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import CodeRepositoryFile from 'CommonServer/Utils/CodeRepository/CodeRepositoryFile';
import logger from 'CommonServer/Utils/Logger';
import dotenv from 'dotenv';
import ServiceRepositoryUtil from './Utils/ServiceRepository';

dotenv.config();

logger.info('OneUptime Copilot is starting...');

const init: PromiseVoidFunction = async (): Promise<void> => {
    const codeRepositoryResult: CodeRepositoryResult = await InitUtil.init();

    for(const serviceRepository of codeRepositoryResult.servicesRepository) {
        const filesInService: Dictionary<CodeRepositoryFile> = await ServiceRepositoryUtil.getFilesInServiceDirectory({
            serviceRepository,
        });

        logger.info(`Files found in ${serviceRepository.serviceCatalog?.name}: ${Object.keys(filesInService).length}`);
    }
};

init()
    .then(() => {
        process.exit(0);
    })
    .catch((error: Error) => {
        logger.error('Error in starting OneUptime Copilot: ');
        logger.error(error);
        process.exit(1);
    });
