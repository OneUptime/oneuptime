import CodeRepositoryUtil from './Utils/CodeRepository';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import logger from 'CommonServer/Utils/Logger';
import CodeRepository from 'Model/Models/CodeRepository';
import dotenv from 'dotenv';

dotenv.config();

logger.info('OneUptime Copilot is starting...');

const init: PromiseVoidFunction = async (): Promise<void> => {
    const codeRepository: CodeRepository =
        await CodeRepositoryUtil.getCodeRepository();
    logger.info(`Code Repository found: ${codeRepository.name}`);
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
