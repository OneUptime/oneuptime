import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import process from 'process';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';

const APP_NAME: string = 'isolated-vm';

const init: PromiseVoidFunction = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
        throw err;
    }
};

init().catch((err: Error) => {
    logger.error(err);
    logger.info('Exiting node process');
    process.exit(1);
});
