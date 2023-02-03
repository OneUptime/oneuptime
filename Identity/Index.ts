import 'ejs';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import type { ExpressApplication } from 'CommonServer/Utils/Express';
import Express from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import AuthenticationAPI from './API/AuthenticationAPI';
import StatusPageAuthenticationAPI from './API/StatusPageAuthenticationAPI';

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = 'identity';

app.use([`/${APP_NAME}`, '/'], AuthenticationAPI);

app.use(
    [`/${APP_NAME}/status-page`, '/staus-page'],
    StatusPageAuthenticationAPI
);

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
