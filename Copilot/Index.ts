import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import logger from 'CommonServer/Utils/Logger';
import Logger from 'CommonServer/Utils/Logger';
import CodeRepositoryUtil from './Utils/CodeRepository';
import dotenv from 'dotenv';

dotenv.config();

Logger.info('OneUptime Copilot is starting...');

const init: PromiseVoidFunction = async (): Promise<void> => {
    const codeRepository = await CodeRepositoryUtil.getCodeRepository(); 
    Logger.info(`Code Repository found: ${codeRepository.name}`);
}

init().then(()=>{
    process.exit(0);
}).catch((error) => {
    Logger.error('Error in starting OneUptime Copilot: ');
    logger.error(error);
    process.exit(1);
});
