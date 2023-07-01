import Express, {
    ExpressApplication,
} from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import logger from 'CommonServer/Utils/Logger';


const APP_NAME: string = 'l';

const app: ExpressApplication = Express.getExpressApp();

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
