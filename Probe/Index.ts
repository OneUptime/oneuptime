import 'ejs';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import Register from './Services/Register';

import './Jobs/Alive';
import './Jobs/Monitor/FetchList';

const APP_NAME: string = 'probe';

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);

        // Register this probe.
        await Register.registerProbe();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();
