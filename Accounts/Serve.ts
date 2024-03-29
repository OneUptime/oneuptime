import App from 'CommonServer/Utils/StartServer';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';

export const APP_NAME: string = 'accounts';

const app: ExpressApplication = Express.getExpressApp();

const init: PromiseVoidFunction = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME, undefined, true);
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

export default app;
