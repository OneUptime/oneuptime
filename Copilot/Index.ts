import { GetLocalRepositoryPath } from './Config';
import { CodeRepositoryResult } from './Utils/CodeRepository';
import InitUtil from './Utils/Init';
import Dictionary from 'Common/Types/Dictionary';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import CodeRepositoryCommonServerUtil from 'CommonServer/Utils/CodeRepository/CodeRepository';
import CodeRepositoryFile from 'CommonServer/Utils/CodeRepository/CodeRepositoryFile';
import logger from 'CommonServer/Utils/Logger';
import dotenv from 'dotenv';

dotenv.config();

logger.info('OneUptime Copilot is starting...');

const init: PromiseVoidFunction = async (): Promise<void> => {
    const codeRepositoryResult: CodeRepositoryResult = await InitUtil.init();

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
