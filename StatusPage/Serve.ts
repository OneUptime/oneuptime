import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'status-page';

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
    logger.error('Exiting node process');
    process.exit(1);
});

export default app;
