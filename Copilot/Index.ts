import { GetLocalRepositoryPath } from './Config';
import CodeRepositoryUtil from './Utils/CodeRepository';
import Dictionary from 'Common/Types/Dictionary';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import CodeRepositoryCommonServerUtil from 'CommonServer/Utils/CodeRepository/CodeRepository';
import CodeRepositoryFile from 'CommonServer/Utils/CodeRepository/CodeRepositoryFile';
import logger from 'CommonServer/Utils/Logger';
import CodeRepository from 'Model/Models/CodeRepository';
import dotenv from 'dotenv';

dotenv.config();

logger.info('OneUptime Copilot is starting...');

const init: PromiseVoidFunction = async (): Promise<void> => {
    const codeRepository: CodeRepository =
        await CodeRepositoryUtil.getCodeRepository();

    logger.info(`Code Repository found: ${codeRepository.name}`);

    const allFiles: Dictionary<CodeRepositoryFile> =
        await CodeRepositoryCommonServerUtil.getFilesInDirectoryRecursive({
            repoPath: GetLocalRepositoryPath(),
            directoryPath: GetLocalRepositoryPath(),
        });

    logger.info(`All files found: ${Object.keys(allFiles).length}`);
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
