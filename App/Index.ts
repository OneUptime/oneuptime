import APIReferenceRoutes from ./FeatureSet/ApiReference/Index;
import BaseAPIRoutes from ./FeatureSet/BaseAPI/Index;
import DocsRoutes from ./FeatureSet/Docs/Index;
import HomeRoutes from ./FeatureSet/Home/Index;
// import FeatureSets.
import IdentityRoutes from ./FeatureSet/Identity/Index;
import NotificationRoutes from ./FeatureSet/Notification/Index;
import Workers from ./FeatureSet/Workers/Index;
import Workflow from ./FeatureSet/Workflow/Index;
import { PromiseVoidFunction } from Common/Types/FunctionTypes;
import { ClickhouseAppInstance } from CommonServer/Infrastructure/ClickhouseDatabase;
import { PostgresAppInstance } from CommonServer/Infrastructure/PostgresDatabase;
import Redis from CommonServer/Infrastructure/Redis;
import InfrastructureStatus from CommonServer/Infrastructure/Status;
import logger from CommonServer/Utils/Logger;
import Realtime from CommonServer/Utils/Realtime;
import App from CommonServer/Utils/StartServer;
import CommonServer/Utils/Telemetry;
import ejs;

process.env[SERVICE_NAME] = app;

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Check the status of the infrastructure (databases, redis, etc.)
    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatus({
        checkClickhouseStatus: true,
        checkPostgresStatus: true,
        checkRedisStatus: true,
      });
    };

    // Initialize the app
    await App.init({
      appName: process.env[SERVICE_NAME] || app,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
      },
    });

    // Connect to the Postgres database
    await PostgresAppInstance.connect(
      PostgresAppInstance.getDatasourceOptions(),
    );

    // Connect to Redis
    await Redis.connect();

    // Connect to the Clickhouse database
    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );

    // Initialize Realtime
    await Realtime.init();

    // Initialize feature sets
    await IdentityRoutes.init();
    await NotificationRoutes.init();
    await DocsRoutes.init();
    await BaseAPIRoutes.init();
    await APIReferenceRoutes.init();
    await Workers.init();
    await Workflow.init();

    // Initialize the home route (which has a catch-all route)
    await HomeRoutes.init();

    // Add default routes to the app
    await App.addDefaultRoutes();
  } catch (err) {
    // Log and re-throw the error
    logger.error(App Init Failed:);
    logger.error(err);
    throw err;
  }
};

init().catch((err: Error) => {
  // Log and exit the node process
  logger.error(err);
  logger.error(Exiting node process);
  process.exit(1);
});

