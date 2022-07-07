import 'ejs';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
//import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';

//const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = 'dashboard-api';

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
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