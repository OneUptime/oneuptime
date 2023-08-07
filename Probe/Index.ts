import 'ejs';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import Register from './Services/Register';

import './Jobs/Alive';
import FetchListAndProbe from './Jobs/Monitor/FetchList';
import { PROBE_MONITORING_WORKERS } from './Config';

const APP_NAME: string = 'probe';

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);

        // Register this probe.
        await Register.registerProbe();

        let workers: number = 0;

        while (workers < PROBE_MONITORING_WORKERS) {
            logger.info(`Starting worker ${workers}`);
            workers++;

            new FetchListAndProbe('Worker ' + workers)
                .run()
                .catch((err: any) => {
                    logger.error('FetchListAndProbe Failed:');
                    logger.error(err);
                });
        }
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();
