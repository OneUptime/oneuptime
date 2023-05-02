import 'ejs';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import AliveAPI from './API/Alive';
import RegisterAPI from './API/Register';

import Redis from 'CommonServer/Infrastructure/Redis';

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = 'probe-api';

app.use([`/${APP_NAME}`, '/'], AliveAPI);
app.use([`/${APP_NAME}`, '/'], RegisterAPI);

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        // connect redis
        await Redis.connect();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();
