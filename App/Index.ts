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
import InfrastructureStatus from 'CommonServer/Infrastructure/Status';

import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';

const init: PromiseVoidFunction = async (): Promise<void> => {
    try {
        const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
            return await InfrastructureStatus.checkStatus({
                checkClickhouseStatus: true,
                checkPostgresStatus: true,
                checkRedisStatus: true,
            });
        };

        // init the app
        await App.init({
            appName: process.env['SERVICE_NAME'] || 'app',
            statusOptions: {
                liveCheck: statusCheck,
                readyCheck: statusCheck,
            },
        });

        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        // connect redis
        await Redis.connect();

        await ClickhouseAppInstance.connect(
            ClickhouseAppInstance.getDatasourceOptions()
        );

        await Realtime.init();

        // init featuresets
        await IdentityRoutes.init();
        await NotificationRoutes.init();
        await DocsRoutes.init();
        await BaseAPIRoutes.init();
        await APIReferenceRoutes.init();
        await Workers.init();
        await Workflow.init();

        // home should be in the end because it has the catch all route.
        await HomeRoutes.init();

        // add default routes
        await App.addDefaultRoutes();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
        throw err;
    }
};

init().catch((err: Error) => {
    logger.error(err);
    logger.debug('Exiting node process');
    process.exit(1);
});
