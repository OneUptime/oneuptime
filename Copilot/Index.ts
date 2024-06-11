import CodeRepositoryUtil from './Utils/CodeRepository';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import logger from 'CommonServer/Utils/Logger';
import CodeRepository from 'Model/Models/CodeRepository';
import dotenv from 'dotenv';
import CodeRepositoryFile from 'CommonServer/Utils/CodeRepository/CodeRepositoryFile'
import CodeRepositoryCommonServerUtil from 'CommonServer/Utils/CodeRepository/CodeRepository';
import { GetLocalRepositoryPath } from './Config';

dotenv.config();

logger.info('OneUptime Copilot is started...');

const init: PromiseVoidFunction = async (): Promise<void> => {
    const codeRepository: CodeRepository =
        await CodeRepositoryUtil.getCodeRepository();
    
    logger.info(`Code Repository found: ${codeRepository.name}`);

    const allFiles: Array<CodeRepositoryFile>  = await CodeRepositoryCommonServerUtil.getFilesInDirectoryRecursive({
        repoPath: GetLocalRepositoryPath(),
        directoryPath: GetLocalRepositoryPath()
    });

    logger.info(`All files found: ${allFiles.length}`);
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
