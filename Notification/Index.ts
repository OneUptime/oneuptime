import 'ejs';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';
import Redis from 'CommonServer/Infrastructure/Redis';

// API
import MailAPI from './API/Mail';
import SmsAPI from './API/SMS';
import CallAPI from './API/Call';
import SMTPConfigAPI from './API/SMTPConfig';
import logger from 'CommonServer/Utils/Logger';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
// import handlebars loader.
import './Utils/Handlebars';

const APP_NAME: string = 'notification';
const app: ExpressApplication = Express.getExpressApp();

app.use([`/${APP_NAME}/email`, '/email'], MailAPI);
app.use([`/${APP_NAME}/sms`, '/sms'], SmsAPI);
app.use([`/${APP_NAME}/call`, '/call'], CallAPI);
app.use([`/${APP_NAME}/smtp-config`, '/smtp-config'], SMTPConfigAPI);

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
