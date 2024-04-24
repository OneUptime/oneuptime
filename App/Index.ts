process.env['SERVICE_NAME'] = 'app';

import 'CommonServer/Utils/Telemetry';
import 'ejs';
import Redis from 'CommonServer/Infrastructure/Redis';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import { ClickhouseAppInstance } from 'CommonServer/Infrastructure/ClickhouseDatabase';
import Realtime from 'CommonServer/Utils/Realtime';

// import FeatureSets.
import IdentityRoutes from './FeatureSet/Identity/Index';
import NotificationRoutes from './FeatureSet/Notification/Index';
import DocsRoutes from './FeatureSet/Docs/Index';
import BaseAPIRoutes from './FeatureSet/BaseAPI/Index';
import APIReferenceRoutes from './FeatureSet/ApiReference/Index';
import Workers from './FeatureSet/Workers/Index';
import Workflow from './FeatureSet/Workflow/Index';
import HomeRoutes from './FeatureSet/Home/Index';

import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';

const init: PromiseVoidFunction = async (): Promise<void> => {
    try {
        // init the app
        await App(process.env['SERVICE_NAME'] || 'app');

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

        // init featuresets
        IdentityRoutes.init();
        NotificationRoutes.init();
        DocsRoutes.init();
        BaseAPIRoutes.init();
        APIReferenceRoutes.init();

        // home should be in the end because it has the catch all route.
        HomeRoutes.init();

        // init workers
        await Workers.init();

        // init workflow
        await Workflow.init();
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
