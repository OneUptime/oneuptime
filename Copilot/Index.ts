import { GetLocalRepositoryPath } from './Config';
import CodeRepositoryUtil, { CodeRepositoryResult } from './Utils/CodeRepository';
import Dictionary from 'Common/Types/Dictionary';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import CodeRepositoryCommonServerUtil from 'CommonServer/Utils/CodeRepository/CodeRepository';
import CodeRepositoryFile from 'CommonServer/Utils/CodeRepository/CodeRepositoryFile';
import logger from 'CommonServer/Utils/Logger';
import dotenv from 'dotenv';
import InitUtil from './Utils/Init';

dotenv.config();

logger.info('OneUptime Copilot is starting...');

const init: PromiseVoidFunction = async (): Promise<void> => {

    await InitUtil.validate();  // validate all the configurations

    const codeRepositoryResult: CodeRepositoryResult =
        await CodeRepositoryUtil.getCodeRepository();

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
