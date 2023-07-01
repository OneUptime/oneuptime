import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import logger from 'CommonServer/Utils/Logger';
import LinkShortnerAPI from './API/LinkShortner';

const APP_NAME: string = 'l';

const app: ExpressApplication = Express.getExpressApp();

app.use([`/${APP_NAME}/`, '/'], LinkShortnerAPI);

const init: Function = async (): Promise<void> => {
    try {
        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        // init the app
        await App(APP_NAME);
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();

export default app;
