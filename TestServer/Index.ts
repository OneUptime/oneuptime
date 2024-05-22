import 'ejs';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import MainAPI from './API/Main';
import SettingsAPI from './API/Settings';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = 'test-server';

app.use([`/${APP_NAME}`, '/'], MainAPI);
app.use([`/${APP_NAME}`, '/'], SettingsAPI);

const init: PromiseVoidFunction = async (): Promise<void> => {
    try {
        // init the app
        await App.init({
            appName: APP_NAME,
            port: undefined,
            isFrontendApp: false,
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
    logger.debug('Exiting node process');
    process.exit(1);
});
