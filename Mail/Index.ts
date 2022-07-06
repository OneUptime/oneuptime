import "ejs";
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';

// API
import MailAPI from './API/Mail';
import { PostgresAppInstance } from "CommonServer/Infrastructure/PostgresDatabase";
import logger from "CommonServer/Utils/Logger";

const APP_NAME: string = 'mail';
const app: ExpressApplication = Express.getExpressApp();

app.use([`/${APP_NAME}/email`, '/email'], MailAPI);


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
