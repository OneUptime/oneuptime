import App from 'CommonServer/Utils/StartServer';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';

export const APP_NAME: string = 'admin';

const app: ExpressApplication = Express.getExpressApp();

const init: PromiseVoidFunction = async (): Promise<void> => {
    try {
        // init the app
        await App.init({
            appName: APP_NAME,
            port: undefined,
            isFrontendApp: true,
            statusOptions: {
                liveCheck: async () => {},
                readyCheck: async () => {},
            },
        });

        // add default routes
        await App.addDefaultRoutes();
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
