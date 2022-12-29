import App from 'CommonServer/Utils/StartServer';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import Port from 'Common/Types/Port';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
export const APP_NAME: string = 'status-page';

const app: ExpressApplication = Express.getExpressApp();

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME, new Port(3105), true);

        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();

export default app;
