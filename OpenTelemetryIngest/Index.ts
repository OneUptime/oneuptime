import OTelIngestAPI from "./API/OTelIngest";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import InfrastructureStatus from "Common/Server/Infrastructure/Status";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Realtime from "Common/Server/Utils/Realtime";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import OtelQueueWorker from "./Services/OtelQueueWorker";
import Queue from "Common/Server/Infrastructure/Queue";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import "ejs";

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = "open-telemetry-ingest";

app.use([`/${APP_NAME}`, "/"], OTelIngestAPI);

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: true,
        checkPostgresStatus: true,
        checkRedisStatus: true,
        retryCount: 3,
      });
    };

    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

    // init the app
    await App.init({
      appName: APP_NAME,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
      },
    });

    // connect to the database.
    await PostgresAppInstance.connect();

    // connect redis
    await Redis.connect();

    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );

    await Realtime.init();

    // Initialize OpenTelemetry Queue Workers with optional environment configuration
    const queueConfig = {
      concurrency: {
        traces: parseInt(process.env['OTEL_QUEUE_TRACES_CONCURRENCY'] || '10'),
        metrics: parseInt(process.env['OTEL_QUEUE_METRICS_CONCURRENCY'] || '10'),
        logs: parseInt(process.env['OTEL_QUEUE_LOGS_CONCURRENCY'] || '10'),
      },
      enabled: {
        traces: process.env['OTEL_QUEUE_TRACES_ENABLED'] !== 'false',
        metrics: process.env['OTEL_QUEUE_METRICS_ENABLED'] !== 'false',
        logs: process.env['OTEL_QUEUE_LOGS_ENABLED'] !== 'false',
      },
    };

    await OtelQueueWorker.init(queueConfig);

    // Add queue monitoring routes (Bull Board)
    app.use(
      Queue.getInspectorRoute(),
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
      Queue.getQueueInspectorRouter(),
    );

    // add default routes
    await App.addDefaultRoutes();
  } catch (err) {
    logger.error("App Init Failed:");
    logger.error(err);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err);
  logger.error("Exiting node process");
  process.exit(1);
});
