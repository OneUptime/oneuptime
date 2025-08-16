import WorkerRoutes from "./Routes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import InfrastructureStatus from "Common/Server/Infrastructure/Status";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Realtime from "Common/Server/Utils/Realtime";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import { WORKER_CONCURRENCY } from "./Config";
import "ejs";

const APP_NAME: string = "worker";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    logger.debug("Initializing Worker");

    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

    logger.debug("Telemetry initialized");

    logger.info(`Worker Service - Queue concurrency: ${WORKER_CONCURRENCY}`);

    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      // Check the status of infrastructure components
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: true,
        checkPostgresStatus: true,
        checkRedisStatus: true,
        retryCount: 3,
      });
    };

    // Initialize the app with service name and status checks
    await App.init({
      appName: APP_NAME,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
      },
    });

    logger.debug("App initialized");

    // Connect to Postgres database
    await PostgresAppInstance.connect();

    logger.debug("Postgres connected");

    // Connect to Redis
    await Redis.connect();

    logger.debug("Redis connected");

    // Connect to Clickhouse database
    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );

    logger.debug("Clickhouse connected");

    // Initialize real-time functionalities
    await Realtime.init();

    logger.debug("Realtime initialized");

    // Register worker routes (must be before default 404 catch-alls)
    await WorkerRoutes.init();

    logger.debug("Routes initialized");

    // Add default routes to the app (catch-alls should be last)
    await App.addDefaultRoutes();

    logger.debug("Default routes added");

    logger.info("Worker Initialized Successfully");
  } catch (err) {
    logger.error("Worker Init Failed:");
    logger.error(err);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err);
  logger.error("Exiting node process");
  process.exit(1);
});
