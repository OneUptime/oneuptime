import 'ejs';
import Redis from 'CommonServer/Infrastructure/Redis';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import { ClickhouseAppInstance } from 'CommonServer/Infrastructure/ClickhouseDatabase';
import Realtime from 'CommonServer/Utils/Realtime';

// import featuresets.
import './FeatureSet/Identity/Index';
import './FeatureSet/Notification/Index';
import './FeatureSet/BaseAPI/Index';
import './FeatureSet/ApiReference/Index';

// home should be in the end.
import './FeatureSet/Home/Index';

const APP_NAME: string = 'app';

const init: () => Promise<void> = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);

        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        // connect redis
        await Redis.connect();

        await ClickhouseAppInstance.connect(
            ClickhouseAppInstance.getDatasourceOptions()
        );

        Realtime.init();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
        throw err;
    }
};

init().catch((err: Error) => {
    logger.error(err);
    logger.info('Exiting node process');
    process.exit(1);
});
