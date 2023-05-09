import 'ejs';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import MainAPI from './API/Main';
import SettingsAPI from './API/Settings';

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = '';

app.use([`/${APP_NAME}`, '/'], MainAPI);
app.use([`/${APP_NAME}`, '/'], SettingsAPI);

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();
