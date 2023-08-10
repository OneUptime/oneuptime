import App from 'CommonServer/Utils/StartServer';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
export const APP_NAME: string = 'status-page';

const app: ExpressApplication = Express.getExpressApp();

const init: () => Promise<void> = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME, undefined, true);

        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init().catch((err: Error) => {
    logger.error(err);
});

export default app;
