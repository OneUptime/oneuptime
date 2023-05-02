import 'ejs';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';

const APP_NAME: string = 'probe';

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
